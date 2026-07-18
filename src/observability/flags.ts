/**
 * Country-flag SVGs for the dashboard, sourced from the **circle-flags** pack
 * (https://github.com/HatScripts/circle-flags).
 *
 * Rather than have every browser fetch flags from a third-party CDN (a privacy
 * leak, and broken on an air-gapped install), the server fetches each needed flag
 * ONCE, extracts the raw SVG to a local cache dir (and an in-memory map), and
 * serves it same-origin from `/api/flag/<code>`. After the first fetch the flag is
 * available offline.
 */
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { PROJECT_ROOT } from "../paths";
import { logger } from "../logger";

const LOG_TAG = "mikrotik-mcp";
/** ISO 3166-1 alpha-2 codes are the circle-flags filenames (e.g. `de.svg`). */
const CODE_RE = /^[a-z]{2}$/;
const sourceUrl = (code: string): string =>
  `https://hatscripts.github.io/circle-flags/flags/${code}.svg`;
/** Flags vendored by `scripts/download-flags.ts` and shipped with the server. */
const VENDOR_DIR = join(PROJECT_ROOT, "assets", "flags");
/** Runtime cache for any code the vendored set didn't include (fetched on demand). */
const CACHE_DIR = join(homedir(), ".mikrotik-mcp", "flags");

// `undefined` = never looked up; `null` = looked up, no such flag (don't retry).
const mem = new Map<string, string | null>();

/** The circle-flags SVG for an ISO country code, or null if unknown/unavailable. */
export async function flagSvg(code: string): Promise<string | null> {
  const c = code.toLowerCase();
  if (!CODE_RE.test(c)) return null;
  const cached = mem.get(c);
  if (cached !== undefined) return cached;

  // Prefer the vendored set shipped with the server, then the runtime cache — both
  // work fully offline. Only a code missing from both hits the network below.
  for (const file of [join(VENDOR_DIR, `${c}.svg`), join(CACHE_DIR, `${c}.svg`)]) {
    try {
      const svg = await readFile(file, "utf8");
      mem.set(c, svg);
      return svg;
    } catch {
      /* not present here — try the next source */
    }
  }

  try {
    const res = await fetch(sourceUrl(c), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      // 404 = no flag for this code; cache the miss so we don't refetch it.
      if (res.status === 404) mem.set(c, null);
      return null;
    }
    const svg = await res.text();
    mem.set(c, svg);
    // Extract to disk best-effort; a failure here just means we refetch next time.
    void mkdir(CACHE_DIR, { recursive: true })
      .then(() => writeFile(join(CACHE_DIR, `${c}.svg`), svg))
      .catch(() => {});
    return svg;
  } catch (e) {
    // Transient network error — do NOT poison the cache; a later request retries.
    logger.warn(
      `[${LOG_TAG}] flag fetch failed for '${c}': ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}
