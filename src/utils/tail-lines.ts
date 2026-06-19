/**
 * Keep only the last `n` lines of a block of text.
 *
 * RouterOS `print` has no `limit=` parameter (it rejects it with
 * "bad parameter limit"), so any row-capping of print output must be done
 * client-side. Logs and most print output are ordered oldest→newest, so the
 * tail is the most recent `n` entries.
 *
 * - `n <= 0` (or falsy) returns the text unchanged — "no cap".
 * - Fewer than `n` lines returns the text unchanged.
 */
export function tailLines(text: string, n: number): string {
  if (!n || n <= 0) return text;
  const lines = text.split("\n");
  return lines.length <= n ? text : lines.slice(-n).join("\n");
}
