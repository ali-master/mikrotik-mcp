/**
 * Usage sampler — the background job that fills {@link UsageStore}.
 *
 * On a slow interval (default 10 min) it walks every SSH-reachable configured
 * device and, per device:
 *   • snapshots each `/queue simple` cumulative counter (per-client download/
 *     upload) into `usage_samples`, and
 *   • ingests `/user-manager session` accounting records (de-duped by accounting
 *     id) into `vpn_sessions` — so the 3-month usage graphs and the forever
 *     connection heatmap keep accumulating even when nobody's watching.
 *
 * MAC-Telnet devices are skipped: a Layer-2 login is slow and serialises with
 * real tool calls, so we never sample them on a timer. Failures are swallowed
 * per device (offline routers must not stop the others).
 *
 * This module is only ever imported by the dashboard server, never by the tool/
 * registry/test graph, so it may freely pull in the device I/O layer.
 */
import { executeMikrotikCommand } from "../core/connector";
import { createContext } from "../core/context";
import { commandUnsupported, isEmpty, looksLikeError } from "../core/routeros";
import {
  parseLeadingNumber,
  parseRecords,
  parseRouterosDate,
  parseSize,
} from "../core/routeros-parse";
import { getConfig } from "../core/runtime";
import { logger } from "../logger";
import type { UsageStore, VpnSession } from "./usage-store";

const SERVER_TAG = "mikrotik-mcp";
/** Keep ~3 months of client snapshots; sessions are kept forever by the store. */
export const USAGE_RETENTION_MS = 93 * 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

/** Bytes from a RouterOS size/number field (`"12345"` or `"1.2MiB"`). */
function bytesOf(v: string | undefined): number {
  return parseSize(v) ?? parseLeadingNumber(v) ?? 0;
}

/** Strip a `/32`-style mask so the queue target matches the client IP. */
function ipOf(target: string): string {
  return (target ?? "").split("/")[0]?.trim() ?? "";
}

/** Snapshot every simple queue's cumulative counters for one device. */
async function sampleClients(store: UsageStore, device: string, ts: number): Promise<void> {
  const ctx = createContext(undefined, device);
  const out = await executeMikrotikCommand("/queue simple print stats detail", ctx);
  if (isEmpty(out) || looksLikeError(out) || commandUnsupported(out)) return;
  const samples: { ip: string; rx: number; tx: number }[] = [];
  for (const row of parseRecords(out).rows) {
    const ip = ipOf(row.target ?? "");
    if (!ip) continue;
    // `bytes` is RouterOS's `upload/download` (tx/rx).
    const [tx, rx] = (row.bytes ?? "0/0").split("/");
    samples.push({ ip, rx: bytesOf(rx), tx: bytesOf(tx) });
  }
  store.recordClientSamples(device, ts, samples);
}

/** Ingest User Manager accounting sessions for one device (deduped by acct id). */
async function ingestSessions(store: UsageStore, device: string): Promise<void> {
  const ctx = createContext(undefined, device);
  const out = await executeMikrotikCommand("/user-manager session print detail", ctx);
  if (isEmpty(out) || looksLikeError(out) || commandUnsupported(out)) return;
  const sessions: VpnSession[] = [];
  for (const row of parseRecords(out).rows) {
    const user = row.user ?? "";
    const started = parseRouterosDate(row.started ?? row["start-time"]);
    if (!user || started == null) continue;
    // A stable identity for de-dup: prefer the RADIUS accounting id, else a
    // composite of the fields that uniquely pin one connection.
    const sessionId =
      row["acct-session-id"] ||
      `${user}|${started}|${row["calling-station-id"] ?? row["nas-port-id"] ?? ""}`;
    sessions.push({
      sessionId,
      user,
      service: row.service,
      nas: row["nas-ip-address"] ?? row["nas-port-id"],
      started,
      rx: bytesOf(row.download),
      tx: bytesOf(row.upload),
    });
  }
  store.upsertSessions(device, sessions);
}

/** One sampling pass across every SSH device (reentrancy-guarded). */
export async function sampleUsageOnce(store: UsageStore): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  const ts = Date.now();
  try {
    const cfg = getConfig();
    await Promise.all(
      Object.entries(cfg.devices).map(async ([name, dc]) => {
        if (dc.mac) return; // skip slow MAC-Telnet devices on the timer
        try {
          await sampleClients(store, name, ts);
          await ingestSessions(store, name);
        } catch (e) {
          logger.warn(`[${SERVER_TAG}] usage sample failed for '${name}': ${String(e)}`);
        }
      }),
    );
    store.pruneSamples(ts - USAGE_RETENTION_MS);
  } finally {
    inFlight = false;
  }
}

/** Start periodic sampling (one immediate pass, then every `intervalMs`). */
export function startUsageSampler(store: UsageStore, intervalMs = 10 * 60_000): void {
  void sampleUsageOnce(store);
  timer = setInterval(() => void sampleUsageOnce(store), intervalMs);
}

/** Stop periodic sampling. */
export function stopUsageSampler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
