/**
 * Configuration snapshots & time-travel diff — capture point-in-time RouterOS
 * `/export` dumps, store them locally, and diff any two (or one against the
 * live device) to see exactly what changed.
 *
 * Unlike `/export` to a file on the device (see `backup.ts`), snapshots are
 * captured to the MCP host's own SQLite database (`~/.mikrotik-mcp/snapshots.db`)
 * so they survive device reboots/resets and accumulate a configuration history
 * the model can reason over: "what changed on this router since last Tuesday?".
 *
 * The device is only ever *read* (`/export`); all mutation is local persistence.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { diffLines } from "../core/diff";
import { READ, WRITE, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { isEmpty, looksLikeError, Cmd } from "../core/routeros";
import { resolveDeviceName } from "../core/runtime";
import { DEFAULT_SNAPSHOT_DB } from "../config";
import { contentSha, countLines, normalizeExport, parseExportMeta } from "../snapshots/format";
import { openSnapshotStore } from "../snapshots/store";
import type { Snapshot, SnapshotStore } from "../snapshots/store";
import type { ToolContext } from "../core/context";

// A single lazily-opened store, reused across calls for the life of the server
// process (the stdio server is long-lived). The `bun:sqlite` dependency only
// loads when the first snapshot tool actually runs.
let storePromise: Promise<SnapshotStore> | null = null;
function snapshots(): Promise<SnapshotStore> {
  if (!storePromise) storePromise = openSnapshotStore(DEFAULT_SNAPSHOT_DB);
  return storePromise;
}

/** Build the `/export` command used for both capture and live diff. */
function exportCommand(opts: { section?: string; terse: boolean; showSensitive: boolean }): string {
  const base = opts.section ? `/${opts.section} export` : "/export";
  return new Cmd(base).flag("terse", opts.terse).flag("show-sensitive", opts.showSensitive).build();
}

/** Run `/export` on the device and return its body, or throw on a device error. */
async function liveExport(
  ctx: ToolContext,
  opts: { section?: string; terse: boolean; showSensitive: boolean },
): Promise<string> {
  const body = await executeMikrotikCommand(exportCommand(opts), ctx);
  if (isEmpty(body) || looksLikeError(body)) {
    throw new Error(`device returned no usable export: ${body.trim() || "(empty)"}`);
  }
  return body;
}

const RELATIVE_HINT = "`<id>`, `latest` (newest stored), or `live` (capture the device now)";

/** Resolve a snapshot reference to `{ label, body }` for diffing. */
async function resolveRef(
  store: SnapshotStore,
  ref: string,
  device: string,
  ctx: ToolContext,
): Promise<{ label: string; body: string }> {
  if (ref === "live") {
    return {
      label: `${device}@live`,
      body: await liveExport(ctx, { terse: true, showSensitive: false }),
    };
  }
  const snap = ref === "latest" ? store.latest(device) : store.get(ref);
  if (!snap) {
    throw new Error(
      ref === "latest"
        ? `no snapshots stored for device '${device}' yet — capture one first`
        : `snapshot '${ref}' not found`,
    );
  }
  const when = new Date(snap.ts).toISOString();
  return { label: `${snap.id} (${when})`, body: snap.body };
}

function describe(s: Snapshot): string {
  const when = new Date(s.ts).toISOString();
  const label = s.label ? ` "${s.label}"` : "";
  const ver = s.rosVersion ? ` ros=${s.rosVersion}` : "";
  return `${s.id}${label}  ${when}  ${s.lines} lines, ${s.bytes} bytes${ver}  sha=${s.sha}`;
}

export const configSnapshotTools: ToolModule = [
  defineTool({
    name: "capture_config_snapshot",
    title: "Capture Config Snapshot",
    annotations: WRITE,
    description:
      "Captures the device's current configuration (`/export`) and stores it locally as a " +
      "timestamped snapshot for later diffing/rollback reference. Sensitive values are hidden " +
      "unless show_sensitive is set. By default an identical capture (no config change since the " +
      "last snapshot) is skipped; set force to store it anyway. Optionally limit to one RouterOS " +
      'section (e.g. "ip firewall filter").',
    inputSchema: {
      label: z.string().optional().describe("Human label, e.g. 'pre-firewall-change'."),
      section: z
        .string()
        .optional()
        .describe(
          'RouterOS path without leading slash, e.g. "ip firewall filter". Omit for full config.',
        ),
      terse: z
        .boolean()
        .default(true)
        .describe("Use `/export terse` (one self-contained line per item) for cleaner diffs."),
      show_sensitive: z.boolean().default(false),
      force: z.boolean().default(false),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`Capturing config snapshot for ${device}${a.section ? ` (${a.section})` : ""}`);

      const body = await liveExport(ctx, {
        section: a.section,
        terse: a.terse,
        showSensitive: a.show_sensitive,
      });

      const meta = parseExportMeta(body);
      const sha = contentSha(normalizeExport(body));
      const store = await snapshots();

      const prev = store.latest(device);
      if (prev && prev.sha === sha && !a.force) {
        return (
          `No configuration change since the last snapshot — nothing stored.\n` +
          `Latest: ${describe(prev)}\n` +
          `(pass force=true to snapshot anyway.)`
        );
      }

      const ts = Date.now();
      const snap: Snapshot = {
        id: `snap_${ts}_${sha.slice(0, 8)}`,
        device,
        ts,
        label: a.label,
        rosVersion: meta.rosVersion,
        body,
        bytes: Buffer.byteLength(body, "utf8"),
        lines: countLines(body),
        sha,
      };
      store.insert(snap);

      const drift = prev
        ? `Changed since ${prev.id} (previous sha=${prev.sha}).`
        : `First snapshot for this device.`;
      return `Snapshot captured:\n${describe(snap)}\n${drift}`;
    },
  }),

  defineTool({
    name: "list_config_snapshots",
    title: "List Config Snapshots",
    annotations: READ,
    description:
      "Lists stored configuration snapshots for the target device, newest first (metadata only — " +
      "id, label, time, size, RouterOS version, content hash). Use get_config_snapshot for a body.",
    inputSchema: {
      limit: z.number().int().min(1).max(500).default(50),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      const store = await snapshots();
      const rows = store.list(device, a.limit, false);
      if (rows.length === 0) {
        return `No configuration snapshots stored for '${device}'. Capture one with capture_config_snapshot.`;
      }
      const total = store.count(device);
      const lines = rows.map((s) => describe(s)).join("\n");
      return `CONFIG SNAPSHOTS for ${device} (showing ${rows.length} of ${total}):\n\n${lines}`;
    },
  }),

  defineTool({
    name: "get_config_snapshot",
    title: "Get Config Snapshot",
    annotations: READ,
    description:
      "Returns a stored configuration snapshot by id. With include_body=true (default) the full " +
      "captured `/export` text is returned — this body is itself a RouterOS `.rsc` script suitable " +
      "for review or manual re-application. Set include_body=false for metadata only.",
    inputSchema: {
      id: z.string(),
      include_body: z.boolean().default(true),
    },
    async handler(a, ctx) {
      const store = await snapshots();
      const snap = store.get(a.id);
      if (!snap) return `Snapshot '${a.id}' not found.`;
      if (!a.include_body) return `SNAPSHOT METADATA:\n${describe(snap)}`;
      return `SNAPSHOT ${snap.id}\n${describe(snap)}\n\n--- begin export ---\n${snap.body}\n--- end export ---`;
    },
  }),

  defineTool({
    name: "diff_config_snapshots",
    title: "Diff Config Snapshots",
    annotations: READ,
    description:
      "Time-travel diff: compares two configurations and reports a unified diff (added/removed " +
      `lines) plus a summary. Each of \`from\`/\`to\` may be ${RELATIVE_HINT}. Typical uses: drift ` +
      "check (from=latest, to=live), or compare two stored snapshots by id. Volatile export " +
      "header timestamps are ignored so unchanged configs diff clean.",
    inputSchema: {
      from: z.string().describe(`Baseline side: ${RELATIVE_HINT}.`),
      to: z
        .string()
        .default("live")
        .describe(`Comparison side: ${RELATIVE_HINT}. Defaults to live.`),
      context_lines: z.number().int().min(0).max(20).default(3),
      max_output_lines: z
        .number()
        .int()
        .min(50)
        .max(5000)
        .default(800)
        .describe("Truncate the unified diff beyond this many lines."),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      const store = await snapshots();
      const from = await resolveRef(store, a.from, device, ctx);
      const to = await resolveRef(store, a.to, device, ctx);

      const result = diffLines(normalizeExport(from.body), normalizeExport(to.body), {
        contextLines: a.context_lines,
        fromLabel: from.label,
        toLabel: to.label,
      });

      const { added, removed, unchanged, changed } = result.summary;
      const header =
        `CONFIG DIFF  ${from.label}  →  ${to.label}\n` +
        `+${added} added, -${removed} removed, ${unchanged} unchanged`;

      if (!changed) return `${header}\n\nNo differences — configurations are identical.`;

      const diffLinesArr = result.unified.split("\n");
      if (diffLinesArr.length > a.max_output_lines) {
        const shown = diffLinesArr.slice(0, a.max_output_lines).join("\n");
        return `${header}\n\n${shown}\n\n… diff truncated at ${a.max_output_lines} lines (${diffLinesArr.length} total). Raise max_output_lines to see the rest.`;
      }
      return `${header}\n\n${result.unified}`;
    },
  }),

  defineTool({
    name: "remove_config_snapshot",
    title: "Remove Config Snapshot",
    annotations: DESTRUCTIVE,
    description:
      "Deletes stored configuration snapshots by id (local history only — never touches the device). " +
      "Accepts one or more ids.",
    inputSchema: {
      ids: z.array(z.string()).min(1),
    },
    async handler(a) {
      const store = await snapshots();
      const removed = store.delete(a.ids);
      if (removed === 0) return `No snapshots removed (none of the given ids matched).`;
      return `Removed ${removed} snapshot${removed === 1 ? "" : "s"}.`;
    },
  }),
];
