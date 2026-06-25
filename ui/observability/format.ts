import type { Risk } from "./types";

// ── formatting ───────────────────────────────────────────────────────────────
export const ms = (n: number): string =>
  n < 1 ? "<1ms" : n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(2)}s`;
export function bytes(n: number): string {
  const u = ["B", "KiB", "MiB", "GiB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}
export const clock = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, { hour12: false });
export const num = (n: number): string => n.toLocaleString();
export const sval = (v: unknown): string => {
  if (v == null) return "?";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
};
/** Per-metric accent for the device system-health gauges & sparkline charts.
 * Reuses the dashboard's accent vocabulary (blue `--page-accent`, teal
 * `--page-accent-2`) plus violet/amber so each metric is distinct yet on-theme. */
export const HEALTH_COLOR = {
  cpu: "#3291ff", // blue
  mem: "#a78bfa", // violet
  disk: "#2dd4bf", // teal
  latency: "#f59e0b", // amber
} as const;

export const RISK_COLOR: Record<Risk, string> = {
  READ: "#d4d4d8",
  WRITE: "#a1a1aa",
  WRITE_IDEMPOTENT: "#e4e4e7",
  DESTRUCTIVE: "#f87171",
  DANGEROUS: "#ef4444",
};

export const WINDOWS: [string, number][] = [
  ["5m", 300_000],
  ["15m", 900_000],
  ["1h", 3_600_000],
  ["6h", 21_600_000],
  ["24h", 86_400_000],
];
export const FEED_CAP = 10_000;
