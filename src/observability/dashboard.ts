/**
 * Real-time observability dashboard server.
 *
 * Runs on its own `Bun.serve` instance (independent of the MCP transport) and
 * exposes:
 *   • `GET /`                 the single-page dashboard (built UI, inlined)
 *   • `GET /api/events`       filtered, paginated event list
 *   • `GET /api/event/:id`    one event with full (redacted) bodies
 *   • `GET /api/stats`        computed analytics over a time window
 *   • `GET /api/meta`         facets (tools/devices) + counts for filters
 *   • `GET /api/stream`       WebSocket: live push of every new event
 *   • `GET /health`           liveness probe
 *
 * It reads from the same SQLite store the recorder writes to, and subscribes to
 * the recorder for the live WebSocket feed. An optional bearer token gates every
 * route (page, API and WebSocket via `?token=`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "bun";
import type { Server, ServerWebSocket } from "bun";
import type { DashboardConfig } from "../config";
import { getConfig } from "../core/runtime";
import { logger } from "../logger";
import { UI_DIST_DIR } from "../paths";
import { redact } from "./event";
import type { Risk, ToolEvent } from "./event";
import { getDeviceStatus, startHealthChecks, stopHealthChecks } from "./health";
import { configureRecorder, getEventStore, subscribe, subscriberCount } from "./recorder";
import { openSqliteStore } from "./store";
import type { EventFilter, EventStore } from "./store";
import { computeStats } from "./stats";

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
    const a = map.get(e.device) ?? { calls: 0, errors: 0, lastSeen: 0, sumMs: 0 };
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
    activity: activity.get(name) ?? { calls: 0, errors: 0, lastSeen: 0, avgMs: 0 },
  }));
  return { server: SERVER_TAG, defaultDevice: cfg.defaultDevice, devices };
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

  const tokenOk = (req: Request, url: URL): boolean => {
    if (!cfg.token) return true;
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    return bearer === cfg.token || url.searchParams.get("token") === cfg.token;
  };

  const server = serve<SocketData>({
    hostname: cfg.host,
    port: cfg.port,
    idleTimeout: 0,
    fetch(req, srv) {
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

      const db = getEventStore();
      if (!db) return json({ error: "recorder not active" }, 503);

      if (url.pathname === "/api/devices") {
        return json(devicesPayload(db));
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

  logger.info(
    `Observability dashboard ready on http://${cfg.host}:${cfg.port} ` +
      `(db=${cfg.dbPath}, capture=${cfg.captureBody ? "on" : "off"}${cfg.token ? ", token required" : ""})`,
  );

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
