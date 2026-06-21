/**
 * Small, dependency-free parsers that turn RouterOS `print` text into structured
 * data for MCP App views. Kept separate from `routeros.ts` (which *builds*
 * commands) and pure so they're trivially unit-testable.
 */

/**
 * Parse the `key: value` output of a single-record `print` (e.g.
 * `/system resource print`, `/system identity print`) into an object.
 *
 * RouterOS pads keys with leading spaces and separates with `: `; values run to
 * end of line. Keys with hyphens are preserved (`cpu-load`, `free-memory`).
 * Lines without a `key:` shape (blanks, flag legends) are skipped.
 *
 * @example
 *   parseKeyValues("  uptime: 1w2d\n  cpu-load: 5%")
 *   // => { uptime: "1w2d", "cpu-load": "5%" }
 */
export function parseKeyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z][\w-]*):\s?(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    // First occurrence wins; later duplicate keys (rare) are ignored.
    if (!(key in out)) out[key] = value.trim();
  }
  return out;
}

/** Strip a trailing unit and return the leading number, or null if none. */
export function parseLeadingNumber(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.match(/^-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Convert a RouterOS size like `124.0MiB`, `2048KiB`, `1.5GiB` (or a plain byte
 * count) to bytes, or null if unparseable. Used to compute memory/disk usage
 * percentages for gauges.
 */
export function parseSizeToBytes(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*([KMGT]i?B|B)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "B").toUpperCase();
  const factor: Record<string, number> = {
    B: 1,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
  };
  return n * (factor[unit] ?? 1);
}
