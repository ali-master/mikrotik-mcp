/**
 * Device connectivity health checks for the dashboard.
 *
 * Periodically opens a short-lived SSH connection to each configured device and
 * caches a {@link DeviceStatus} (reachable? latency? identity/version?). The
 * dashboard's `/api/devices` reads the cache; the SPA renders it as a live
 * connectivity graph + status table. Probes are best-effort and never throw.
 *
 * Only started when the dashboard is enabled, so the SSH client (and `ssh2`) is
 * never exercised by the offline test runner.
 */
import type { DeviceConfig } from "../config";
import { getConfig } from "../core/runtime";
import { parseKeyValues } from "../core/routeros-parse";
import { createDeviceClient } from "../core/transport";
import { parseNeighbors } from "./topology";
import type { Neighbor } from "./topology";

export interface DeviceStatus {
  /** true = reachable, false = unreachable, null = not probed yet. */
  reachable: boolean | null;
  /** Epoch ms of the last probe, or null. */
  checkedAt: number | null;
  /** Round-trip of the probe (connect + identity), ms, when reachable. */
  latencyMs: number | null;
  /** RouterOS identity name, when reachable. */
  identity?: string;
  /** RouterOS version, when reachable. */
  version?: string;
  /** Failure reason, when unreachable. */
  error?: string;
  // ── live system info (from `/system resource print`, when reachable) ──
  /** Board / model name. */
  boardName?: string;
  /** CPU architecture. */
  architecture?: string;
  /** Number of CPU cores. */
  cpuCount?: number;
  /** Current CPU load, percent 0–100. */
  cpuLoad?: number;
  /** Free RAM, bytes. */
  freeMemory?: number;
  /** Total RAM, bytes. */
  totalMemory?: number;
  /** Used RAM, percent 0–100. */
  memUsedPct?: number;
  /** Free disk (HDD) space, bytes. */
  freeHdd?: number;
  /** Total disk (HDD) space, bytes. */
  totalHdd?: number;
  /** Used disk, percent 0–100. */
  hddUsedPct?: number;
  /** Human uptime string (e.g. `1w2d3h`). */
  uptime?: string;
}

/** One sampled point of a device's health, for the realtime sparkline charts. */
export interface MetricSample {
  ts: number;
  cpuLoad: number | null;
  memUsedPct: number | null;
  hddUsedPct: number | null;
  latencyMs: number | null;
}

/** How many samples to keep per device (≈ last 30 min at a 30s cadence). */
const HISTORY_CAP = 60;

const statuses = new Map<string, DeviceStatus>();
const histories = new Map<string, MetricSample[]>();
const neighbors = new Map<string, Neighbor[]>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

const UNKNOWN: DeviceStatus = { reachable: null, checkedAt: null, latencyMs: null };

/** The most recent probe result for a device (UNKNOWN until first probe). */
export function getDeviceStatus(name: string): DeviceStatus {
  return statuses.get(name) ?? UNKNOWN;
}

/** The neighbours (`/ip neighbor`) most recently discovered from a device. */
export function getDeviceNeighbors(name: string): Neighbor[] {
  return neighbors.get(name) ?? [];
}

/** The rolling health-metric history for a device (oldest → newest). */
export function getDeviceHistory(name: string): MetricSample[] {
  return histories.get(name) ?? [];
}

function pushHistory(name: string, sample: MetricSample): void {
  const arr = histories.get(name) ?? [];
  arr.push(sample);
  if (arr.length > HISTORY_CAP) arr.splice(0, arr.length - HISTORY_CAP);
  histories.set(name, arr);
}

/** Parse a RouterOS size string (`256.0MiB`, `1.2GiB`, `12345`) to bytes. */
function parseSize(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.trim().match(/^([\d.]+)\s*([KMGT]i?B|B)?$/i);
  if (!m) return undefined;
  const val = Number.parseFloat(m[1] as string);
  if (!Number.isFinite(val)) return undefined;
  const mult: Record<string, number> = {
    B: 1,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
    KB: 1e3,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
  };
  return val * (mult[(m[2] ?? "B").toUpperCase()] ?? 1);
}

/** Parse a RouterOS percentage string (`5%`, `0`) to a number 0–100. */
function parsePercent(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.trim().match(/^([\d.]+)\s*%?$/);
  return m ? Number.parseFloat(m[1] as string) : undefined;
}

function usedPct(total?: number, free?: number): number | undefined {
  if (total == null || free == null || total <= 0) return undefined;
  return Math.max(0, Math.min(100, ((total - free) / total) * 100));
}

/** Probe one device once and cache the result. */
export async function probeDevice(name: string, dc: DeviceConfig): Promise<DeviceStatus> {
  // MAC-Telnet devices are NOT background-probed. A mac-telnet login is a full
  // ~30s+ console negotiation (RouterOS's stall), and the device serves one such
  // session at a time — a 30s-interval probe would be almost always in flight and
  // would contend with (and starve) real tool calls. We surface a neutral status
  // and let actual tool use prove reachability instead.
  if (dc.mac) {
    const status: DeviceStatus = {
      reachable: null,
      checkedAt: Date.now(),
      latencyMs: null,
      error: "MAC-Telnet device — reachability is verified on tool use, not background-probed.",
    };
    statuses.set(name, status);
    return status;
  }
  // Pick the transport by config (SSH or MAC-Telnet). The 8s probe clamp keeps
  // the SSH path snappy; a MAC-Telnet client floors its own prime budget higher
  // (RouterOS's ~10s console stall), so the clamp simply doesn't shorten it.
  const client = createDeviceClient({
    ...dc,
    timeoutMs: Math.min(dc.timeoutMs ?? 10_000, 8_000),
  });
  const t0 = Date.now();
  let status: DeviceStatus;
  try {
    const ok = await client.connect();
    if (!ok) {
      status = {
        reachable: false,
        checkedAt: Date.now(),
        latencyMs: null,
        error: client.lastError ?? "connection failed",
      };
    } else {
      const identity = parseKeyValues(await client.run("/system identity print")).name;
      // One `/system resource print` yields version AND the live system metrics
      // (cpu / memory / disk / uptime) — no extra round-trips beyond what the
      // reachability probe already did.
      const r = parseKeyValues(await client.run("/system resource print"));
      const checkedAt = Date.now();
      const latencyMs = checkedAt - t0;
      const totalMemory = parseSize(r["total-memory"]);
      const freeMemory = parseSize(r["free-memory"]);
      const totalHdd = parseSize(r["total-hdd-space"]);
      const freeHdd = parseSize(r["free-hdd-space"]);
      const cpuLoad = parsePercent(r["cpu-load"]);
      const memUsedPct = usedPct(totalMemory, freeMemory);
      const hddUsedPct = usedPct(totalHdd, freeHdd);
      const cpuCount = Number.parseInt(r["cpu-count"] ?? "", 10);
      status = {
        reachable: true,
        checkedAt,
        latencyMs,
        identity,
        version: r.version,
        boardName: r["board-name"] || undefined,
        architecture: r["architecture-name"] || undefined,
        cpuCount: Number.isFinite(cpuCount) ? cpuCount : undefined,
        cpuLoad,
        freeMemory,
        totalMemory,
        memUsedPct,
        freeHdd,
        totalHdd,
        hddUsedPct,
        uptime: r.uptime || undefined,
      };
      pushHistory(name, {
        ts: checkedAt,
        cpuLoad: cpuLoad ?? null,
        memUsedPct: memUsedPct ?? null,
        hddUsedPct: hddUsedPct ?? null,
        latencyMs,
      });
      // Reuse the open connection to read this device's MNDP/CDP/LLDP neighbour
      // cache for the live topology map. Best-effort: a failure here must never
      // demote an otherwise-healthy device, so it's caught and the prior list is
      // kept (clearing on a transient error would make the map flicker).
      try {
        neighbors.set(name, parseNeighbors(await client.run("/ip neighbor print detail")));
      } catch {
        /* keep the last known neighbour list */
      }
    }
  } catch (e) {
    status = {
      reachable: false,
      checkedAt: Date.now(),
      latencyMs: null,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    client.disconnect();
  }
  statuses.set(name, status);
  return status;
}

/** Probe every configured device concurrently (reentrancy-guarded). */
export async function probeAll(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const cfg = getConfig();
    await Promise.all(
      Object.entries(cfg.devices).map(([name, dc]) =>
        probeDevice(name, dc).catch(() => {
          /* probeDevice never throws, but stay defensive */
        }),
      ),
    );
  } finally {
    inFlight = false;
  }
}

/** Start periodic health checks (one immediate pass, then every `intervalMs`). */
export function startHealthChecks(intervalMs = 30_000): void {
  void probeAll();
  timer = setInterval(() => void probeAll(), intervalMs);
}

/** Stop periodic health checks. */
export function stopHealthChecks(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
