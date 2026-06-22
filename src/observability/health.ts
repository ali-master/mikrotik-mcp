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
}

const statuses = new Map<string, DeviceStatus>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

const UNKNOWN: DeviceStatus = { reachable: null, checkedAt: null, latencyMs: null };

/** The most recent probe result for a device (UNKNOWN until first probe). */
export function getDeviceStatus(name: string): DeviceStatus {
  return statuses.get(name) ?? UNKNOWN;
}

/** Probe one device once and cache the result. */
export async function probeDevice(name: string, dc: DeviceConfig): Promise<DeviceStatus> {
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
      const version = parseKeyValues(await client.run("/system resource print")).version;
      status = {
        reachable: true,
        checkedAt: Date.now(),
        latencyMs: Date.now() - t0,
        identity,
        version,
      };
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
