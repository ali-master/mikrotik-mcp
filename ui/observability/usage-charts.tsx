/**
 * Reusable usage visualisations for the persisted history:
 *   • {@link UsageHistoryChart} — a per-day download/upload area chart over a
 *     window (3 months by default), used by both the Clients and User Manager
 *     pages. Missing days are filled with zero so the time axis stays continuous.
 *   • {@link Heatmap} — a GitHub-profile-style contribution calendar of per-day
 *     counts (User Manager VPN connections per user), 53 weeks ending today.
 *
 * Both fetch their own data from a passed `endpoint` and render hand-rolled SVG
 * (no chart dependency, so the bundle still inlines to one self-contained HTML).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { api } from "./api";
import { bytes } from "./format";

const SVG_NS = "http://www.w3.org/2000/svg";
const DAY_MS = 86_400_000;

interface DailyUsage {
  day: string;
  rx: number;
  tx: number;
}
interface UsagePayload {
  series: DailyUsage[];
  totalRx: number;
  totalTx: number;
}
interface DayCount {
  day: string;
  count: number;
}
interface HeatmapPayload {
  days: DayCount[];
  total: number;
  max: number;
}

/** UTC `YYYY-MM-DD` for an epoch-ms instant. */
const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** UTC midnight ms for "today". */
function todayUtc(): number {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
}
/** Friendly full date for a `YYYY-MM-DD` UTC day, e.g. "Mon, Jan 6 2026". */
function fmtFullDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ── per-day download/upload area chart ───────────────────────────────────────
export function UsageHistoryChart({
  endpoint,
  days = 90,
}: {
  endpoint: string;
  days?: number;
}): ReactNode {
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void api<UsagePayload>(endpoint)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [endpoint]);

  // Fill the full window with zeros so gaps don't compress the axis.
  const filled = useMemo(() => {
    const map = new Map((data?.series ?? []).map((d) => [d.day, d]));
    const end = todayUtc();
    const out: DailyUsage[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = dayKey(end - i * DAY_MS);
      const hit = map.get(k);
      out.push(hit ?? { day: k, rx: 0, tx: 0 });
    }
    return out;
  }, [data, days]);

  if (loading) return <div className="muted usage-chart__empty">loading usage…</div>;
  const hasData = (data?.totalRx ?? 0) + (data?.totalTx ?? 0) > 0;
  if (!hasData) {
    return (
      <div className="muted usage-chart__empty">
        No usage recorded yet. The dashboard samples on a configurable interval (1 minute by default
        — see the RADIUS &amp; UM Settings tab); history fills in over time (kept ~3 months).
      </div>
    );
  }

  const W = 640;
  const H = 150;
  const pad = 8;
  const max = Math.max(1, ...filled.flatMap((d) => [d.rx, d.tx]));
  const x = (i: number): number => pad + (i * (W - 2 * pad)) / Math.max(1, filled.length - 1);
  const y = (v: number): number => H - pad - (v / max) * (H - 2 * pad);
  const path = (pick: (d: DailyUsage) => number): string =>
    filled.map((d, i) => `${x(i).toFixed(1)},${y(pick(d)).toFixed(1)}`).join(" ");
  const area = (pick: (d: DailyUsage) => number): string => {
    const first = x(0).toFixed(1);
    const last = x(filled.length - 1).toFixed(1);
    return `${first},${(H - pad).toFixed(1)} ${path(pick)} ${last},${(H - pad).toFixed(1)}`;
  };

  return (
    <div className="usage-chart">
      <div className="usage-chart__legend">
        <span className="rate rx">↓ {bytes(data?.totalRx ?? 0)} down</span>
        <span className="rate tx">↑ {bytes(data?.totalTx ?? 0)} up</span>
        <span className="muted">
          · peak/day {bytes(max)} · last {days} days
        </span>
      </div>
      <svg
        className="usage-chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        xmlns={SVG_NS}
        role="img"
      >
        <polygon className="rx area" points={area((d) => d.rx)} />
        <polygon className="tx area" points={area((d) => d.tx)} />
        <polyline className="rx line" points={path((d) => d.rx)} />
        <polyline className="tx line" points={path((d) => d.tx)} />
      </svg>
    </div>
  );
}

// ── GitHub-style contribution heatmap ────────────────────────────────────────
const WEEKS = 53;
const CELL = 12;
const GAP = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Cell {
  day: string;
  count: number;
  col: number;
  row: number;
  ms: number;
}

interface Tip {
  left: number;
  top: number;
  day: string;
  count: number;
  lvl: number;
}

export function Heatmap({ endpoint, label }: { endpoint: string; label?: string }): ReactNode {
  const [data, setData] = useState<HeatmapPayload | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void api<HeatmapPayload>(endpoint)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setData({ days: [], total: 0, max: 0 });
      });
    return () => {
      alive = false;
    };
  }, [endpoint]);

  const { cells, monthLabels } = useMemo(() => {
    const counts = new Map((data?.days ?? []).map((d) => [d.day, d.count]));
    const end = todayUtc();
    const endRow = new Date(end).getUTCDay();
    // First (leftmost) column starts on the Sunday (WEEKS-1) weeks before the
    // Sunday of the current week, so the grid ends on today's column.
    const firstSunday = end - (endRow + (WEEKS - 1) * 7) * DAY_MS;
    const cs: Cell[] = [];
    const labels: { col: number; text: string }[] = [];
    let lastMonth = -1;
    for (let i = 0; i < WEEKS * 7; i++) {
      const ms = firstSunday + i * DAY_MS;
      if (ms > end) break;
      const col = Math.floor(i / 7);
      const row = new Date(ms).getUTCDay();
      const day = dayKey(ms);
      cs.push({ day, count: counts.get(day) ?? 0, col, row, ms });
      if (row === 0) {
        const month = new Date(ms).getUTCMonth();
        if (month !== lastMonth) {
          labels.push({ col, text: MONTHS[month] });
          lastMonth = month;
        }
      }
    }
    return { cells: cs, monthLabels: labels };
  }, [data]);

  const max = Math.max(1, data?.max ?? 1);
  const level = (count: number): number => {
    if (count <= 0) return 0;
    return Math.min(4, Math.ceil((count / max) * 4));
  };

  const gridW = WEEKS * (CELL + GAP);
  const leftPad = 28;
  const topPad = 16;
  const H = topPad + 7 * (CELL + GAP);

  // Position the custom tooltip above the hovered cell, in coordinates local to
  // the wrapper (so it survives the grid being horizontally scrolled).
  const onEnter = (e: ReactMouseEvent<SVGRectElement>, c: Cell): void => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cell = e.currentTarget.getBoundingClientRect();
    const box = wrap.getBoundingClientRect();
    setTip({
      left: cell.left - box.left + cell.width / 2,
      top: cell.top - box.top,
      day: c.day,
      count: c.count,
      lvl: level(c.count),
    });
  };

  return (
    <div className="heatmap" ref={wrapRef}>
      <div className="heatmap__hd">
        <span className="heatmap__title">{label ?? "Connections"}</span>
        <span className="muted">{data ? `${data.total} total` : "…"}</span>
      </div>
      <div className="heatmap__scroll" onMouseLeave={() => setTip(null)}>
        <svg
          className="heatmap__svg"
          viewBox={`0 0 ${leftPad + gridW} ${H}`}
          width={leftPad + gridW}
          height={H}
          xmlns={SVG_NS}
          role="img"
        >
          {monthLabels.map((m) => (
            <text
              key={`${m.col}-${m.text}`}
              className="heatmap__month"
              x={leftPad + m.col * (CELL + GAP)}
              y={11}
            >
              {m.text}
            </text>
          ))}
          {["Mon", "Wed", "Fri"].map((d, i) => (
            <text
              key={d}
              className="heatmap__wd"
              x={0}
              y={topPad + (i * 2 + 1) * (CELL + GAP) + CELL - 2}
            >
              {d}
            </text>
          ))}
          {cells.map((c) => (
            <rect
              key={c.day}
              className={`heatmap__cell lvl${level(c.count)}${
                tip?.day === c.day ? " is-hover" : ""
              }`}
              x={leftPad + c.col * (CELL + GAP)}
              y={topPad + c.row * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              onMouseEnter={(e) => onEnter(e, c)}
            />
          ))}
        </svg>
      </div>
      {tip && (
        <div className="heatmap__tip" style={{ left: tip.left, top: tip.top }} role="tooltip">
          <div className="heatmap__tip-head">
            <span className={`heatmap__swatch lvl${tip.lvl}`} />
            <b>
              {tip.count === 0
                ? "No connections"
                : `${tip.count} connection${tip.count === 1 ? "" : "s"}`}
            </b>
          </div>
          <div className="heatmap__tip-date">{fmtFullDate(tip.day)}</div>
        </div>
      )}
      <div className="heatmap__legend muted">
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heatmap__swatch lvl${l}`} />
        ))}
        More
      </div>
    </div>
  );
}
