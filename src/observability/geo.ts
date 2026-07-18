/**
 * IP geolocation for the dashboard — resolves each configured device's public IP
 * to a country (ISO code) so the UI can show a flag next to it.
 *
 * A device's `host` may be a public IP, a private/LAN IP, or a hostname. Only a
 * PUBLIC address geolocates meaningfully, so private/loopback/link-local ranges
 * (and MAC-Telnet devices, which have no IP) are skipped and yield no flag. The
 * lookup uses the free, key-less ipkit.ir API (falling back to ipquery.io if it
 * doesn't answer) and is cached for a day — a device's country effectively never
 * changes, so we never hammer the endpoint.
 *
 * Like the health probes, this only runs when the dashboard is enabled, so the
 * offline test runner never performs network I/O.
 */
import { lookup } from "node:dns/promises";
import { getConfig } from "../core/runtime";
import { logger } from "../logger";

const LOG_TAG = "mikrotik-mcp";

export interface DeviceGeo {
  /** ISO 3166-1 alpha-2 country code, lowercase (the circle-flags SVG filename). */
  countryCode: string;
  /** Full country name, e.g. "Germany". */
  country: string;
  /** City, when the provider reports one. */
  city?: string;
}

interface Cached {
  geo: DeviceGeo | null; // null = resolved, but no public geo (private IP / failed)
  at: number;
}

const cache = new Map<string, Cached>();
/** Re-resolve at most once a day — a device's country is effectively static. */
const REFRESH_MS = 24 * 60 * 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

/** The most recent geolocation for a device (null until resolved / when private). */
export function getDeviceGeo(name: string): DeviceGeo | null {
  return cache.get(name)?.geo ?? null;
}

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
// Non-routable ranges that geolocation can't place: RFC1918, loopback,
// link-local, "this network", CGNAT, and IPv6 loopback/ULA.
const PRIVATE_RE =
  /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|f[cd])/i;

function isIpLiteral(host: string): boolean {
  return IPV4_RE.test(host) || host.includes(":");
}

/**
 * True for a routable, geolocatable public IP literal. A non-IP host (hostname)
 * or a private/loopback/link-local/CGNAT address returns false — we never send
 * those to the geo provider, they can't be placed anyway.
 */
export function isPublicIpLiteral(host: string): boolean {
  return isIpLiteral(host) && !PRIVATE_RE.test(host);
}

/** Resolve a host to a routable PUBLIC IP, or null when private/unresolvable. */
async function publicIpOf(host: string): Promise<string | null> {
  let ip = host;
  if (!isIpLiteral(host)) {
    try {
      ip = (await lookup(host)).address;
    } catch {
      return null; // unresolvable hostname → no geo
    }
  }
  return PRIVATE_RE.test(ip) ? null : ip;
}

function toGeo(
  country: string | undefined,
  code: string | undefined,
  city: string | undefined,
): DeviceGeo | null {
  if (!code) return null;
  return { countryCode: code.toLowerCase(), country: country ?? code, city: city || undefined };
}

/** Primary provider: ipkit.ir. Content-negotiates, so ask for JSON explicitly. */
async function fetchIpkit(ip: string): Promise<DeviceGeo | null> {
  const res = await fetch(`https://ipkit.ir/${ip}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`ipkit HTTP ${res.status}`);
  const d = (await res.json()) as {
    country?: string;
    country_code?: string;
    city?: string;
    is_private?: boolean;
  };
  if (d.is_private) return null; // provider flags a non-routable IP
  return toGeo(d.country, d.country_code, d.city);
}

/** Fallback provider: ipquery.io (nested under `location`). */
async function fetchIpquery(ip: string): Promise<DeviceGeo | null> {
  const res = await fetch(`https://api.ipquery.io/${ip}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`ipquery HTTP ${res.status}`);
  const d = (await res.json()) as {
    location?: { country?: string; country_code?: string; city?: string };
  };
  return toGeo(d.location?.country, d.location?.country_code, d.location?.city);
}

/** Geolocate a public IP, trying ipkit.ir first and falling back to ipquery.io. */
async function fetchGeo(ip: string): Promise<DeviceGeo | null> {
  try {
    return await fetchIpkit(ip);
  } catch (e) {
    logger.warn(
      `[${LOG_TAG}] ipkit geo failed for ${ip}, trying ipquery: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    return await fetchIpquery(ip);
  } catch (e) {
    logger.warn(
      `[${LOG_TAG}] geo lookup failed for ${ip}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

async function resolveDevice(name: string, host: string | undefined): Promise<void> {
  const ip = host ? await publicIpOf(host) : null;
  const geo = ip ? await fetchGeo(ip) : null;
  cache.set(name, { geo, at: Date.now() });
}

/** Resolve every configured device whose cache entry is missing or stale. */
export async function refreshGeo(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const now = Date.now();
    await Promise.all(
      Object.entries(getConfig().devices).map(([name, dc]) => {
        const c = cache.get(name);
        if (c && now - c.at < REFRESH_MS) return Promise.resolve();
        // MAC-Telnet devices have no IP to geolocate.
        return resolveDevice(name, dc.mac ? undefined : dc.host);
      }),
    );
  } finally {
    inFlight = false;
  }
}

/** Start periodic geo lookups (one immediate pass, then daily). */
export function startGeoLookups(): void {
  void refreshGeo();
  timer = setInterval(() => void refreshGeo(), REFRESH_MS);
}

/** Stop periodic geo lookups. */
export function stopGeoLookups(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
