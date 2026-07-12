/**
 * Port-Scan Signature Detection — `list_port_scan_detection_signatures` (read)
 * and `add_port_scan_detection_rules` (scoped write).
 *
 * Detects (never blocks) six well-known port-scan signatures by tagging the
 * source into an address list, inside a dedicated `detect-portscan` sub-chain
 * gated by a single trust-excluding jump from `input`. See
 * `docs/port-scan-detection.md` for the architecture rationale. The pure catalog
 * + planner live in `src/core/port-scan-detection.ts`; this layer only fetches
 * device state and wraps writes in a snapshot + Safe Mode.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import type { ToolContext } from "../core/context";
import { rulesFromRows } from "../core/firewall-audit";
import {
  DETECT_CHAIN,
  PORT_SCAN_SIGNATURES,
  PORT_SCAN_SIGNATURE_IDS,
  buildJumpCommand,
  planPortScanDetection,
  routerosMatch,
  signaturePresent,
} from "../core/port-scan-detection";
import type { DeviceScanState } from "../core/port-scan-detection";
import { READ, DANGEROUS, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { getDevice, resolveDeviceName } from "../core/runtime";
import { isEmpty, looksLikeError } from "../core/routeros";
import { captureSnapshot } from "../snapshots/capture";
import { getSafeModeManager } from "../ssh/safe-mode";
import { fetchRows } from "../utils/safe-exec";

/** Parse a `chain=<chain>` filter ruleset into normalised rules. */
async function fetchChainRules(chain: string, ctx: ToolContext) {
  const rows = await fetchRows(`/ip firewall filter print detail where chain=${chain}`, ctx);
  return rulesFromRows(rows);
}

/** Count entries currently in an address list. */
async function addressListCount(list: string, ctx: ToolContext): Promise<number> {
  const raw = await executeMikrotikCommand(
    `/ip firewall address-list print count-only where list=${JSON.stringify(list)}`,
    ctx,
  );
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Ordered internal `.id`s of the input chain (same order as a chain-filtered print). */
async function inputChainIds(ctx: ToolContext): Promise<string[]> {
  const raw = await executeMikrotikCommand(
    ":foreach i in=[/ip firewall filter find chain=input] do={:put $i}",
    ctx,
  );
  if (isEmpty(raw)) return [];
  return raw
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\*[0-9A-Fa-f]+$/.test(l));
}

export const portScanDetectionTools: ToolModule = [
  defineTool({
    name: "list_port_scan_detection_signatures",
    title: "List Port-Scan Detection Signatures",
    annotations: READ,
    description:
      "Read-only catalog of the six port-scan detection signatures this fleet can install " +
      "(psd_generic, nmap_fin_stealth, syn_fin_scan, syn_rst_scan, fin_psh_urg_scan, nmap_null_scan) " +
      "— each with its id, display name, one-line description and exact RouterOS match syntax. " +
      "CALL THIS FIRST and show the user all six signatures with their descriptions. Do NOT proceed " +
      "to add_port_scan_detection_rules until the user has explicitly named which specific signature " +
      "IDs they want — never infer, never default to all six, never default to none. When `device` is " +
      "supplied, also reports per signature whether it is already present in that device's " +
      "detect-portscan chain. (On a multi-device server, target the device with the `device` " +
      "selector this tool exposes.)",
    // The multi-device `device` selector is auto-injected by the registry; a
    // single-device server has none, so presence is only queried when a device
    // is actually in context.
    async handler(_a, ctx) {
      let present: Set<string> | null = null;
      if (ctx.device !== undefined) {
        const detect = await fetchChainRules(DETECT_CHAIN, ctx);
        present = new Set(
          PORT_SCAN_SIGNATURES.filter((s) => signaturePresent(detect, s)).map((s) => s.id),
        );
      }

      const lines: string[] = [
        "PORT-SCAN DETECTION SIGNATURES (choose explicitly before adding):",
        "",
      ];
      for (const s of PORT_SCAN_SIGNATURES) {
        const mark = present ? (present.has(s.id) ? " [already present]" : " [not present]") : "";
        lines.push(`• ${s.id} — "${s.display_name}"${mark}`);
        lines.push(`    match: ${routerosMatch(s)}`);
        lines.push(`    ${s.description}`);
      }
      lines.push("");
      lines.push(
        "Ask the user which specific IDs to enable, then call add_port_scan_detection_rules with " +
          "exactly those rule_types. There is no select-all.",
      );
      return lines.join("\n");
    },
  }),

  defineTool({
    name: "add_port_scan_detection_rules",
    title: "Add Port-Scan Detection Rules",
    annotations: DANGEROUS,
    description:
      "Installs the user-selected port-scan detection signatures into a dedicated `detect-portscan` " +
      "sub-chain, gated by a single input jump that EXCLUDES a trusted address-list (so trusted " +
      "sources are never tagged). These rules only add the source to an address list — they NEVER " +
      "drop or block. NEVER call this with a guessed or default set of rule_types: it must only be " +
      "called with signature IDs the user explicitly chose after seeing " +
      "list_port_scan_detection_signatures — there is no select-all. Requires `trusted_list_name` " +
      "(must already exist and be non-empty on the device) and the human acknowledgement " +
      "`confirmed_trusted_list_includes_my_ip=true`. Captures a config snapshot and applies every " +
      "write inside Safe Mode (auto-revert on session drop). Idempotent — a second identical run adds " +
      "nothing. Enforcement/blocking of the tagged list is intentionally out of scope.",
    inputSchema: {
      rule_types: z
        .array(z.enum(PORT_SCAN_SIGNATURE_IDS))
        .min(1)
        .describe(
          "REQUIRED, non-empty. The specific signature IDs the user explicitly chose after seeing " +
            "the catalog. No default, no select-all — unknown values are rejected.",
        ),
      trusted_list_name: z
        .string()
        .min(1)
        .describe(
          "REQUIRED. The management/trusted address-list on THIS device (no default). Must already " +
            "exist and contain at least one entry, or the call is refused.",
        ),
      address_list_name: z
        .string()
        .default("port scanners")
        .describe('Address list detected scanners are tagged into (default "port scanners").'),
      address_list_timeout: z
        .string()
        .default("2w")
        .describe('How long a detected source stays tagged (default "2w").'),
      confirm: z.literal(true).describe("Must be true to write."),
      confirmed_trusted_list_includes_my_ip: z
        .literal(true)
        .describe(
          "Human acknowledgement that the address you currently manage this device from is present " +
            "in trusted_list_name. The tool cannot infer this — it must be explicitly true.",
        ),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] add_port_scan_detection_rules: ${a.rule_types.join(",")}`);

      // Fetch device state (read-only) before any decision.
      const [inputRules, detectChainRules, trustListCount] = await Promise.all([
        fetchChainRules("input", ctx),
        fetchChainRules(DETECT_CHAIN, ctx),
        addressListCount(a.trusted_list_name, ctx),
      ]);

      const state: DeviceScanState = {
        inputRules,
        detectChainRules,
        // RouterOS address-lists exist only by virtue of entries, so >0 entries
        // means both "exists" and "non-empty"; 0 collapses to "does not exist".
        trustListExists: trustListCount > 0,
        trustListCount,
      };

      const plan = planPortScanDetection(state, {
        ruleTypes: a.rule_types,
        trustedListName: a.trusted_list_name,
        addressListName: a.address_list_name,
        addressListTimeout: a.address_list_timeout,
        confirm: a.confirm,
        confirmedTrustedListIncludesMyIp: a.confirmed_trusted_list_includes_my_ip,
      });

      // Rejected pre-flight → NO snapshot, NO Safe Mode, NO writes.
      if (plan.error) return `Port-scan detection refused:\n${plan.error}`;

      // Successful path always records a snapshot up front (rollback point).
      const snapshotId = await captureSnapshot(ctx, "pre-add_port_scan_detection_rules");

      // Resolve the jump gate's place-before to a real `.id` (never the filtered
      // ordinal). Build the jump only when it isn't already present.
      const writeCommands = [...plan.signatureCommands];
      if (!plan.jump.present) {
        let placeBeforeId: string | undefined;
        if (plan.jump.placeBeforeIndex !== null) {
          const ids = await inputChainIds(ctx);
          placeBeforeId = ids[plan.jump.placeBeforeIndex];
        }
        writeCommands.push(buildJumpCommand(a.trusted_list_name, placeBeforeId));
      }

      const result = await applyWrites(ctx, device, writeCommands);
      return renderResult(a, plan, snapshotId, result, ctx);
    },
  }),
];

interface WriteOutcome {
  applied: number;
  safeMode: string;
  committed: boolean;
  error?: string;
}

/** Apply the ordered write commands inside one Safe-Mode session (SSH devices). */
async function applyWrites(
  ctx: ToolContext,
  deviceName: string,
  commands: string[],
): Promise<WriteOutcome> {
  if (commands.length === 0)
    return { applied: 0, safeMode: "not used (nothing to write)", committed: true };

  const useSafe = !getDevice(deviceName).mac;
  const mgr = getSafeModeManager(deviceName);
  if (useSafe) {
    const en = await mgr.enable();
    if (en.startsWith("Error"))
      return { applied: 0, safeMode: `failed to enable: ${en}`, committed: false };
  }

  let applied = 0;
  for (const cmd of commands) {
    const out = useSafe
      ? await mgr.execute(cmd).catch((e: unknown) => `error: ${String(e)}`)
      : await executeMikrotikCommand(cmd, ctx);
    if (looksLikeError(out) || out.startsWith("error:")) {
      if (useSafe) await mgr.rollback();
      return {
        applied,
        safeMode: useSafe ? "rolled back (a write failed — no changes kept)" : "not used",
        committed: false,
        error: out.trim().split("\n")[0],
      };
    }
    applied++;
  }

  if (useSafe) {
    const c = await mgr.commit();
    return {
      applied,
      safeMode: c.ok ? "committed" : `commit FAILED — changes revert: ${c.message}`,
      committed: c.ok,
    };
  }
  return { applied, safeMode: "not used (MAC-Telnet device — no Safe Mode)", committed: true };
}

/** Build the human-facing report. */
async function renderResult(
  a: { rule_types: string[]; trusted_list_name: string; address_list_name: string },
  plan: ReturnType<typeof planPortScanDetection>,
  snapshotId: string,
  outcome: WriteOutcome,
  ctx: ToolContext,
): Promise<string> {
  const lines: string[] = [];
  lines.push(`PORT-SCAN DETECTION — snapshot=${snapshotId}  safe-mode=${outcome.safeMode}`);
  if (outcome.error) {
    lines.push(`FAILED after ${outcome.applied} write(s): ${outcome.error}`);
    lines.push("No partial state kept if Safe Mode rolled back — re-run after fixing the cause.");
    return lines.join("\n");
  }

  const created = plan.signatures.filter((s) => s.status === "create");
  const existing = plan.signatures.filter((s) => s.status === "already_present");
  lines.push("");
  lines.push(`detect-portscan chain ${plan.chainPreexisted ? "reused" : "created"}.`);
  lines.push(
    `Jump gate (input → ${plan.chainName}, excluding !${a.trusted_list_name}): ${
      plan.jump.present ? "already present." : "installed."
    }`,
  );
  if (plan.defaultDenyIndex !== null) {
    lines.push(`  → positioned BEFORE the input default-deny (rule #${plan.defaultDenyIndex}).`);
  } else {
    lines.push("  → appended after existing management-accept rules (no default-deny found).");
  }
  lines.push("");
  lines.push(
    `Signatures added (${created.length}): ${created.map((s) => s.id).join(", ") || "none"}`,
  );
  lines.push(
    `Signatures already present (${existing.length}): ${existing.map((s) => s.id).join(", ") || "none"}`,
  );

  // Show the exact final rule set inside detect-portscan.
  const finalChain = await executeMikrotikCommand(
    `/ip firewall filter print detail where chain=${DETECT_CHAIN}`,
    ctx,
  );
  lines.push("");
  lines.push(`Final ${DETECT_CHAIN} chain:`);
  lines.push(finalChain.trim() || "(empty)");

  if (plan.missingDefaultDeny) {
    lines.push("");
    lines.push(
      "OBSERVATION (out of scope, not fixed here): this device's input chain has NO default-deny — " +
        "anything not explicitly accepted is allowed (RouterOS default policy).",
    );
  }

  lines.push("");
  lines.push(
    "ACTION REQUIRED: verify your management access (SSH/Winbox/whatever you use) from a SEPARATE, " +
      "FRESH connection now, before considering this change final. Safe Mode's auto-revert is the " +
      `safety net, but confirm you are not locked out. Roll back with: diff_config_snapshots ` +
      `from=${snapshotId} to=live`,
  );
  return lines.join("\n");
}
