/**
 * Server update awareness — shared release-check logic for both the
 * observability dashboard and the LLM-facing "pulse" tool.
 *
 * Two cache tiers prevent redundant GitHub API calls:
 *   1. In-memory cache (15-minute TTL) — hot path for the same process.
 *   2. File-based cache at `~/.mikrotik-mcp/update-check.json` (6-hour TTL)
 *      — survives restarts so the next boot gets an instant answer.
 *
 * All functions are non-throwing: network or filesystem errors degrade
 * gracefully and never crash the server.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { VERSION } from "../version";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReleasePayload {
  version: string;
  name: string;
  body: string;
  publishedAt: string;
  url: string;
  isNewer: boolean;
  currentVersion: string;
}

export interface UpdateCheckResult {
  release: ReleasePayload | null;
  checkedAt: number;
  fromCache: boolean;
  error?: string;
}

export type Freshness = "fresh" | "aging" | "stale" | "ancient";

// ── Constants ────────────────────────────────────────────────────────────────

const GITHUB_API = "https://api.github.com/repos/ali-master/mikrotik-mcp/releases/latest";
const MEMORY_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const FILE_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_PATH = join(homedir(), ".mikrotik-mcp", "update-check.json");

// ── Version comparison ───────────────────────────────────────────────────────

/** Semver-ish comparison: returns < 0 / 0 / > 0 (like `a - b`). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── In-memory cache ──────────────────────────────────────────────────────────

let memoryCache: { data: ReleasePayload; fetchedAt: number } | null = null;

// ── File-based persistent cache ──────────────────────────────────────────────

interface FileCache {
  data: ReleasePayload;
  fetchedAt: number;
}

function loadFileCache(maxAge = FILE_CACHE_TTL): ReleasePayload | null {
  try {
    const raw = readFileSync(CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as FileCache;
    if (!parsed?.data?.version || typeof parsed.fetchedAt !== "number") return null;
    if (Date.now() - parsed.fetchedAt > maxAge) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Synchronous cache read for use in `createServer()` (instructions injection).
 * Returns the cached release if the file exists and is within the 6-hour TTL.
 */
export function loadFileCacheSync(): ReleasePayload | null {
  return loadFileCache();
}

function saveFileCache(data: ReleasePayload): void {
  try {
    const dir = dirname(CACHE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ data, fetchedAt: Date.now() } satisfies FileCache));
  } catch {
    // Best-effort; never propagate.
  }
}

// ── GitHub API fetch ─────────────────────────────────────────────────────────

/**
 * Fetch the latest GitHub release. Uses the two-tier cache (memory → file →
 * network). The result is always saved to both caches on a successful fetch.
 */
export async function fetchLatestRelease(): Promise<ReleasePayload> {
  // Tier 1: in-memory cache
  if (memoryCache && Date.now() - memoryCache.fetchedAt < MEMORY_CACHE_TTL) {
    return memoryCache.data;
  }

  // Tier 2: file-based cache (only when memory is cold)
  const fileCached = loadFileCache();
  if (fileCached) {
    // Warm the memory cache from disk so subsequent calls are instant.
    memoryCache = { data: fileCached, fetchedAt: Date.now() };
    return fileCached;
  }

  // Tier 3: network
  const res = await fetch(GITHUB_API, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": `mikrotik-mcp/${VERSION}`,
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);

  const gh = (await res.json()) as {
    tag_name: string;
    name: string;
    body: string;
    published_at: string;
    html_url: string;
  };
  const latestVersion = gh.tag_name.replace(/^v/, "");
  const data: ReleasePayload = {
    version: latestVersion,
    name: gh.name || `v${latestVersion}`,
    body: gh.body || "",
    publishedAt: gh.published_at,
    url: gh.html_url,
    isNewer: compareVersions(latestVersion, VERSION) > 0,
    currentVersion: VERSION,
  };

  // Populate both caches
  memoryCache = { data, fetchedAt: Date.now() };
  saveFileCache(data);
  return data;
}

// ── Non-throwing wrapper (for background use) ────────────────────────────────

/**
 * Check for a newer server version. Never throws — network/filesystem errors
 * produce `{ release: null, error }` instead.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const release = await fetchLatestRelease();
    return { release, checkedAt: Date.now(), fromCache: false };
  } catch (e) {
    // If network failed but we have a stale file cache, return it.
    const stale = loadFileCache(Infinity);
    if (stale) {
      return { release: stale, checkedAt: Date.now(), fromCache: true };
    }
    return {
      release: null,
      checkedAt: Date.now(),
      fromCache: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Freshness assessment ─────────────────────────────────────────────────────

/**
 * How stale is the running version compared to the latest release?
 *
 * - `fresh`   — current or within one patch of latest
 * - `aging`   — one minor version behind
 * - `stale`   — more than one minor behind
 * - `ancient` — a major version behind
 */
export function assessFreshness(current: string, latest: string): Freshness {
  const ca = current.replace(/^v/, "").split(".").map(Number);
  const la = latest.replace(/^v/, "").split(".").map(Number);
  const majorDiff = (la[0] ?? 0) - (ca[0] ?? 0);
  const minorDiff = (la[1] ?? 0) - (ca[1] ?? 0);
  const patchDiff = (la[2] ?? 0) - (ca[2] ?? 0);

  if (majorDiff > 0) return "ancient";
  if (minorDiff > 1) return "stale";
  if (minorDiff === 1) return "aging";
  if (patchDiff > 1) return "aging";
  return "fresh";
}

// ── Compact summary for instructions injection ──────────────────────────────

/**
 * Returns a one-liner for injecting into the MCP instructions when a newer
 * version is available, or `null` when the running version is current.
 */
export function updateSummaryLine(release: ReleasePayload): string | null {
  if (!release.isNewer) return null;
  return (
    `Server update available: MikroTik MCP v${release.version} ` +
    `(you are running v${VERSION}). ` +
    `Call check_server_pulse for release notes and upgrade commands, ` +
    `or upgrade directly: bun i -g @usex/mikrotik-mcp@latest`
  );
}
