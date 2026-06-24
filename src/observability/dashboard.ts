/**
 * Real-time observability dashboard server.
 *
 * Runs on its own `Bun.serve` instance (independent of the MCP transport) and
 * exposes:
 *   • `GET /`                 the single-page dashboard (built UI, inlined)
 *   • `GET /api/events`       filtered, paginated event list
 *   • `DELETE /api/events`    delete selected events (`{ids:[...]}`) or all (`{all:true}`)
 *   • `GET /api/event/:id`    one event with full (redacted) bodies
 *   • `GET /api/stats`        computed analytics over a time window
 *   • `GET /api/topology`     live Layer-2 map (devices + discovered neighbours)
 *   • `*   /api/capture/*`    live packet capture: status, packets, pcap, start/stop
 *   • `GET /api/meta`         facets (tools/devices) + counts for filters
 *   • `GET /api/stream`       WebSocket: live push of every new event
 *   • `GET /health`           liveness probe
 *
 * It reads from the same SQLite store the recorder writes to, and subscribes to
 * the recorder for the live WebSocket feed. An optional bearer token gates every
 * route (page, API and WebSocket via `?token=`).
 */
import { readFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { serve } from "bun";
import type { Server, ServerWebSocket } from "bun";
import { z } from "zod";
import {
  DEFAULT_SNAPSHOT_DB,
  DeviceConfigSchema,
  MikrotikConfigSchema,
  getConfigSource,
} from "../config";
import type { DashboardConfig } from "../config";
import { atomicWrite, mergeSecrets, serializeConfig } from "../config-write";
import { buildChangePlan, renderPlan, splitCommands } from "../core/change-plan";
import { diffLines } from "../core/diff";
import { getS3Client, isS3Configured, presignExpiresIn, s3Target } from "../core/s3";
import { createLocalBackup } from "../backups/create";
import { restoreLocalBackup } from "../backups/restore";
import {
  backupDir,
  deleteBackup,
  listBackups,
  readBackup,
  renameBackup,
  writeBackup,
} from "../backups/vault";
import { createContext } from "../core/context";
import { normalizeExport } from "../snapshots/format";
import { openSnapshotStore } from "../snapshots/store";
import type { SnapshotStore } from "../snapshots/store";
import { getConfig, resolveDeviceName, setConfig } from "../core/runtime";
import { logger } from "../logger";
import { UI_DIST_DIR } from "../paths";
import { createConfigAdmin, validateConfig } from "./config-admin";
import type { ConfigAdmin } from "./config-admin";
import {
  AUTO_RETENTION,
  deleteVersion,
  historyBytes,
  isEmpty as historyIsEmpty,
  listVersions,
  readVersion,
  recordVersion,
} from "./config-history";
import { redact } from "./event";
import type { Risk, ToolEvent } from "./event";
import {
  getDeviceHistory,
  getDeviceNeighbors,
  getDeviceStatus,
  probeDevice,
  startHealthChecks,
  stopHealthChecks,
} from "./health";
import { configureRecorder, getEventStore, subscribe, subscriberCount } from "./recorder";
import { openSqliteStore } from "./store";
import type { EventFilter, EventStore } from "./store";
import { computeStats } from "./stats";
import { buildTopology } from "./topology";
import { capture, DEFAULT_TZSP_PORT } from "./capture";

const SERVER_TAG = "mikrotik-mcp";

interface SocketData {
  unsub?: () => void;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** The built dashboard HTML, or a helpful placeholder if it isn't built yet. */
function dashboardHtml(): string {
  try {
    return readFileSync(join(UI_DIST_DIR, "observability.html"), "utf8");
  } catch {
    return `<!doctype html><meta charset=utf-8><body style="font:14px system-ui;padding:24px;background:#0b0d10;color:#e8eaed">
<h2>MikroTik MCP — Observability Dashboard</h2>
<p style="color:#9aa3af">The dashboard UI hasn't been built yet. Run <code style="color:#7c9cff">bun run build:ui</code> and restart.</p>
<p style="color:#9aa3af">The API is live: try <a style="color:#7c9cff" href="/api/stats">/api/stats</a> or <a style="color:#7c9cff" href="/api/events">/api/events</a>.</p>`;
  }
}

/** Parse the event filter from the query string. */
function filterFromQuery(url: URL): EventFilter {
  const q = url.searchParams;
  const num = (k: string): number | undefined => {
    const v = q.get(k);
    return v == null || v === "" ? undefined : Number(v);
  };
  const status = q.get("status");
  return {
    limit: num("limit"),
    offset: num("offset"),
    tool: q.get("tool") || undefined,
    risk: (q.get("risk") as Risk) || undefined,
    device: q.get("device") || undefined,
    status: status === "ok" || status === "error" ? status : undefined,
    q: q.get("q") || undefined,
    since: num("since"),
    until: num("until"),
  };
}

/** Derive filter facets (tool/device lists) from a bounded recent window. */
function facets(store: EventStore): { tools: string[]; devices: string[] } {
  const recent = store.query({ limit: 5000 });
  const tools = new Set<string>();
  const devices = new Set<string>();
  for (const e of recent) {
    tools.add(e.tool);
    if (e.device) devices.add(e.device);
  }
  return {
    tools: [...tools].sort(),
    devices: [...devices].sort(),
  };
}

/** Per-device activity rolled up from recent events. */
function deviceActivity(
  store: EventStore,
): Map<string, { calls: number; errors: number; lastSeen: number; avgMs: number }> {
  const recent = store.query({ limit: 5000 });
  const map = new Map<string, { calls: number; errors: number; lastSeen: number; sumMs: number }>();
  for (const e of recent) {
    if (!e.device) continue;
    const a = map.get(e.device) ?? {
      calls: 0,
      errors: 0,
      lastSeen: 0,
      sumMs: 0,
    };
    a.calls++;
    if (e.isError) a.errors++;
    a.lastSeen = Math.max(a.lastSeen, e.ts);
    a.sumMs += e.durationMs;
    map.set(e.device, a);
  }
  const out = new Map<string, { calls: number; errors: number; lastSeen: number; avgMs: number }>();
  for (const [k, a] of map) {
    out.set(k, {
      calls: a.calls,
      errors: a.errors,
      lastSeen: a.lastSeen,
      avgMs: a.sumMs / a.calls,
    });
  }
  return out;
}

/** Configured devices + connectivity status + recent activity (no secrets). */
function devicesPayload(store: EventStore): unknown {
  const cfg = getConfig();
  const activity = deviceActivity(store);
  const devices = Object.entries(cfg.devices).map(([name, dc]) => ({
    name,
    host: dc.host,
    port: dc.port,
    // A `mac` device is reached over Layer-2 MAC-Telnet, not SSH — surface that
    // so the dashboard shows the MAC instead of the unused default host:port.
    mac: dc.mac,
    transport: dc.mac ? "mac-telnet" : "ssh",
    address: dc.mac ? dc.mac : `${dc.host}:${dc.port}`,
    username: dc.username,
    authMode: dc.mac
      ? "mac-telnet"
      : dc.keyFilename || dc.privateKey
        ? "key"
        : dc.password
          ? "password"
          : "none",
    isDefault: name === cfg.defaultDevice,
    description: dc.description,
    status: getDeviceStatus(name),
    history: getDeviceHistory(name),
    activity: activity.get(name) ?? {
      calls: 0,
      errors: 0,
      lastSeen: 0,
      avgMs: 0,
    },
  }));
  return { server: SERVER_TAG, defaultDevice: cfg.defaultDevice, devices };
}

/** Live Layer-2 topology built from each device's discovered neighbour cache. */
function topologyPayload(): unknown {
  const cfg = getConfig();
  const devices = Object.entries(cfg.devices).map(([name, config]) => ({
    name,
    config,
    status: getDeviceStatus(name),
  }));
  const neighborsByDevice: Record<string, ReturnType<typeof getDeviceNeighbors>> = {};
  for (const { name } of devices) neighborsByDevice[name] = getDeviceNeighbors(name);
  return {
    server: SERVER_TAG,
    defaultDevice: cfg.defaultDevice,
    generatedAt: Date.now(),
    ...buildTopology({ devices, neighborsByDevice }),
  };
}

/** Effective runtime configuration, with every secret redacted. */
function configPayload(): unknown {
  const cfg = getConfig();
  return redact({
    devices: cfg.devices,
    defaultDevice: cfg.defaultDevice,
    mcp: cfg.mcp,
    dashboard: cfg.dashboard,
    readOnly: cfg.readOnly,
    s3: cfg.s3,
  });
}

/**
 * A Server-Sent Events response that streams every new tool call. Built on a
 * Web-standard `ReadableStream` (Bun serves it natively): we subscribe to the
 * recorder on `start`, push `data:` frames per event with periodic keep-alive
 * comments, and unsubscribe on `cancel` when the client disconnects.
 */
function sseResponse(transportLabel: string): Response {
  let unsub: (() => void) | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (text: string): void => {
        try {
          controller.enqueue(enc.encode(text));
        } catch {
          /* stream closed */
        }
      };
      send(`event: hello\ndata: ${JSON.stringify({ transport: transportLabel })}\n\n`);
      unsub = subscribe((e: ToolEvent) => send(`event: tool\ndata: ${JSON.stringify(e)}\n\n`));
      ping = setInterval(() => send(`: ping\n\n`), 15_000);
    },
    cancel() {
      unsub?.();
      if (ping) clearInterval(ping);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

// ── Config Studio API ────────────────────────────────────────────────────────
/** Parse a JSON request body, or `undefined` on empty/invalid input. */
async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** The live JSON Schema for the config (computed from the Zod schema, never stale). */
function configSchemaJson(): unknown {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "MikrotikConfig",
    ...z.toJSONSchema(MikrotikConfigSchema, { target: "draft-2020-12" }),
  };
}

/** Clamp a requested rollback window to a sane range (default 60s, max 10min). */
function clampRollback(v: unknown): number {
  const n = typeof v === "number" ? v : 60_000;
  return Math.max(0, Math.min(600_000, n));
}

function issues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message }));
}

/**
 * Handle every Config Studio route. Returns a `Response` when it owns the path,
 * or `null` to let the main router continue. All writes go through `admin`, which
 * backs up + arms an auto-rollback; secrets are merged back in from the live
 * config before validation so the browser never has to hold them.
 */
async function configRoutes(req: Request, url: URL, admin: ConfigAdmin): Promise<Response | null> {
  const p = url.pathname;

  if (p === "/api/config-schema" && req.method === "GET") {
    return json(configSchemaJson());
  }

  if (p === "/api/config/validate" && req.method === "POST") {
    const merged = mergeSecrets(await readJson(req), getConfig());
    return json(validateConfig(merged));
  }

  if (p === "/api/config/test-device" && req.method === "POST") {
    const body = (await readJson(req)) as { name?: string; config?: unknown };
    const name = typeof body?.name === "string" ? body.name : "(unsaved)";
    const currentDc = (getConfig().devices as Record<string, unknown>)[name];
    const merged = mergeSecrets(body?.config, currentDc);
    const parsed = DeviceConfigSchema.safeParse(merged);
    if (!parsed.success) return json({ ok: false, errors: issues(parsed.error) }, 400);
    const status = await probeDevice(`config-test:${name}`, parsed.data);
    return json({ ok: true, status });
  }

  if (p === "/api/config/preview" && req.method === "POST") {
    const before = JSON.stringify(redact(getConfig()), null, 2);
    const after = JSON.stringify((await readJson(req)) ?? {}, null, 2);
    const d = diffLines(before, after, { fromLabel: "current", toLabel: "edited" });
    return json({ summary: d.summary, unified: d.unified });
  }

  if (p === "/api/config" && req.method === "POST") {
    const body = (await readJson(req)) as { config?: unknown; rollbackMs?: unknown };
    const merged = mergeSecrets(body?.config, getConfig());
    const v = validateConfig(merged);
    if (!v.ok || !v.value) return json({ ok: false, errors: v.errors }, 400);

    const prev = getConfig();
    const before = JSON.stringify(redact(prev), null, 2);
    const after = JSON.stringify(redact(v.value), null, 2);
    const diff = diffLines(before, after, { fromLabel: "current", toLabel: "saved" });
    // Adding/removing a device name needs an MCP client reconnect to surface in
    // the tool `device` enum — flag it so the UI can warn.
    const prevDevs = Object.keys(prev.devices);
    const nextDevs = Object.keys(v.value.devices);
    const devicesChanged =
      prevDevs.length !== nextDevs.length || prevDevs.some((d) => !nextDevs.includes(d));

    const res = admin.applyConfig(v.value, clampRollback(body?.rollbackMs));
    return json({ ok: true, ...res, devicesChanged, summary: diff.summary, unified: diff.unified });
  }

  if (p === "/api/config/keep" && req.method === "POST") {
    const body = (await readJson(req)) as { pendingId?: string };
    const kept = admin.keepConfig(String(body?.pendingId ?? ""));
    // A kept change is now permanent — snapshot it to the version timeline.
    if (kept) recordVersion(getConfig(), "auto", Date.now());
    return json({ kept });
  }

  if (p === "/api/config/rollback" && req.method === "POST") {
    const body = (await readJson(req)) as { pendingId?: string };
    const rolledBack = admin.rollback(String(body?.pendingId ?? ""));
    return json({ rolledBack, config: redact(getConfig()) });
  }

  // ── Config version history (point-in-time snapshots) ───────────────────────
  if (p === "/api/config/history" && req.method === "GET") {
    const current = JSON.stringify(redact(getConfig()), null, 2);
    const versions = listVersions().map((v) => {
      let added = 0;
      let removed = 0;
      try {
        const vc = JSON.stringify(redact(readVersion(v.id).config), null, 2);
        const d = diffLines(vc, current);
        added = d.summary.added;
        removed = d.summary.removed;
      } catch {
        /* drift stays 0 for an unreadable version */
      }
      return { ...v, drift: { added, removed } };
    });
    return json({ versions, bytes: historyBytes(), retention: AUTO_RETENTION });
  }

  if (p === "/api/config/history/get" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "id required" }, 400);
    try {
      const v = readVersion(id);
      return json({
        ts: v.ts,
        kind: v.kind,
        label: v.label,
        config: JSON.stringify(redact(v.config), null, 2),
      });
    } catch {
      return json({ error: "not found" }, 404);
    }
  }

  if (p === "/api/config/history/diff" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "id required" }, 400);
    try {
      const before = JSON.stringify(redact(readVersion(id).config), null, 2);
      const after = JSON.stringify(redact(getConfig()), null, 2);
      const d = diffLines(before, after, { fromLabel: "this version", toLabel: "current" });
      return json({ summary: d.summary, unified: d.unified });
    } catch {
      return json({ error: "not found" }, 404);
    }
  }

  if (p === "/api/config/history/checkpoint" && req.method === "POST") {
    const b = (await readJson(req)) as { label?: string };
    const label = b?.label?.trim() || "checkpoint";
    return json({ ok: true, version: recordVersion(getConfig(), "checkpoint", Date.now(), label) });
  }

  if (p === "/api/config/history/restore" && req.method === "POST") {
    const b = (await readJson(req)) as { id?: string };
    if (!b?.id) return json({ error: "id required" }, 400);
    let target;
    try {
      target = readVersion(b.id);
    } catch {
      return json({ error: "not found" }, 404);
    }
    const v = validateConfig(target.config);
    if (!v.ok || !v.value) return json({ ok: false, errors: v.errors }, 400);
    // Snapshot the current state first so the restore itself is reversible.
    recordVersion(getConfig(), "auto", Date.now(), "before restore");
    setConfig(v.value);
    let persisted = true;
    try {
      atomicWrite(getConfigSource().path, serializeConfig(v.value));
    } catch {
      persisted = false;
    }
    const label = target.label ? `restored "${target.label}"` : `restored ${b.id}`;
    recordVersion(getConfig(), "auto", Date.now(), label);
    return json({ ok: true, persisted, restored: b.id, config: redact(getConfig()) });
  }

  if (p === "/api/config/history/delete" && req.method === "POST") {
    const b = (await readJson(req)) as { id?: string };
    if (!b?.id) return json({ error: "id required" }, 400);
    return deleteVersion(b.id) ? json({ ok: true }) : json({ error: "not found" }, 404);
  }

  return null;
}

// ── Packet Capture Studio API ────────────────────────────────────────────────
/**
 * Routes for the live capture view: status/stats, the recent-packet ring, a
 * pcap download, and start/stop of the host-side TZSP receiver (the device-side
 * mirror is configured by the start_packet_capture tool).
 */
async function captureRoutes(req: Request, url: URL): Promise<Response | null> {
  const p = url.pathname;
  if (p === "/api/capture/status" && req.method === "GET") {
    return json(capture.stats());
  }
  if (p === "/api/capture/packets" && req.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 200) || 200;
    return json({ packets: capture.recent(limit), stats: capture.stats() });
  }
  if (p === "/api/capture/pcap" && req.method === "GET") {
    return new Response(capture.pcap(), {
      headers: {
        "content-type": "application/vnd.tcpdump.pcap",
        "content-disposition": `attachment; filename="capture.pcap"`,
      },
    });
  }
  if (p === "/api/capture/start" && req.method === "POST") {
    const body = (await readJson(req)) as { port?: number };
    return json(
      await capture.start(typeof body?.port === "number" ? body.port : DEFAULT_TZSP_PORT),
    );
  }
  if (p === "/api/capture/stop" && req.method === "POST") {
    capture.stop();
    return json({ ok: true, ...capture.stats() });
  }
  return null;
}

// Lazily open the config-snapshot store (shared with the snapshot tools), so the
// SQLite handle isn't created unless the Snapshots page is actually used.
let snapStorePromise: Promise<SnapshotStore> | null = null;
function snapStore(): Promise<SnapshotStore> {
  if (!snapStorePromise) snapStorePromise = openSnapshotStore(DEFAULT_SNAPSHOT_DB);
  return snapStorePromise;
}

/**
 * Read-only feature pages that surface existing MCP capabilities in the dashboard:
 *   • `/api/snapshots*` — config-snapshot history + time-travel diff (local store).
 *   • `/api/plan`        — a terraform-style dry-run of intended RouterOS commands
 *     (pure `buildChangePlan`, never touches a device).
 */
async function featureRoutes(req: Request, url: URL): Promise<Response | null> {
  const p = url.pathname;

  // ── Config snapshots ──────────────────────────────────────────────────────
  if (p === "/api/snapshots" && req.method === "GET") {
    const store = await snapStore();
    const cfg = getConfig();
    const all = Object.keys(cfg.devices).flatMap((d) => store.list(d, 200, false));
    all.sort((a, b) => b.ts - a.ts);
    return json({ snapshots: all });
  }
  const snapMatch = p.match(/^\/api\/snapshot\/(.+)$/);
  if (snapMatch && req.method === "GET") {
    const store = await snapStore();
    const s = store.get(decodeURIComponent(snapMatch[1] as string));
    return s ? json(s) : json({ error: "not found" }, 404);
  }
  if (p === "/api/snapshots/diff" && req.method === "POST") {
    const store = await snapStore();
    const b = (await readJson(req)) as { from?: string; to?: string };
    const from = b?.from ? store.get(b.from) : null;
    const to = b?.to ? store.get(b.to) : null;
    if (!from || !to) {
      return json({ error: "both 'from' and 'to' snapshot ids are required" }, 400);
    }
    // Diff the normalised exports so the volatile header line is ignored.
    const diff = diffLines(normalizeExport(from.body), normalizeExport(to.body), {
      fromLabel: from.label ?? from.id,
      toLabel: to.label ?? to.id,
    });
    return json({
      from: { id: from.id, label: from.label, ts: from.ts, device: from.device },
      to: { id: to.id, label: to.label, ts: to.ts, device: to.device },
      summary: diff.summary,
      unified: diff.unified,
    });
  }

  // ── Change plan (dry-run; pure, no device I/O) ────────────────────────────
  if (p === "/api/plan" && req.method === "POST") {
    const b = (await readJson(req)) as { commands?: string[]; script?: string };
    const commands = [
      ...(b?.commands ?? []).map((c) => c.trim()).filter(Boolean),
      ...(b?.script ? splitCommands(b.script) : []),
    ];
    if (commands.length === 0) return json({ error: "no commands provided" }, 400);
    const plan = buildChangePlan(commands);
    return json({ plan, text: renderPlan(plan) });
  }

  // ── S3 backup management (list / read / delete) ───────────────────────────
  if (p === "/api/s3" && req.method === "GET") {
    return json({ configured: isS3Configured(), target: isS3Configured() ? s3Target() : null });
  }
  if (p === "/api/s3/list" && req.method === "GET") {
    if (!isS3Configured()) return json({ configured: false, objects: [] });
    const prefix = url.searchParams.get("prefix") ?? "";
    try {
      const res = await getS3Client().list({ prefix: prefix || undefined, maxKeys: 1000 });
      const objects = (res.contents ?? []).map((o) => ({
        key: o.key,
        size: o.size ?? 0,
        lastModified: o.lastModified ?? null,
      }));
      return json({ configured: true, target: s3Target(), objects, truncated: !!res.isTruncated });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  }
  if (p === "/api/s3/presign" && req.method === "GET") {
    if (!isS3Configured()) return json({ error: "S3 not configured" }, 400);
    const key = url.searchParams.get("key");
    if (!key) return json({ error: "key required" }, 400);
    try {
      // A short-lived GET URL the browser can open to download/read the object.
      const link = getS3Client().presign(key, { expiresIn: presignExpiresIn(), method: "GET" });
      return json({ url: link });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  }
  if (p === "/api/s3/delete" && req.method === "POST") {
    if (!isS3Configured()) return json({ error: "S3 not configured" }, 400);
    const b = (await readJson(req)) as { key?: string };
    if (!b?.key) return json({ error: "key required" }, 400);
    try {
      const client = getS3Client();
      if (!(await client.exists(b.key))) return json({ error: "not found" }, 404);
      await client.delete(b.key);
      return json({ ok: true, key: b.key });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  }

  // ── Local backup vault (create on device side via tools; here: read/manage) ─
  if (p === "/api/backups" && req.method === "GET") {
    return json({
      dir: backupDir(),
      devices: Object.keys(getConfig().devices),
      backups: listBackups(),
    });
  }
  if (p === "/api/backups/dir" && req.method === "POST") {
    const b = (await readJson(req)) as { dir?: string };
    const raw = b?.dir?.trim();
    if (!raw) return json({ error: "dir required" }, 400);
    // Expand a leading ~ so users can type `~/backups` in the dashboard.
    const dir = raw === "~" || raw.startsWith("~/") ? join(homedir(), raw.slice(1)) : raw;
    const next = { ...getConfig(), backupDir: dir };
    setConfig(next);
    // Persist to the config file so the new path survives a restart. If the
    // write fails (read-only fs, no config file), the change still applies live
    // for this process — report that it wasn't persisted rather than failing.
    try {
      atomicWrite(getConfigSource().path, serializeConfig(next));
    } catch (e) {
      return json({
        ok: true,
        dir: backupDir(),
        persisted: false,
        warning: `applied live but not saved: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    recordVersion(getConfig(), "auto", Date.now(), "backup path changed");
    return json({ ok: true, dir: backupDir(), persisted: true });
  }
  if (p === "/api/backups/get" && req.method === "GET") {
    const name = url.searchParams.get("name");
    if (!name) return json({ error: "name required" }, 400);
    try {
      return json({ name, content: readBackup(name) });
    } catch {
      return json({ error: "not found" }, 404);
    }
  }
  if (p === "/api/backups/raw" && req.method === "GET") {
    const name = url.searchParams.get("name");
    if (!name) return new Response("name required", { status: 400 });
    try {
      return new Response(readBackup(name), {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  }
  if (p === "/api/backups/upload" && req.method === "POST") {
    const b = (await readJson(req)) as { name?: string; content?: string };
    if (!b?.name || typeof b.content !== "string") {
      return json({ error: "name and content are required" }, 400);
    }
    try {
      const safe = b.name.endsWith(".rsc") ? b.name : `${b.name}.rsc`;
      return json({ ok: true, name: writeBackup(safe, b.content) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }
  if (p === "/api/backups/rename" && req.method === "POST") {
    const b = (await readJson(req)) as { name?: string; new_name?: string };
    if (!b?.name || !b?.new_name) return json({ error: "name and new_name are required" }, 400);
    try {
      return json({ ok: true, name: renameBackup(b.name, b.new_name) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }
  if (p === "/api/backups/delete" && req.method === "POST") {
    const b = (await readJson(req)) as { name?: string };
    if (!b?.name) return json({ error: "name required" }, 400);
    try {
      return deleteBackup(b.name) ? json({ ok: true }) : json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }
  if (p === "/api/backups/restore" && req.method === "POST") {
    const b = (await readJson(req)) as { name?: string; device?: string; confirm?: boolean };
    if (!b?.name) return json({ error: "name required" }, 400);
    const device = resolveDeviceName(b.device);
    return json(await restoreLocalBackup(device, b.name, b.confirm === true));
  }
  if (p === "/api/backups/create" && req.method === "POST") {
    const b = (await readJson(req)) as {
      device?: string;
      label?: string;
      show_sensitive?: boolean;
    };
    const ctx = createContext(undefined, b?.device);
    const r = await createLocalBackup(ctx, {
      label: b?.label,
      showSensitive: b?.show_sensitive === true,
    });
    return r.ok ? json(r) : json({ error: r.error ?? "export failed" }, 502);
  }

  return null;
}

export interface DashboardHandle {
  server: Server<SocketData>;
  store: EventStore;
  stop(): void;
}

/**
 * Open the store, turn on the recorder, and start the dashboard server. Returns
 * a handle for tests/shutdown. `transportLabel` tags recorded events.
 */
export async function runDashboard(
  cfg: DashboardConfig,
  transportLabel: string,
): Promise<DashboardHandle> {
  const store = await openSqliteStore(cfg.dbPath);
  configureRecorder({
    store,
    capture: {
      captureBody: cfg.captureBody,
      maxBodyBytes: cfg.maxBodyBytes,
      redactInput: cfg.redactInput,
    },
    maxEvents: cfg.maxEvents,
    transport: transportLabel,
  });

  // Periodically probe each configured device's SSH reachability for the
  // connectivity graph/status (one immediate pass, then every 30s).
  startHealthChecks(30_000);

  // Seed an initial config baseline so the version timeline always has at least
  // one restore point (the state the dashboard started with).
  try {
    if (historyIsEmpty()) recordVersion(getConfig(), "auto", Date.now(), "baseline");
  } catch (e) {
    logger.warn(`[${SERVER_TAG}] could not seed config history baseline: ${String(e)}`);
  }

  // Config Studio: a safe-apply state machine bound to real fs/clock/timers. It
  // backs up the config file, hot-swaps via setConfig, and auto-reverts unless
  // the dashboard confirms within the rollback window.
  const configAdmin = createConfigAdmin({
    getConfig,
    setConfig,
    source: getConfigSource,
    readFile: (pth) => {
      try {
        return readFileSync(pth, "utf8");
      } catch {
        return null;
      }
    },
    writeText: atomicWrite,
    now: Date.now,
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (h) => {
      if (h) clearTimeout(h as ReturnType<typeof setTimeout>);
    },
  });

  const tokenOk = (req: Request, url: URL): boolean => {
    if (!cfg.token) return true;
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    return bearer === cfg.token || url.searchParams.get("token") === cfg.token;
  };

  const server = serve<SocketData>({
    hostname: cfg.host,
    port: cfg.port,
    idleTimeout: 0,
    async fetch(req, srv) {
      const url = new URL(req.url);

      if (url.pathname === "/health") return new Response("OK");

      if (!tokenOk(req, url)) {
        return new Response("Unauthorized", { status: 401 });
      }

      // Live event stream — Bun-native WebSocket (preferred).
      if (url.pathname === "/api/stream") {
        if (srv.upgrade(req, { data: {} })) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Live event stream — Server-Sent Events (the front-end's automatic
      // fallback when WebSocket can't connect, e.g. through some proxies).
      if (url.pathname === "/api/sse") {
        return sseResponse(transportLabel);
      }

      // Config Studio routes are independent of the event store, so dispatch
      // them before the recorder guard below.
      const configResp = await configRoutes(req, url, configAdmin);
      if (configResp) return configResp;

      const captureResp = await captureRoutes(req, url);
      if (captureResp) return captureResp;

      const featureResp = await featureRoutes(req, url);
      if (featureResp) return featureResp;

      const db = getEventStore();
      if (!db) return json({ error: "recorder not active" }, 503);

      // Delete selected events (`{ ids: [...] }`) or every event (`{ all: true }`).
      // Gated by the same bearer token as every other route (checked above).
      if (url.pathname === "/api/events" && req.method === "DELETE") {
        let body: { ids?: unknown; all?: unknown } = {};
        try {
          body = (await req.json()) as typeof body;
        } catch {
          /* empty / invalid body → no-op selection */
        }
        const ids = Array.isArray(body.ids)
          ? body.ids.filter((x): x is string => typeof x === "string")
          : [];
        const removed = body.all === true ? db.clear() : db.delete(ids);
        return json({ removed, total: db.total() });
      }

      if (url.pathname === "/api/devices") {
        return json(devicesPayload(db));
      }

      if (url.pathname === "/api/topology") {
        return json(topologyPayload());
      }

      if (url.pathname === "/api/config") {
        return json(configPayload());
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(dashboardHtml(), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/api/meta") {
        const f = facets(db);
        return json({
          ...f,
          risks: ["READ", "WRITE", "WRITE_IDEMPOTENT", "DESTRUCTIVE", "DANGEROUS"],
          total: db.total(),
          liveClients: subscriberCount(),
          transport: transportLabel,
        });
      }

      if (url.pathname === "/api/events") {
        const filter = filterFromQuery(url);
        return json({ events: db.query(filter), total: db.total() });
      }

      const eventMatch = url.pathname.match(/^\/api\/event\/(.+)$/);
      if (eventMatch) {
        const e = db.get(decodeURIComponent(eventMatch[1]));
        return e ? json(e) : json({ error: "not found" }, 404);
      }

      if (url.pathname === "/api/stats") {
        const now = Date.now();
        const windowMs = Number(url.searchParams.get("window") ?? 3_600_000);
        const buckets = Number(url.searchParams.get("buckets") ?? 60);
        const events = db.query({ since: now - windowMs, limit: 5000 });
        return json(computeStats(events, { now, windowMs, buckets }));
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws: ServerWebSocket<SocketData>) {
        ws.data.unsub = subscribe((e: ToolEvent) => {
          try {
            ws.send(JSON.stringify({ type: "event", event: e }));
          } catch {
            // client went away mid-send; close() will clean up
          }
        });
        ws.send(JSON.stringify({ type: "hello", transport: transportLabel }));
      },
      message() {
        // The dashboard is push-only; inbound messages are ignored (keep-alive).
      },
      close(ws: ServerWebSocket<SocketData>) {
        ws.data.unsub?.();
      },
    },
  });

  // When bound to all interfaces, "0.0.0.0" isn't a usable URL — surface the
  // actual LAN addresses so the dashboard can be opened from another device.
  const wildcard = cfg.host === "0.0.0.0" || cfg.host === "::";
  const urls = wildcard
    ? [
        `http://localhost:${cfg.port}`,
        ...Object.values(networkInterfaces())
          .flat()
          .filter((a) => a && a.family === "IPv4" && !a.internal)
          .map((a) => `http://${a!.address}:${cfg.port}`),
      ].join("  ")
    : `http://${cfg.host}:${cfg.port}`;
  logger.info(
    `Observability dashboard ready — open ${urls} ` +
      `(db=${cfg.dbPath}, capture=${cfg.captureBody ? "on" : "off"}${cfg.token ? ", token required" : ""})`,
  );
  if (wildcard && !cfg.token) {
    logger.warn(
      "Dashboard is bound to all network interfaces with no token — anyone on your LAN can view it and edit device config. Set dashboard.token (or --dashboard-token) to require auth.",
    );
  }

  return {
    server,
    store,
    stop() {
      stopHealthChecks();
      void server.stop(true);
      store.close();
    },
  };
}
