/**
 * Live Feed display-limit choices.
 *
 * The value itself lives in the server config (`dashboard.feedLimit`), so it
 * shows in the effective-config JSON and the config editor and is the same for
 * every viewer — see `main.tsx`. This module only holds the option list and
 * default the UI offers.
 */

/**
 * How many rows the Live Feed table may render. A *rendering* cap, distinct from
 * the in-memory event buffer (`FEED_CAP`), which is far larger — this only bounds
 * how many rows are put in the DOM at once, which is what affects smoothness.
 */
export const FEED_LIMITS = [50, 100, 200, 500, 1000, 2000] as const;

export const DEFAULT_FEED_LIMIT = 200;
