/**
 * shadcn-style charts for the observability dashboard, built on Recharts.
 *
 * Mirrors shadcn/ui's chart look (muted dashed gridlines, axis-less ticks,
 * gradient area fills, a themed tooltip card) but without Tailwind — the styling
 * lives in `styles.css` under `.chart*`, driven by the same `--page-accent` /
 * `--mt-*` design tokens as the rest of the dashboard. Each chart is a small,
 * self-contained component the views drop in.
 */
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** A short HH:MM label for an epoch-ms timestamp. */
const hhmm = (t: number): string =>
  new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

/** Themed tooltip card matching shadcn's ChartTooltipContent. */
interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}
function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: ReactNode;
  unit?: string;
}): ReactNode {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      {label != null && <div className="chart-tip__label">{label}</div>}
      {payload.map((e, i) => (
        <div className="chart-tip__row" key={i}>
          <span className="chart-tip__dot" style={{ background: e.color }} />
          <span className="chart-tip__name">{e.name ?? e.dataKey}</span>
          <span className="chart-tip__val">
            {typeof e.value === "number" ? e.value.toLocaleString() : e.value}
            {unit ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}

const GRID = "color-mix(in srgb, var(--mt-border) 80%, transparent)";
const TICK = { fill: "var(--mt-text-faint)", fontSize: 10, fontFamily: "var(--mt-mono)" };

/** Stacked area of OK vs error tool-calls over time (replaces the old bar TimeSeries). */
export function ActivityChart({
  series,
}: {
  series: { t: number; ok: number; error: number }[];
}): ReactNode {
  return (
    <div className="chart" style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="fillOk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--page-accent)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--page-accent)" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="fillErr" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--mt-bad)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--mt-bad)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            tickFormatter={hhmm}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
          />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: GRID }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                payload={payload as readonly TooltipEntry[]}
                label={typeof label === "number" ? hhmm(label) : label}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="ok"
            name="ok"
            stackId="1"
            stroke="var(--page-accent)"
            fill="url(#fillOk)"
            strokeWidth={2}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="error"
            name="error"
            stackId="1"
            stroke="var(--mt-bad)"
            fill="url(#fillErr)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Donut of risk/status segments with a centered total (replaces the old SVG Donut). */
export function RiskDonut({
  segments,
  centerLabel = "calls",
}: {
  segments: { label: string; value: number; color: string }[];
  centerLabel?: string;
}): ReactNode {
  const data = segments.filter((s) => s.value > 0);
  const total = segments.reduce((a, b) => a + b.value, 0);
  return (
    <div className="chart chart--donut">
      <div className="chart-donut__svg">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Tooltip
              content={({ active, payload }) => (
                <ChartTooltip active={active} payload={payload as readonly TooltipEntry[]} />
              )}
            />
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius={58}
              outerRadius={80}
              paddingAngle={2}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {data.map((s) => (
                <Cell key={s.label} fill={s.color} />
              ))}
            </Pie>
            <text
              x="50%"
              y="47%"
              textAnchor="middle"
              fill="var(--mt-text)"
              fontSize={22}
              fontWeight={600}
            >
              {total.toLocaleString()}
            </text>
            <text x="50%" y="59%" textAnchor="middle" fill="var(--mt-text-dim)" fontSize={10}>
              {centerLabel}
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        {data.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label} <b>{s.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Compact area chart for a device health metric over time (replaces Sparkline). */
export function MetricArea({
  values,
  color,
  unit,
  maxValue,
}: {
  values: (number | null)[];
  color: string;
  unit?: string;
  maxValue?: number;
}): ReactNode {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return <div className="spark spark--empty">no samples yet</div>;
  const data = values.map((v, i) => ({ i, v }));
  const last = nums[nums.length - 1];
  const gid = `ma-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div className="chart chart--spark">
      <span className="chart-spark__last" style={{ color }}>
        {last.toFixed(unit === "%" ? 0 : 1)}
        {unit ?? ""}
      </span>
      <ResponsiveContainer width="100%" height={46}>
        <AreaChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, maxValue ?? "dataMax"]} />
          <Tooltip
            cursor={{ stroke: GRID }}
            content={({ active, payload }) => (
              <ChartTooltip
                active={active}
                payload={(payload as readonly TooltipEntry[])?.map((p) => ({
                  ...p,
                  name: "value",
                  color,
                }))}
                unit={unit}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            fill={`url(#${gid})`}
            strokeWidth={1.7}
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Radial gauge for an instantaneous 0–100% reading (shadcn radial chart style). */
export function RadialGauge({
  value,
  label,
  color,
}: {
  value: number | undefined;
  label: string;
  color: string;
}): ReactNode {
  const has = value != null;
  const v = has ? Math.max(0, Math.min(100, value)) : 0;
  const data = [{ name: label, value: v, fill: color }];
  return (
    <div className="gauge">
      <div className="gauge__radial">
        <ResponsiveContainer width={72} height={72}>
          <RadialBarChart
            data={data}
            innerRadius="72%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            barSize={7}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
            <RadialBar
              dataKey="value"
              cornerRadius={4}
              background={{ fill: "var(--mt-surface-2)" }}
              isAnimationActive={false}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <span
          className="gauge__pct"
          style={{ color: has ? "var(--mt-text)" : "var(--mt-text-faint)" }}
        >
          {has ? `${Math.round(v)}%` : "n/a"}
        </span>
      </div>
      <span className="gauge__label">{label}</span>
    </div>
  );
}
