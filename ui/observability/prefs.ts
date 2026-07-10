/**
 * Client-side dashboard preferences, persisted in `localStorage`.
 *
 * These are per-browser view settings, not server configuration — they never
 * reach the MCP server and are absent from `/api/config`. The Config page edits
 * them alongside the server config, but they live here.
 */

/** localStorage key for the Live Feed's display limit. */
const FEED_LIMIT_KEY = "mt-feed-limit";

/**
 * How many rows the Live Feed table renders. This is a *rendering* cap, not the
 * buffer: `FEED_CAP` (10,000) bounds how many events are held in memory, and this
 * bounds how many of them are put in the DOM at once. Raising it past a few
 * thousand makes the table janky, which is exactly why it is capped at all.
 */
export const FEED_LIMITS = [50, 100, 200, 500, 1000, 2000] as const;

export const DEFAULT_FEED_LIMIT = 200;

export function loadFeedLimit(): number {
  try {
    const n = Number(localStorage.getItem(FEED_LIMIT_KEY));
    return (FEED_LIMITS as readonly number[]).includes(n) ? n : DEFAULT_FEED_LIMIT;
  } catch {
    return DEFAULT_FEED_LIMIT;
  }
}

export function saveFeedLimit(n: number): void {
  try {
    localStorage.setItem(FEED_LIMIT_KEY, String(n));
  } catch {
    /* storage unavailable — the setting still applies for this session */
  }
}
