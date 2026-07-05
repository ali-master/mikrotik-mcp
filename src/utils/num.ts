/** Parse a string to an integer, returning 0 on failure. */
export function num(s: string | undefined): number {
  return Number.parseInt(s ?? "0", 10) || 0;
}
