/**
 * Pure analytics over recorded {@link ToolEvent}s — every number the dashboard
 * shows (totals, error rate, latency percentiles, time-series, breakdowns) is
 * computed here from a plain array, with no database or I/O. This keeps the SQL
 * layer trivial (insert / select / prune) and the analytics fully unit-testable.
 */
import type { Risk, ToolEvent } from "./event";

export interface Bucket {
  /** Bucket start, epoch ms. */
  t: number;
  ok: number;
  error: number;
}

export interface ToolStat {
  tool: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
}

export interface Stats {
  total: number;
  errors: number;
  /** Errors / total, 0–1. */
  errorRate: number;
  /** Calls per minute across the window. */
  callsPerMin: number;
  /** Total output bytes across the window. */
  outputBytes: number;
  latency: { avg: number; p50: number; p95: number; p99: number; max: number };
  byTool: ToolStat[];
  byRisk: Record<Risk, number>;
  byDevice: { device: string; count: number }[];
  byStatus: { ok: number; error: number };
  series: Bucket[];
  /** Most recent error events (compact). */
  recentErrors: { id: string; ts: number; tool: string; error: string }[];
  distinctTools: number;
  distinctDevices: number;
  windowMs: number;
}

/** Linear-interpolated percentile (0–100) over an unsorted number array. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

const ZERO_RISK: Record<Risk, number> = {
  READ: 0,
  WRITE: 0,
  WRITE_IDEMPOTENT: 0,
  DESTRUCTIVE: 0,
  DANGEROUS: 0,
};

export interface StatsOptions {
  /** "Now" in epoch ms (the right edge of the time-series window). */
  now: number;
  /** Window length in ms (e.g. 1h). */
  windowMs: number;
  /** Number of time-series buckets. */
  buckets: number;
  /** Cap on `byTool` / `byDevice` rows. */
  topN?: number;
}

/** Aggregate a set of events into the full dashboard {@link Stats}. */
export function computeStats(events: ToolEvent[], opts: StatsOptions): Stats {
  const topN = opts.topN ?? 12;
  const total = events.length;
  const errors = events.reduce((n, e) => n + (e.isError ? 1 : 0), 0);
  const outputBytes = events.reduce((n, e) => n + e.outputBytes, 0);
  const durations = events.map((e) => e.durationMs);

  // Per-tool rollup.
  const toolMap = new Map<string, { count: number; errors: number; ds: number[] }>();
  const deviceMap = new Map<string, number>();
  const byRisk: Record<Risk, number> = { ...ZERO_RISK };
  for (const e of events) {
    const t = toolMap.get(e.tool) ?? { count: 0, errors: 0, ds: [] };
    t.count++;
    if (e.isError) t.errors++;
    t.ds.push(e.durationMs);
    toolMap.set(e.tool, t);
    if (e.device) deviceMap.set(e.device, (deviceMap.get(e.device) ?? 0) + 1);
    byRisk[e.risk] = (byRisk[e.risk] ?? 0) + 1;
  }
  const byTool: ToolStat[] = [...toolMap.entries()]
    .map(([tool, v]) => ({
      tool,
      count: v.count,
      errors: v.errors,
      avgMs: v.ds.reduce((a, b) => a + b, 0) / v.ds.length,
      p95Ms: percentile(v.ds, 95),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
  const byDevice = [...deviceMap.entries()]
    .map(([device, count]) => ({ device, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  // Time-series buckets across [now-window, now].
  const span = Math.max(1, opts.windowMs);
  const n = Math.max(1, opts.buckets);
  const size = span / n;
  const start = opts.now - span;
  const series: Bucket[] = Array.from({ length: n }, (_, i) => ({
    t: Math.round(start + i * size),
    ok: 0,
    error: 0,
  }));
  for (const e of events) {
    const idx = Math.floor((e.ts - start) / size);
    if (idx >= 0 && idx < n) {
      if (e.isError) series[idx].error++;
      else series[idx].ok++;
    }
  }

  const recentErrors = events
    .filter((e) => e.isError)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20)
    .map((e) => ({ id: e.id, ts: e.ts, tool: e.tool, error: e.error ?? "error" }));

  return {
    total,
    errors,
    errorRate: total ? errors / total : 0,
    callsPerMin: total / (span / 60_000),
    outputBytes,
    latency: {
      avg: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      max: durations.length ? Math.max(...durations) : 0,
    },
    byTool,
    byRisk,
    byDevice,
    byStatus: { ok: total - errors, error: errors },
    series,
    recentErrors,
    distinctTools: toolMap.size,
    distinctDevices: deviceMap.size,
    windowMs: span,
  };
}
