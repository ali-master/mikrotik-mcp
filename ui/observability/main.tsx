/**
 * MikroTik MCP — Observability dashboard (React).
 *
 * A React 19 single-page app served by the dashboard server on localhost. Talks
 * to the same origin: REST for history/analytics (`/api/stats`, `/api/events`,
 * `/api/meta`, `/api/devices`, `/api/config`, `/api/event/:id`) and a live
 * stream — a Bun-native WebSocket (`/api/stream`) with an automatic SSE
 * fallback (`/api/sse`) — for the real-time feed of every tool call the LLM
 * makes. Charts are hand-rolled SVG (no chart library). A `?token=` in the URL
 * is forwarded to every API call and the live stream when the server requires it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// ── API types (mirror src/observability) ────────────────────────────────────
type Risk = "READ" | "WRITE" | "WRITE_IDEMPOTENT" | "DESTRUCTIVE" | "DANGEROUS";
interface ToolEvent {
  id: string;
  ts: number;
  tool: string;
  title: string;
  risk: Risk;
  device?: string;
  transport?: string;
  durationMs: number;
  isError: boolean;
  error?: string;
  input: string;
  output: string;
  outputBytes: number;
  hasStructured: boolean;
  truncated: boolean;
}
interface Bucket {
  t: number;
  ok: number;
  error: number;
}
interface Stats {
  total: number;
  errors: number;
  errorRate: number;
  callsPerMin: number;
  outputBytes: number;
  latency: { avg: number; p50: number; p95: number; p99: number; max: number };
  byTool: {
    tool: string;
    count: number;
    errors: number;
    avgMs: number;
    p95Ms: number;
  }[];
  byRisk: Record<Risk, number>;
  byDevice: { device: string; count: number }[];
  byStatus: { ok: number; error: number };
  series: Bucket[];
  recentErrors: { id: string; ts: number; tool: string; error: string }[];
  distinctTools: number;
  distinctDevices: number;
  windowMs: number;
}
interface Meta {
  tools: string[];
  devices: string[];
  risks: Risk[];
  total: number;
  liveClients: number;
  transport: string;
}
interface DeviceStatus {
  reachable: boolean | null;
  checkedAt: number | null;
  latencyMs: number | null;
  identity?: string;
  version?: string;
  error?: string;
  boardName?: string;
  architecture?: string;
  cpuCount?: number;
  cpuLoad?: number;
  freeMemory?: number;
  totalMemory?: number;
  memUsedPct?: number;
  freeHdd?: number;
  totalHdd?: number;
  hddUsedPct?: number;
  uptime?: string;
}
interface MetricSample {
  ts: number;
  cpuLoad: number | null;
  memUsedPct: number | null;
  hddUsedPct: number | null;
  latencyMs: number | null;
}
interface DeviceInfo {
  name: string;
  host: string;
  port: number;
  /** Set when the device is reached over Layer-2 MAC-Telnet instead of SSH. */
  mac?: string;
  transport?: string;
  /** Display address: the MAC for a mac-telnet device, else `host:port`. */
  address?: string;
  username: string;
  authMode: string;
  isDefault: boolean;
  description?: string;
  status: DeviceStatus;
  history?: MetricSample[];
  activity: { calls: number; errors: number; lastSeen: number; avgMs: number };
}
interface DevicesPayload {
  server: string;
  defaultDevice: string;
  devices: DeviceInfo[];
}
interface TopoNode {
  id: string;
  kind: "device" | "neighbor";
  label: string;
  configured: boolean;
  onboardable: boolean;
  identity?: string;
  ip?: string;
  mac?: string;
  platform?: string;
  board?: string;
  version?: string;
  reachable?: boolean | null;
  cpuLoad?: number;
  memUsedPct?: number;
  uptime?: string;
  suggestedConfig?: { name: string; host?: string; mac?: string; port: number; username: string };
}
interface TopoEdge {
  from: string;
  to: string;
  interface?: string;
}
interface TopologyPayload {
  server: string;
  defaultDevice: string;
  generatedAt: number;
  nodes: TopoNode[];
  edges: TopoEdge[];
  stats: { devices: number; neighbors: number; onboardable: number };
}
type Filter = {
  tool: string;
  risk: string;
  device: string;
  status: string;
  q: string;
};
type LiveMode = "ws" | "sse" | "off";

// ── formatting ───────────────────────────────────────────────────────────────
const ms = (n: number): string =>
  n < 1 ? "<1ms" : n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(2)}s`;
function bytes(n: number): string {
  const u = ["B", "KiB", "MiB", "GiB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}
const clock = (ts: number): string => new Date(ts).toLocaleTimeString();
const num = (n: number): string => n.toLocaleString();
const sval = (v: unknown): string => {
  if (v == null) return "?";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
};
const RISK_COLOR: Record<Risk, string> = {
  READ: "#34d399",
  WRITE: "#fbbf24",
  WRITE_IDEMPOTENT: "#6ea8fe",
  DESTRUCTIVE: "#f87171",
  DANGEROUS: "#ef4444",
};

// ── token + API ──────────────────────────────────────────────────────────────
const TOKEN = new URLSearchParams(location.search).get("token") ?? "";
const withToken = (path: string): string =>
  TOKEN ? `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(TOKEN)}` : path;
async function api<T>(path: string): Promise<T> {
  const res = await fetch(withToken(path), {
    headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** Delete events: a list of ids, or everything (`{ all: true }`). */
async function deleteEvents(body: {
  ids?: string[];
  all?: boolean;
}): Promise<{ removed: number; total: number }> {
  const res = await fetch(withToken("/api/events"), {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as { removed: number; total: number };
}

/** POST JSON to an API path, forwarding the token; returns the parsed JSON body. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(withToken(path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
  // Config routes return structured errors with non-2xx; surface the JSON body.
  const data = (await res.json().catch(() => ({}))) as T;
  return data;
}

const WINDOWS: [string, number][] = [
  ["5m", 300_000],
  ["15m", 900_000],
  ["1h", 3_600_000],
  ["6h", 21_600_000],
  ["24h", 86_400_000],
];
const FEED_CAP = 500;

// ── small UI atoms ───────────────────────────────────────────────────────────
function Panel({
  title,
  extra,
  children,
}: {
  title?: string;
  extra?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="panel">
      {title != null && (
        <div className="sheet__hd" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          {extra != null && (
            <>
              <span style={{ flex: 1 }} />
              {extra}
            </>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function StatCard({
  k,
  v,
  sub,
  cls,
}: {
  k: string;
  v: string;
  sub?: string;
  cls?: string;
}): ReactNode {
  return (
    <div className={`stat${cls ? ` ${cls}` : ""}`}>
      <p className="k">{k}</p>
      <div className="v">
        {v}
        {sub != null && <small> {sub}</small>}
      </div>
    </div>
  );
}

// ── charts (SVG) ─────────────────────────────────────────────────────────────
function TimeSeries({ series }: { series: Bucket[] }): ReactNode {
  const W = 720;
  const H = 140;
  const pad = 6;
  const n = series.length || 1;
  const bw = (W - pad * 2) / n;
  const max = Math.max(1, ...series.map((b) => b.ok + b.error));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      {series.map((b, i) => {
        const x = pad + i * bw;
        const okH = ((H - 18) * b.ok) / max;
        const errH = ((H - 18) * b.error) / max;
        const gap = bw > 3 ? 1 : 0;
        return (
          <g key={i}>
            {okH > 0 && (
              <rect
                x={x + gap}
                y={H - 14 - okH}
                width={bw - gap * 2}
                height={okH}
                fill="#34d399"
                opacity={0.85}
                rx={1}
              />
            )}
            {errH > 0 && (
              <rect
                x={x + gap}
                y={H - 14 - okH - errH}
                width={bw - gap * 2}
                height={errH}
                fill="#f87171"
                rx={1}
              />
            )}
          </g>
        );
      })}
      <line x1={pad} y1={H - 14} x2={W - pad} y2={H - 14} stroke="#262b33" />
      {series.length > 0 && (
        <>
          <text x={pad} y={H - 2} fill="#6b7280" fontSize={10}>
            {clock(series[0].t)}
          </text>
          <text x={W - pad} y={H - 2} fill="#6b7280" fontSize={10} textAnchor="end">
            {clock(series[series.length - 1].t)}
          </text>
        </>
      )}
    </svg>
  );
}

function Donut({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}): ReactNode {
  const total = segments.reduce((a, b) => a + b.value, 0);
  const R = 46;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
      }}
    >
      <svg viewBox="0 0 120 120" width={120} height={120}>
        <circle cx={60} cy={60} r={R} fill="none" stroke="#1b1f26" strokeWidth={16} />
        {segments
          .filter((s) => s.value > 0)
          .map((s, i) => {
            const frac = s.value / (total || 1);
            const el = (
              <circle
                key={i}
                cx={60}
                cy={60}
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={16}
                strokeDasharray={`${C * frac} ${C}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
              />
            );
            offset += C * frac;
            return el;
          })}
        <text x={60} y={58} textAnchor="middle" fill="#e8eaed" fontSize={20} fontWeight={650}>
          {total}
        </text>
        <text x={60} y={74} textAnchor="middle" fill="#9aa3af" fontSize={9}>
          calls
        </text>
      </svg>
      <div className="legend" style={{ justifyContent: "center", marginTop: 0 }}>
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              {s.label} {s.value}
            </span>
          ))}
      </div>
    </div>
  );
}

function HBars({
  rows,
}: {
  rows: { label: string; value: number; sub?: string; color?: string }[];
}): ReactNode {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbar">
      {rows.map((r) => (
        <div className="hbar__row" key={r.label}>
          <span className="hbar__label" title={r.label}>
            {r.label}
          </span>
          <div className="hbar__track">
            <div
              className="hbar__fill"
              style={{
                width: `${(r.value / max) * 100}%`,
                background: r.color,
              }}
            />
          </div>
          <span className="hbar__val">{r.sub ?? String(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── connectivity graph ───────────────────────────────────────────────────────
function statusInfo(s: DeviceStatus): { label: string; color: string } {
  if (s.reachable === true) return { label: "online", color: "#34d399" };
  if (s.reachable === false) return { label: "offline", color: "#f87171" };
  return { label: "checking…", color: "#6b7280" };
}

/** A point on a quadratic Bézier (core → control → device) at parameter `t`. */
function qPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

/** Tangent angle (degrees) of that Bézier at `t`, for orienting direction arrows. */
function qAngle(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  t: number,
): number {
  const u = 1 - t;
  const dx = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  const dy = 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

const FLOW_CMD = "#818cf8"; // command: LLM → device
const FLOW_RES = "#34d399"; // response: device → LLM

/**
 * Animated "radar hub" connectivity map that shows **traffic direction**. Each
 * device hangs off the MCP core on a two-lane curved link: the outer lane is the
 * **command** stream (LLM → device, indigo, packets flowing outward) and the
 * inner lane is the **response** stream (device → LLM, emerald, packets flowing
 * back). Direction chevrons sit mid-lane. Every real tool call fires a bright
 * round-trip "burst" orb (core → device → core) on that device's link — so you
 * literally watch a request go out and its response come home, even for
 * mac-telnet devices the background probe can't poll. All motion is CSS/SMIL
 * (`.conn-*` in styles.css) and respects `prefers-reduced-motion`.
 */
function ConnectivityGraph({
  payload,
  pulses,
}: {
  payload: DevicesPayload;
  pulses: Record<string, number>;
}): ReactNode {
  const devices = payload.devices;
  const n = Math.max(1, devices.length);
  const R = Math.min(150, 96 + n * 3);
  const PAD = 80;
  const W = 700;
  const H = Math.round((R + PAD) * 2);
  const cx = W / 2;
  const cy = H / 2;
  const core = { x: cx, y: cy };

  const nodes = devices.map((d, i) => {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2 + (n % 2 === 0 ? Math.PI / n : 0);
    return { d, i, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  });

  return (
    <>
      <svg
        className="conn"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="conn-hub" cx="0.5" cy="0.38" r="0.72">
            <stop offset="0" stopColor="#c7d2fe" />
            <stop offset="0.55" stopColor="#6366f1" />
            <stop offset="1" stopColor="#312e81" />
          </radialGradient>
          <radialGradient id="conn-orb" cx="0.5" cy="0.32" r="0.85">
            <stop offset="0" stopColor="#232a3b" />
            <stop offset="1" stopColor="#0f131c" />
          </radialGradient>
          <radialGradient id="conn-burst" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fffbe6" />
            <stop offset="0.5" stopColor="#fde68a" />
            <stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* faint concentric range rings for depth */}
        {[0.5, 0.78, 1].map((f, i) => (
          <circle key={`g-${i}`} className="conn-grid" cx={cx} cy={cy} r={R * f} />
        ))}

        {/* sonar pulses radiating from the core */}
        {[0, 1, 2].map((i) => (
          <circle
            key={`s-${i}`}
            className="conn-sonar"
            cx={cx}
            cy={cy}
            style={{ animationDelay: `${i * 1.1}s` }}
          />
        ))}

        {/* two-lane directional links + flowing packets + activity bursts */}
        {nodes.map(({ d, i, x, y }) => {
          const info = statusInfo(d.status);
          const online = d.status.reachable === true;
          const checking = d.status.reachable == null;
          const node = { x, y };
          const mx = (cx + x) / 2;
          const my = (cy + y) / 2;
          const dx = x - cx;
          const dy = y - cy;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const OFF = 16;
          // Command lane bows one way, response lane the other — a two-lane road.
          const cmdC = { x: mx + nx * OFF, y: my + ny * OFF };
          const resC = { x: mx - nx * OFF, y: my - ny * OFF };
          const cmdPath = `M${cx},${cy} Q${cmdC.x.toFixed(1)},${cmdC.y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
          const resPath = `M${cx},${cy} Q${resC.x.toFixed(1)},${resC.y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
          const burstPath = `M${cx},${cy} Q${mx.toFixed(1)},${my.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
          // Direction chevrons at lane midpoints.
          const cmdMid = qPoint(core, cmdC, node, 0.52);
          const cmdAng = qAngle(core, cmdC, node, 0.52); // points toward device
          const resMid = qPoint(core, resC, node, 0.48);
          const resAng = qAngle(core, resC, node, 0.48) + 180; // points toward core
          const pulse = pulses[d.name] ?? 0;
          return (
            <g key={`l-${d.name}`}>
              {/* command lane (LLM → device) */}
              <path
                id={`conn-cmd-${i}`}
                className="conn-link"
                d={cmdPath}
                stroke={online ? FLOW_CMD : info.color}
                strokeOpacity={online ? 0.5 : 0.32}
                strokeDasharray={checking ? "2 8" : online ? undefined : "6 7"}
              />
              {/* response lane (device → LLM) */}
              <path
                id={`conn-res-${i}`}
                className="conn-link"
                d={resPath}
                stroke={online ? FLOW_RES : info.color}
                strokeOpacity={online ? 0.5 : 0.18}
                strokeDasharray={online ? undefined : "6 7"}
              />
              {online && (
                <>
                  <path className="conn-flow" d={cmdPath} stroke={FLOW_CMD} />
                  <circle className="conn-packet" r={3.2} fill={FLOW_CMD}>
                    <animateMotion dur="2.6s" repeatCount="indefinite" calcMode="linear">
                      <mpath href={`#conn-cmd-${i}`} />
                    </animateMotion>
                  </circle>
                  {/* response packet rides the inner lane in reverse (device → core) */}
                  <rect
                    className="conn-packet"
                    x={-2.6}
                    y={-2.6}
                    width={5.2}
                    height={5.2}
                    fill={FLOW_RES}
                    transform="rotate(45)"
                  >
                    <animateMotion
                      dur="2.6s"
                      begin="0.9s"
                      repeatCount="indefinite"
                      calcMode="linear"
                      keyPoints="1;0"
                      keyTimes="0;1"
                    >
                      <mpath href={`#conn-res-${i}`} />
                    </animateMotion>
                  </rect>
                  {/* direction chevrons */}
                  <path
                    className="conn-chevron"
                    d="M-4,-3 L4,0 L-4,3"
                    stroke={FLOW_CMD}
                    transform={`translate(${cmdMid.x.toFixed(1)},${cmdMid.y.toFixed(1)}) rotate(${cmdAng.toFixed(1)})`}
                  />
                  <path
                    className="conn-chevron"
                    d="M-4,-3 L4,0 L-4,3"
                    stroke={FLOW_RES}
                    transform={`translate(${resMid.x.toFixed(1)},${resMid.y.toFixed(1)}) rotate(${resAng.toFixed(1)})`}
                  />
                </>
              )}
              {/* round-trip activity burst: fires once per live tool call (any status) */}
              {pulse > 0 && (
                <g key={`burst-${d.name}-${pulse}`}>
                  <circle r={6} fill="url(#conn-burst)">
                    <animateMotion
                      dur="1.1s"
                      repeatCount="1"
                      calcMode="linear"
                      keyPoints="0;1;0"
                      keyTimes="0;0.5;1"
                      path={burstPath}
                    />
                    <animate
                      attributeName="opacity"
                      values="0;1;1;0"
                      keyTimes="0;0.1;0.85;1"
                      dur="1.1s"
                      repeatCount="1"
                      fill="freeze"
                    />
                  </circle>
                </g>
              )}
            </g>
          );
        })}

        {/* core hub */}
        <circle className="conn-hub-glow" cx={cx} cy={cy} r={42} />
        <circle className="conn-hub-ring" cx={cx} cy={cy} r={37} />
        <circle cx={cx} cy={cy} r={29} fill="url(#conn-hub)" stroke="#a5b4fc" strokeWidth={1.5} />
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#fff" fontSize={12} fontWeight={700}>
          LLM
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fill="#c7d2fe" fontSize={8}>
          ⇄ MCP
        </text>
        <text x={cx} y={cy + 18} textAnchor="middle" fill="#c7d2fe" fontSize={7.5}>
          server
        </text>

        {/* device nodes */}
        {nodes.map(({ d, x, y }) => {
          const info = statusInfo(d.status);
          const online = d.status.reachable === true;
          const detail = online ? `${d.status.latencyMs ?? "?"} ms` : info.label;
          const short = d.name.length > 11 ? `${d.name.slice(0, 10)}…` : d.name;
          return (
            <g key={`n-${d.name}`} className="conn-node">
              {online && (
                <circle className="conn-node-halo" cx={x} cy={y} r={24} stroke={info.color} />
              )}
              <circle
                cx={x}
                cy={y}
                r={23}
                fill="url(#conn-orb)"
                stroke={info.color}
                strokeWidth={2}
              />
              <circle
                className={online ? "conn-blink" : undefined}
                cx={x + 16}
                cy={y - 16}
                r={4.5}
                fill={info.color}
              />
              <text
                x={x}
                y={y + 3}
                textAnchor="middle"
                fill="#e8eaed"
                fontSize={10}
                fontWeight={600}
              >
                {short}
              </text>
              <text x={x} y={y + 40} textAnchor="middle" fill="#9aa3af" fontSize={9}>
                {d.address ?? d.host}
              </text>
              <text
                x={x}
                y={y + 52}
                textAnchor="middle"
                fill={info.color}
                fontSize={9}
                fontWeight={600}
              >
                {detail}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="conn-legend">
        <span>
          <i style={{ background: FLOW_CMD }} /> command · LLM → device
        </span>
        <span>
          <i style={{ background: FLOW_RES }} /> response · device → LLM
        </span>
        <span>
          <i style={{ background: "#fde68a" }} /> live call (round-trip)
        </span>
      </div>
    </>
  );
}

function DeviceCard({ d }: { d: DeviceInfo }): ReactNode {
  const info = statusInfo(d.status);
  const statusLine =
    d.status.reachable === true
      ? `${info.label} · ${d.status.latencyMs ?? "?"}ms${d.status.version ? ` · v${d.status.version}` : ""}`
      : d.status.reachable === false
        ? `${info.label}${d.status.error ? ` · ${d.status.error}` : ""}`
        : info.label;
  return (
    <div className="card dev-card">
      <div className="dev-card__top">
        <span className="dot" style={{ background: info.color }} />
        <span className="dev-card__name">{d.name}</span>
        {d.isDefault && <span className="badge">default</span>}
        <span style={{ flex: 1 }} />
        <span className="chip">{d.authMode}</span>
      </div>
      <div className="dev-card__meta">
        <span>{d.mac ? "mac" : "host"}</span>
        <b>{d.address ?? `${d.host}:${d.port}`}</b>
        <span>user</span>
        <b>{d.username}</b>
        <span>status</span>
        <b style={{ color: info.color }}>{statusLine}</b>
        <span>activity</span>
        <b>
          {d.activity.calls} calls · {d.activity.errors} err
          {d.activity.avgMs ? ` · ${ms(d.activity.avgMs)} avg` : ""}
        </b>
        {d.description && (
          <>
            <span>note</span>
            <b>{d.description}</b>
          </>
        )}
      </div>
    </div>
  );
}

// ── device system-health charts ─────────────────────────────────────────────
/** A compact line+area sparkline over a series that may contain gaps (`null`). */
function Sparkline({
  values,
  color,
  maxValue,
  unit,
}: {
  values: (number | null)[];
  color: string;
  maxValue?: number;
  unit?: string;
}): ReactNode {
  const W = 220;
  const H = 46;
  const pad = 4;
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return <div className="spark spark--empty">no samples yet</div>;
  const max = Math.max(maxValue ?? 0, ...nums, 1);
  const n = values.length;
  const xAt = (i: number): number => pad + (i * (W - pad * 2)) / Math.max(1, n - 1);
  const yAt = (v: number): number => H - pad - (Math.min(v, max) / max) * (H - pad * 2);
  // Build a line path, lifting the pen across null gaps (offline samples).
  let line = "";
  let penDown = false;
  values.forEach((v, i) => {
    if (v == null) {
      penDown = false;
      return;
    }
    line += `${penDown ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
    penDown = true;
  });
  const hasGap = values.some((v) => v == null);
  const firstIdx = values.findIndex((v) => v != null);
  const lastIdx = n - 1 - [...values].reverse().findIndex((v) => v != null);
  const area =
    !hasGap && nums.length > 1
      ? `M${xAt(firstIdx).toFixed(1)},${(H - pad).toFixed(1)} ${line.slice(1)} L${xAt(lastIdx).toFixed(1)},${(H - pad).toFixed(1)} Z`
      : "";
  const lastVal = values[lastIdx] as number;
  const gid = `spark-${color.replace("#", "")}`;
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={area} fill={`url(#${gid})`} stroke="none" />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={xAt(lastIdx)} cy={yAt(lastVal)} r={2.6} fill={color} />
      <text x={W - pad} y={11} textAnchor="end" fill={color} fontSize={10} fontWeight={650}>
        {lastVal.toFixed(unit === "%" ? 0 : 1)}
        {unit ?? ""}
      </text>
    </svg>
  );
}

/** A radial 0–100% gauge for an instantaneous reading (CPU / memory). */
function Gauge({
  value,
  label,
  color,
}: {
  value: number | undefined;
  label: string;
  color: string;
}): ReactNode {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const R = 24;
  const C = 2 * Math.PI * R;
  return (
    <div className="gauge">
      <svg viewBox="0 0 64 64" width={64} height={64}>
        <circle cx={32} cy={32} r={R} fill="none" stroke="#1b1f26" strokeWidth={7} />
        <circle
          cx={32}
          cy={32}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${(C * v) / 100} ${C}`}
          transform="rotate(-90 32 32)"
        />
        <text x={32} y={35} textAnchor="middle" fill="#e8eaed" fontSize={13} fontWeight={700}>
          {value == null ? "—" : `${Math.round(v)}%`}
        </text>
      </svg>
      <span className="gauge__label">{label}</span>
    </div>
  );
}

const memHuman = (b?: number): string => (b == null ? "?" : bytes(b));

/** One device's realtime system-health card: gauges + sparkline charts. */
function DeviceHealthCard({ d }: { d: DeviceInfo }): ReactNode {
  const s = d.status;
  const hist = d.history ?? [];
  const probed = s.reachable === true || hist.length > 0;
  if (d.mac || !probed) {
    return (
      <div className="card health-card health-card--na">
        <div className="health-card__hd">
          <span className="dev-card__name">{d.name}</span>
          {d.isDefault && <span className="badge">default</span>}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {d.mac
            ? "System metrics are not collected for MAC-Telnet devices (no background probe)."
            : "Waiting for the first health probe…"}
        </p>
      </div>
    );
  }
  return (
    <div className="card health-card">
      <div className="health-card__hd">
        <span className="dot" style={{ background: statusInfo(s).color }} />
        <span className="dev-card__name">{d.name}</span>
        {d.isDefault && <span className="badge">default</span>}
        <span style={{ flex: 1 }} />
        <span className="chip">{s.version ? `v${s.version}` : "—"}</span>
      </div>
      <div className="health-card__sub muted">
        {s.boardName ?? "router"}
        {s.architecture ? ` · ${s.architecture}` : ""}
        {s.cpuCount ? ` · ${s.cpuCount} cpu` : ""}
        {s.uptime ? ` · up ${s.uptime}` : ""}
      </div>
      <div className="health-card__gauges">
        <Gauge value={s.cpuLoad} label="CPU" color="#6ea8fe" />
        <Gauge value={s.memUsedPct} label="MEM" color="#34d399" />
        <Gauge value={s.hddUsedPct} label="DISK" color="#fbbf24" />
      </div>
      <div className="health-card__charts">
        <div className="health-chart">
          <span className="health-chart__k">CPU load</span>
          <Sparkline values={hist.map((h) => h.cpuLoad)} color="#6ea8fe" maxValue={100} unit="%" />
        </div>
        <div className="health-chart">
          <span className="health-chart__k">Memory used</span>
          <Sparkline
            values={hist.map((h) => h.memUsedPct)}
            color="#34d399"
            maxValue={100}
            unit="%"
          />
        </div>
        <div className="health-chart">
          <span className="health-chart__k">Probe latency</span>
          <Sparkline values={hist.map((h) => h.latencyMs)} color="#c084fc" unit="ms" />
        </div>
      </div>
      <div className="health-card__foot muted">
        RAM {memHuman(s.totalMemory && s.freeMemory ? s.totalMemory - s.freeMemory : undefined)} /{" "}
        {memHuman(s.totalMemory)} · free disk {memHuman(s.freeHdd)}
      </div>
    </div>
  );
}

// ── live stream hook (Bun WebSocket, SSE fallback) ───────────────────────────
function useLiveStream(onEvent: (e: ToolEvent) => void, onMode: (m: LiveMode) => void): void {
  const onEventRef = useRef(onEvent);
  const onModeRef = useRef(onMode);
  onEventRef.current = onEvent;
  onModeRef.current = onMode;

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let es: EventSource | null = null;

    const connectSse = (): void => {
      if (closed) return;
      es = new EventSource(withToken("/api/sse"));
      es.addEventListener("hello", () => onModeRef.current("sse"));
      es.addEventListener("tool", (ev) => {
        try {
          onEventRef.current(JSON.parse((ev as MessageEvent).data) as ToolEvent);
        } catch {
          /* ignore */
        }
      });
      es.onerror = () => {
        if (es && es.readyState === EventSource.CONNECTING) onModeRef.current("off");
      };
    };

    const connectWs = (): void => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(withToken(`${proto}://${location.host}/api/stream`));
      let opened = false;
      ws.onopen = () => {
        opened = true;
        onModeRef.current("ws");
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (m) => {
        try {
          const msg = JSON.parse(m.data) as { type: string; event?: ToolEvent };
          if (msg.type === "event" && msg.event) onEventRef.current(msg.event);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        onModeRef.current("off");
        if (opened) setTimeout(connectWs, 2000);
        else connectSse();
      };
    };

    connectWs();
    return () => {
      closed = true;
      ws?.close();
      es?.close();
    };
  }, []);
}

// ── JSON syntax highlighter ──────────────────────────────────────────────────
// ── Config Studio: edit the config JSON with autocomplete + safe apply ───────
interface ConfigIssue {
  path: string;
  message: string;
}
interface SchemaHints {
  keys: string[];
  enums: string[];
}
interface DiffSummary {
  added: number;
  removed: number;
  unchanged: number;
  changed: boolean;
}
interface SaveResp {
  ok: boolean;
  errors?: ConfigIssue[];
  pendingId?: string;
  rollbackMs?: number;
  path?: string;
  fromFile?: boolean;
  devicesChanged?: boolean;
  summary?: DiffSummary;
  unified?: string;
}

/** Walk a JSON Schema collecting property names and string enum values for hints. */
function collectHints(schema: unknown): SchemaHints {
  const keys = new Set<string>();
  const enums = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.properties && typeof n.properties === "object") {
      for (const k of Object.keys(n.properties)) {
        keys.add(k);
        walk((n.properties as Record<string, unknown>)[k]);
      }
    }
    if (Array.isArray(n.enum)) for (const e of n.enum) if (typeof e === "string") enums.add(e);
    for (const f of ["items", "additionalProperties", "$defs", "anyOf", "oneOf", "allOf"]) {
      const v = n[f];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(schema);
  return { keys: [...keys].sort(), enums: [...enums.add("true").add("false")].sort() };
}

/** The word being typed at the caret + whether we're after a `:` (a value position). */
function wordAtCaret(
  text: string,
  caret: number,
): { word: string; start: number; isValue: boolean } {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_.-]/.test(text[start - 1])) start--;
  const word = text.slice(start, caret);
  // Look back past whitespace before the word: a `:` means we're typing a value.
  let i = start - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  return { word, start, isValue: text[i] === ":" };
}

const ROLLBACK_OPTS: [string, number][] = [
  ["revert in 30s", 30_000],
  ["revert in 60s", 60_000],
  ["revert in 2m", 120_000],
  ["no auto-revert", 0],
];

/**
 * In-browser config editor: schema-driven autocomplete, authoritative Zod
 * validation, per-device connection tests, a diff preview, and a safe-apply that
 * the server auto-reverts unless you confirm in time.
 */
function ConfigStudio({
  initial,
  onClose,
  onReload,
}: {
  initial: unknown;
  onClose: () => void;
  onReload: () => void;
}): ReactNode {
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [hints, setHints] = useState<SchemaHints>({ keys: [], enums: [] });
  const [errors, setErrors] = useState<ConfigIssue[]>([]);
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [ac, setAc] = useState<{ items: string[]; index: number; start: number } | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; label: string }>>({});
  const [preview, setPreview] = useState<{ summary?: DiffSummary; unified?: string } | null>(null);
  const [pending, setPending] = useState<SaveResp | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [rollbackMs, setRollbackMs] = useState(60_000);
  const [msg, setMsg] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<number | null>(null);

  // Fetch the schema once → completion hints.
  useEffect(() => {
    void api<unknown>("/api/config-schema")
      .then((s) => setHints(collectHints(s)))
      .catch(() => {});
  }, []);

  // Re-apply a programmatic caret after an autocomplete insertion re-renders.
  useEffect(() => {
    if (caretRef.current != null && taRef.current) {
      taRef.current.selectionStart = taRef.current.selectionEnd = caretRef.current;
      caretRef.current = null;
    }
  });

  // Debounced validation: parse locally first, then ask the server (Zod truth).
  useEffect(() => {
    const t = setTimeout(() => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        setJsonErr(e instanceof Error ? e.message : String(e));
        setErrors([]);
        return;
      }
      setJsonErr(null);
      void postJson<{ ok: boolean; errors: ConfigIssue[] }>("/api/config/validate", parsed)
        .then((r) => setErrors(r.errors ?? []))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [text]);

  // Rollback countdown while a save is pending confirmation.
  useEffect(() => {
    if (!pending || countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [pending, countdown]);
  useEffect(() => {
    if (pending && countdown === 0 && (pending.rollbackMs ?? 0) > 0) {
      // The server's timer has fired and reverted; reflect it and reload.
      setMsg("Auto-reverted — changes were not confirmed in time.");
      setPending(null);
      onReload();
    }
  }, [pending, countdown, onReload]);

  const valid = !jsonErr && errors.length === 0;

  const refreshAc = (el: HTMLTextAreaElement): void => {
    const { word, start, isValue } = wordAtCaret(el.value, el.selectionStart);
    if (word.length < 1) {
      setAc(null);
      return;
    }
    const pool = isValue ? hints.enums : hints.keys;
    const items = pool.filter((k) => k.startsWith(word) && k !== word).slice(0, 8);
    setAc(items.length ? { items, index: 0, start } : null);
  };

  const accept = (completion: string): void => {
    const el = taRef.current;
    if (!el || !ac) return;
    const next = text.slice(0, ac.start) + completion + text.slice(el.selectionStart);
    caretRef.current = ac.start + completion.length;
    setText(next);
    setAc(null);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (!ac) {
      if (e.key === " " && e.ctrlKey) {
        e.preventDefault();
        refreshAc(e.currentTarget);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAc({ ...ac, index: (ac.index + 1) % ac.items.length });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAc({ ...ac, index: (ac.index - 1 + ac.items.length) % ac.items.length });
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(ac.items[ac.index]);
    } else if (e.key === "Escape") {
      setAc(null);
    }
  };

  const parseOrNull = (): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const testDevices = async (): Promise<void> => {
    const obj = parseOrNull() as { devices?: Record<string, unknown> } | null;
    if (!obj?.devices) return;
    setMsg("Testing devices…");
    const out: Record<string, { ok: boolean; label: string }> = {};
    type TestResp = { ok: boolean; status?: DeviceStatus; errors?: ConfigIssue[] };
    for (const [name, dc] of Object.entries(obj.devices)) {
      const r = await postJson<TestResp>("/api/config/test-device", {
        name,
        config: dc,
      }).catch((): TestResp => ({ ok: false }));
      out[name] =
        r.ok && r.status?.reachable === true
          ? {
              ok: true,
              label: `${Math.round(r.status.latencyMs ?? 0)}ms · ${r.status.identity ?? "ok"}`,
            }
          : { ok: false, label: r.status?.error ?? r.errors?.[0]?.message ?? "unreachable" };
      setTests({ ...out });
    }
    setMsg(null);
  };

  const doPreview = async (): Promise<void> => {
    const obj = parseOrNull();
    if (obj == null) return;
    setPreview(await postJson("/api/config/preview", obj));
  };

  const doSave = async (): Promise<void> => {
    const obj = parseOrNull();
    if (obj == null) return;
    setMsg("Saving…");
    const r = await postJson<SaveResp>("/api/config", { config: obj, rollbackMs });
    setMsg(null);
    setPreview(null);
    if (!r.ok) {
      setErrors(r.errors ?? [{ path: "(root)", message: "save rejected" }]);
      return;
    }
    setPending(r);
    setCountdown(Math.round((r.rollbackMs ?? 0) / 1000));
  };

  const doKeep = async (): Promise<void> => {
    if (!pending?.pendingId) return;
    await postJson("/api/config/keep", { pendingId: pending.pendingId });
    setPending(null);
    setMsg("Changes kept.");
    onReload();
  };
  const doRollback = async (): Promise<void> => {
    if (!pending?.pendingId) return;
    await postJson("/api/config/rollback", { pendingId: pending.pendingId });
    setPending(null);
    setMsg("Reverted to the previous config.");
    onReload();
  };

  const lines = text.split("\n").length;

  return (
    <div className="cfgstudio">
      <div className="cfg-toolbar">
        <span className={`cfg-status ${valid ? "is-ok" : "is-bad"}`}>
          {jsonErr
            ? "invalid JSON"
            : errors.length
              ? `${errors.length} schema issue(s)`
              : "valid ✓"}
        </span>
        <span style={{ flex: 1 }} />
        <button className="topo-btn" onClick={() => void testDevices()}>
          Test devices
        </button>
        <button className="topo-btn" onClick={() => void doPreview()} disabled={!valid}>
          Preview diff
        </button>
        <select
          className="cfg-select"
          value={rollbackMs}
          onChange={(e) => setRollbackMs(Number(e.target.value))}
          title="Auto-revert window"
        >
          {ROLLBACK_OPTS.map(([label, v]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <button
          className="topo-btn cfg-save"
          onClick={() => void doSave()}
          disabled={!valid || !!pending}
        >
          Save
        </button>
        <button className="topo-btn" onClick={onClose}>
          Close
        </button>
      </div>

      {msg && <div className="cfg-msg">{msg}</div>}

      {pending && (
        <div className="cfg-banner">
          <strong>Applied.</strong>{" "}
          {(pending.rollbackMs ?? 0) > 0 ? (
            <>
              Reverting in <span className="cfg-count">{countdown}s</span> unless you keep it.
            </>
          ) : (
            <>Saved without an auto-revert window.</>
          )}
          {pending.devicesChanged && (
            <span className="cfg-warn">
              {" "}
              · device list changed — reconnect the MCP client to expose it to the model
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button className="topo-btn cfg-save" onClick={() => void doKeep()}>
            Keep changes
          </button>
          <button className="topo-btn" onClick={() => void doRollback()}>
            Revert now
          </button>
        </div>
      )}

      <div className="cfg-editor">
        <pre className="cfg-gutter" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
        </pre>
        <div className="cfg-ta-wrap">
          <textarea
            ref={taRef}
            className="cfg-ta"
            spellCheck={false}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              refreshAc(e.currentTarget);
            }}
            onKeyDown={onKeyDown}
            onClick={() => setAc(null)}
            onScroll={(e) => {
              const g = e.currentTarget.previousElementSibling as HTMLElement | null;
              if (g) g.scrollTop = e.currentTarget.scrollTop;
            }}
          />
          {ac && (
            <div className="cfg-ac">
              {ac.items.map((it, i) => (
                <div
                  key={it}
                  className={`cfg-ac-item${i === ac.index ? " is-sel" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    accept(it);
                  }}
                >
                  {it}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {Object.keys(tests).length > 0 && (
        <div className="cfg-chips">
          {Object.entries(tests).map(([name, r]) => (
            <span key={name} className={`cfg-chip ${r.ok ? "is-ok" : "is-bad"}`}>
              {r.ok ? "●" : "○"} {name}: {r.label}
            </span>
          ))}
        </div>
      )}

      {(jsonErr || errors.length > 0) && (
        <div className="cfg-errors">
          {jsonErr ? (
            <div className="cfg-err">JSON: {jsonErr}</div>
          ) : (
            errors.slice(0, 12).map((e, i) => (
              <div className="cfg-err" key={i}>
                <code>{e.path}</code> — {e.message}
              </div>
            ))
          )}
        </div>
      )}

      {preview && (
        <div className="cfg-preview">
          <div className="cfg-preview__hd">
            <strong>Diff vs current</strong>
            <span className="muted">
              {preview.summary?.changed
                ? `+${preview.summary.added} / -${preview.summary.removed}`
                : "no changes"}
            </span>
            <span style={{ flex: 1 }} />
            <button className="topo-btn" onClick={() => setPreview(null)}>
              ✕
            </button>
          </div>
          <pre className="cfg-diff">
            {(preview.unified || "(identical)").split("\n").map((l, i) => (
              <div
                key={i}
                className={
                  l.startsWith("+")
                    ? "d-add"
                    : l.startsWith("-")
                      ? "d-del"
                      : l.startsWith("@@")
                        ? "d-hunk"
                        : ""
                }
              >
                {l || " "}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── live Layer-2 topology map ────────────────────────────────────────────────
/** Colour a 0–100 metric: green (ok) → amber (warm) → red (hot). */
function metricColor(v: number | undefined): string {
  if (v == null) return "#3a4151";
  if (v >= 85) return "#f87171";
  if (v >= 60) return "#fbbf24";
  return "#34d399";
}

/**
 * Interactive Layer-2 map built from `/api/topology`. Configured devices sit on
 * an inner ring (single device → centre) with inline CPU/memory health bars;
 * discovered MNDP/CDP/LLDP neighbours fan out on an outer ring near the device
 * that saw them. Device↔device links are solid; links to not-yet-managed
 * neighbours are dashed. Clicking an onboardable neighbour reveals a ready-to-
 * paste device-config stub — the map is how the fabric expands itself.
 */
function TopologyMap({
  topo,
  onOnboard,
}: {
  topo: TopologyPayload;
  onOnboard?: (name: string, body: Record<string, unknown>) => void;
}): ReactNode {
  const [picked, setPicked] = useState<string | null>(null);
  const devices = topo.nodes.filter((n) => n.kind === "device");
  const neighbors = topo.nodes.filter((n) => n.kind === "neighbor");
  const nd = Math.max(1, devices.length);

  const W = 760;
  const Ri = devices.length <= 1 ? 0 : Math.min(150, 76 + nd * 8);
  const Ro = Ri + (devices.length <= 1 ? 180 : 140);
  const H = Math.max(360, Math.round((Ro + 78) * 2));
  const cx = W / 2;
  const cy = H / 2;

  const pos = new Map<string, { x: number; y: number }>();
  const angOf = new Map<string, number>();
  devices.forEach((d, i) => {
    if (devices.length === 1) {
      pos.set(d.id, { x: cx, y: cy });
      angOf.set(d.id, -Math.PI / 2);
      return;
    }
    const ang = (i / nd) * Math.PI * 2 - Math.PI / 2;
    angOf.set(d.id, ang);
    pos.set(d.id, { x: cx + Ri * Math.cos(ang), y: cy + Ri * Math.sin(ang) });
  });

  // Attach each neighbour to the first device that reported it, then fan a
  // device's neighbours across a small arc (or the full ring for one device).
  const parentOf = new Map<string, string>();
  const neighborIds = new Set(neighbors.map((n) => n.id));
  for (const e of topo.edges) {
    if (neighborIds.has(e.to) && !parentOf.has(e.to)) parentOf.set(e.to, e.from);
  }
  const byParent = new Map<string, string[]>();
  for (const nb of neighbors) {
    const p = parentOf.get(nb.id) ?? devices[0]?.id ?? "";
    byParent.set(p, [...(byParent.get(p) ?? []), nb.id]);
  }
  if (devices.length <= 1) {
    neighbors.forEach((nb, k) => {
      const a = (k / Math.max(1, neighbors.length)) * Math.PI * 2 - Math.PI / 2;
      pos.set(nb.id, { x: cx + Ro * Math.cos(a), y: cy + Ro * Math.sin(a) });
    });
  } else {
    for (const [p, ids] of byParent) {
      const base = angOf.get(p) ?? -Math.PI / 2;
      const spread = Math.min(Math.PI / 2.2, 0.32 * ids.length);
      ids.forEach((id, k) => {
        const a = ids.length === 1 ? base : base - spread / 2 + (spread * k) / (ids.length - 1);
        pos.set(id, { x: cx + Ro * Math.cos(a), y: cy + Ro * Math.sin(a) });
      });
    }
  }

  const byId = new Map(topo.nodes.map((n) => [n.id, n]));
  const pickedNode = picked ? byId.get(picked) : null;

  return (
    <div className="topo">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={Math.min(H, 540)}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* links */}
        {topo.edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const dashed = neighborIds.has(e.to);
          return (
            <line
              key={`e-${i}`}
              className={`topo-edge${dashed ? " is-dashed" : ""}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
            >
              <title>
                {e.from} → {e.to}
                {e.interface ? ` (${e.interface})` : ""}
              </title>
            </line>
          );
        })}

        {/* nodes */}
        {topo.nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const isDev = n.kind === "device";
          const w = isDev ? 132 : 108;
          const h = isDev ? 50 : 38;
          const x = p.x - w / 2;
          const y = p.y - h / 2;
          const border =
            n.reachable === true
              ? "#34d399"
              : n.reachable === false
                ? "#f87171"
                : isDev
                  ? "#6b7280"
                  : "#7c9cff";
          const isPicked = picked === n.id;
          return (
            <g
              key={n.id}
              className={`topo-node${isDev ? " is-device" : " is-neighbor"}${n.onboardable ? " is-onboard" : ""}${isPicked ? " is-picked" : ""}`}
              transform={`translate(${x},${y})`}
              onClick={() => setPicked((cur) => (cur === n.id ? null : n.id))}
            >
              <rect width={w} height={h} rx={9} style={{ stroke: border }} />
              <text className="topo-label" x={9} y={16}>
                {(n.label || n.id).slice(0, 16)}
              </text>
              {isDev ? (
                <>
                  <text className="topo-sub" x={9} y={30}>
                    {(n.board || n.ip || "").slice(0, 18)}
                  </text>
                  {/* inline CPU / memory health bars */}
                  <rect className="topo-bar-bg" x={9} y={37} width={w - 18} height={4} rx={2} />
                  <rect
                    x={9}
                    y={37}
                    width={((w - 18) * Math.min(100, n.cpuLoad ?? 0)) / 100}
                    height={4}
                    rx={2}
                    style={{ fill: metricColor(n.cpuLoad) }}
                  />
                  <rect className="topo-bar-bg" x={9} y={43} width={w - 18} height={4} rx={2} />
                  <rect
                    x={9}
                    y={43}
                    width={((w - 18) * Math.min(100, n.memUsedPct ?? 0)) / 100}
                    height={4}
                    rx={2}
                    style={{ fill: metricColor(n.memUsedPct) }}
                  />
                </>
              ) : (
                <text className="topo-sub" x={9} y={29}>
                  {n.onboardable ? "＋ onboard" : n.ip || n.mac || ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="topo-foot">
        <span className="legend">
          <span>
            <i className="dot" style={{ background: "#34d399" }} /> online
          </span>
          <span>
            <i className="dot" style={{ background: "#f87171" }} /> offline
          </span>
          <span>
            <i className="dot" style={{ background: "#7c9cff" }} /> neighbour
          </span>
          <span className="muted">
            {topo.stats.devices} devices · {topo.stats.neighbors} discovered ·{" "}
            {topo.stats.onboardable} onboardable
          </span>
        </span>

        {pickedNode && (
          <div className="topo-pop">
            <div className="topo-pop__hd">
              <strong>{pickedNode.label}</strong>
              <span className="muted">
                {[pickedNode.board, pickedNode.version, pickedNode.mac]
                  .filter(Boolean)
                  .join(" · ") || "no details advertised"}
              </span>
              <span style={{ flex: 1 }} />
              <button className="topo-btn" onClick={() => setPicked(null)}>
                ✕
              </button>
            </div>
            {pickedNode.suggestedConfig ? (
              <>
                <div className="muted" style={{ margin: "2px 0 6px" }}>
                  Not managed yet — add this to your device config to onboard it:
                </div>
                <pre className="topo-stub">
                  {JSON.stringify(
                    { [pickedNode.suggestedConfig.name]: stubBody(pickedNode.suggestedConfig) },
                    null,
                    2,
                  )}
                </pre>
                <button
                  className="topo-btn"
                  onClick={() =>
                    void navigator.clipboard?.writeText(
                      JSON.stringify(
                        {
                          [pickedNode.suggestedConfig!.name]: stubBody(pickedNode.suggestedConfig!),
                        },
                        null,
                        2,
                      ),
                    )
                  }
                >
                  Copy config stub
                </button>
                {onOnboard && (
                  <button
                    className="topo-btn cfg-save"
                    onClick={() =>
                      onOnboard(
                        pickedNode.suggestedConfig!.name,
                        stubBody(pickedNode.suggestedConfig!),
                      )
                    }
                  >
                    Add to config →
                  </button>
                )}
              </>
            ) : (
              <div className="muted">
                Managed device{pickedNode.ip ? ` · ${pickedNode.ip}` : ""}
                {pickedNode.uptime ? ` · up ${pickedNode.uptime}` : ""}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The body half of an onboarding config stub (drops the `name` key). */
function stubBody(c: NonNullable<TopoNode["suggestedConfig"]>): Record<string, unknown> {
  const body: Record<string, unknown> = { port: c.port, username: c.username };
  if (c.host) body.host = c.host;
  if (c.mac) body.mac = c.mac;
  return body;
}

// Tokenises pretty-printed JSON into coloured spans (keys / strings / numbers /
// booleans / null). Dependency-free and XSS-safe — React escapes every token's
// text. Non-JSON input degrades gracefully (only quoted strings/numbers light up).
const JSON_TOKEN =
  /("(?:\\.|[^"\\])*"(?:\s*:)?)|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function JsonView({ value, maxHeight }: { value: unknown; maxHeight?: number }): ReactNode {
  const json = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of json.matchAll(JSON_TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(json.slice(last, idx));
    const tok = m[0];
    let cls: string;
    if (m[1] !== undefined) cls = /:\s*$/.test(tok) ? "j-key" : "j-str";
    else if (m[2] !== undefined) cls = tok === "null" ? "j-null" : "j-bool";
    else cls = "j-num";
    parts.push(
      <span className={cls} key={i++}>
        {tok}
      </span>,
    );
    last = idx + tok.length;
  }
  if (last < json.length) parts.push(json.slice(last));
  return (
    <pre className="body json" style={maxHeight ? { maxHeight } : undefined}>
      {parts}
    </pre>
  );
}

// ── detail drawer ────────────────────────────────────────────────────────────
function DetailDrawer({ event, onClose }: { event: ToolEvent; onClose: () => void }): ReactNode {
  const copy = (text: string): void => void navigator.clipboard?.writeText(text).catch(() => {});
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet__hd">
          <span className={`risk risk-${event.risk}`}>{event.risk}</span>
          <h3>{event.tool}</h3>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <div className="kv__body">
          <div className="kv__k">title</div>
          <div className="kv__v">{event.title}</div>
          <div className="kv__k">time</div>
          <div className="kv__v">{new Date(event.ts).toLocaleString()}</div>
          <div className="kv__k">device</div>
          <div className="kv__v">{event.device ?? "—"}</div>
          <div className="kv__k">transport</div>
          <div className="kv__v">{event.transport ?? "—"}</div>
          <div className="kv__k">duration</div>
          <div className="kv__v">{ms(event.durationMs)}</div>
          <div className="kv__k">status</div>
          <div className="kv__v">
            <span className={event.isError ? "status-err" : "status-ok"}>
              {event.isError ? "error" : "ok"}
            </span>
          </div>
          <div className="kv__k">output size</div>
          <div className="kv__v">
            {bytes(event.outputBytes)}
            {event.truncated ? " (truncated)" : ""}
          </div>
          <div className="kv__k">structured</div>
          <div className="kv__v">
            {event.hasStructured ? "yes (renders an MCP App view)" : "no"}
          </div>
        </div>
        {event.error && (
          <>
            <h2 className="muted">ERROR</h2>
            <pre className="body" style={{ color: "var(--mt-bad)" }}>
              {event.error}
            </pre>
          </>
        )}
        <div className="sheet__hd">
          <h2 className="muted" style={{ margin: 0 }}>
            INPUT
          </h2>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => copy(event.input)}>
            Copy
          </button>
        </div>
        {event.input ? <JsonView value={event.input} /> : <pre className="body">—</pre>}
        <div className="sheet__hd">
          <h2 className="muted" style={{ margin: 0 }}>
            OUTPUT
          </h2>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => copy(event.output)}>
            Copy
          </button>
        </div>
        <pre className="body">{event.output || "—"}</pre>
      </div>
    </div>
  );
}

// ── export helpers ───────────────────────────────────────────────────────────
function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── app ──────────────────────────────────────────────────────────────────────
function App(): ReactNode {
  const [stats, setStats] = useState<Stats | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [devices, setDevices] = useState<DevicesPayload | null>(null);
  const [topology, setTopology] = useState<TopologyPayload | null>(null);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [editingConfig, setEditingConfig] = useState(false);
  // A device entry seeded from the topology map's "Add to config →" action.
  const [seed, setSeed] = useState<{ name: string; body: Record<string, unknown> } | null>(null);
  const [feed, setFeed] = useState<ToolEvent[]>([]);
  const [windowMs, setWindowMs] = useState(3_600_000);
  const [paused, setPaused] = useState(false);
  const [liveMode, setLiveMode] = useState<LiveMode>("off");
  const [selected, setSelected] = useState<ToolEvent | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // Per-device counter bumped on each live event — feeds the connectivity graph's
  // round-trip "burst" so a new tool call visibly travels out and back.
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Filter>({
    tool: "",
    risk: "",
    device: "",
    status: "",
    q: "",
  });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Live stream → prepend to feed (unless paused) and pulse the device's link.
  useLiveStream(
    useCallback((e: ToolEvent) => {
      if (pausedRef.current) return;
      setFeed((f) => [e, ...f].slice(0, FEED_CAP));
      const dev = e.device;
      if (dev) setPulses((p) => ({ ...p, [dev]: (p[dev] ?? 0) + 1 }));
    }, []),
    useCallback((m: LiveMode) => setLiveMode(m), []),
  );

  // Initial load.
  useEffect(() => {
    void api<{ events: ToolEvent[] }>("/api/events?limit=200")
      .then((r) => setFeed(r.events))
      .catch(() => {});
  }, []);

  // Analytics + devices polling.
  const refreshStats = useCallback(() => {
    void api<Stats>(`/api/stats?window=${windowMs}&buckets=60`)
      .then(setStats)
      .catch(() => {});
  }, [windowMs]);
  useEffect(() => {
    refreshStats();
    const fetchAll = (): void => {
      refreshStats();
      void api<Meta>("/api/meta")
        .then(setMeta)
        .catch(() => {});
      void api<DevicesPayload>("/api/devices")
        .then(setDevices)
        .catch(() => {});
      void api<TopologyPayload>("/api/topology")
        .then(setTopology)
        .catch(() => {});
    };
    fetchAll();
    const t = setInterval(() => {
      if (!pausedRef.current) fetchAll();
    }, 4000);
    return () => clearInterval(t);
  }, [refreshStats]);
  useEffect(() => {
    const load = (): void =>
      void api<Record<string, unknown>>("/api/config")
        .then(setConfig)
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // Esc closes the drawer.
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const visible = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return feed
      .filter((e) => {
        if (filter.tool && e.tool !== filter.tool) return false;
        if (filter.risk && e.risk !== filter.risk) return false;
        if (filter.device && e.device !== filter.device) return false;
        if (filter.status === "ok" && e.isError) return false;
        if (filter.status === "error" && !e.isError) return false;
        if (
          q &&
          !e.tool.toLowerCase().includes(q) &&
          !e.input.toLowerCase().includes(q) &&
          !e.output.toLowerCase().includes(q) &&
          !(e.error ?? "").toLowerCase().includes(q)
        )
          return false;
        return true;
      })
      .sort((a, b) => b.ts - a.ts); // newest first
  }, [feed, filter]);
  const hasFilters = Boolean(
    filter.tool || filter.risk || filter.device || filter.status || filter.q,
  );

  // Errors + ok/error split derived from the live `feed` (the same data the
  // table shows), so the panels never disagree with the table. The windowed
  // `/api/stats` only counts events inside its time window, which is why a
  // table error older than the window used to leave "Recent errors" empty.
  const feedErrors = useMemo(() => feed.filter((e) => e.isError), [feed]);
  const feedStatus = useMemo(
    () => ({ ok: feed.length - feedErrors.length, error: feedErrors.length }),
    [feed, feedErrors],
  );

  const openDetail = useCallback(async (e: ToolEvent) => {
    try {
      setSelected(await api<ToolEvent>(`/api/event/${encodeURIComponent(e.id)}`));
    } catch {
      setSelected(e);
    }
  }, []);

  // The rows actually rendered (the table caps at 200) — selection + "select
  // all" operate over exactly these so the header checkbox matches what's shown.
  const shownRows = useMemo(() => visible.slice(0, 200), [visible]);
  const shownIds = useMemo(() => shownRows.map((e) => e.id), [shownRows]);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selectedIds.has(id));
  const someShownSelected = !allShownSelected && shownIds.some((id) => selectedIds.has(id));

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const everyShownSelected = shownIds.length > 0 && shownIds.every((id) => next.has(id));
      if (everyShownSelected) for (const id of shownIds) next.delete(id);
      else for (const id of shownIds) next.add(id);
      return next;
    });
  }, [shownIds]);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const deleteSelected = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await deleteEvents({ ids });
      const removed = new Set(ids);
      setFeed((f) => f.filter((e) => !removed.has(e.id)));
      setSelectedIds(new Set());
    } catch {
      /* network/permission error — leave selection intact for a retry */
    } finally {
      setConfirmingDelete(false);
    }
  }, [selectedIds]);

  const exportRows = (kind: "csv" | "json"): void => {
    if (kind === "json") {
      download("mcp-events.json", JSON.stringify(visible, null, 2), "application/json");
      return;
    }
    const cols = ["ts", "tool", "risk", "device", "durationMs", "isError", "error"];
    const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const body = visible
      .map((e) =>
        [
          new Date(e.ts).toISOString(),
          e.tool,
          e.risk,
          e.device ?? "",
          String(e.durationMs),
          String(e.isError),
          e.error ?? "",
        ]
          .map(esc)
          .join(","),
      )
      .join("\n");
    download("mcp-events.csv", `${cols.join(",")}\n${body}\n`, "text/csv");
  };

  const errCls = stats
    ? stats.errorRate >= 0.2
      ? "is-bad"
      : stats.errorRate >= 0.05
        ? "is-warn"
        : "is-good"
    : "";
  const mcp = (config?.mcp ?? {}) as Record<string, unknown>;
  const dash = (config?.dashboard ?? {}) as Record<string, unknown>;
  const sel = (key: keyof Filter, label: string, opts: string[]): ReactNode => (
    <select
      className="btn"
      value={filter[key]}
      onChange={(e) => setFilter((f) => ({ ...f, [key]: e.target.value }))}
    >
      <option value="">{label}</option>
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  return (
    <div className="obs">
      {/* top bar */}
      <div className="topbar">
        <div className="brand">
          <span className="hd__dot" />
          <div>
            <h1>MikroTik MCP · Observability</h1>
            <small>
              {meta
                ? `${num(meta.total)} events stored · transport ${meta.transport}`
                : "connecting…"}
            </small>
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <span
          className={`live${liveMode !== "off" ? " is-on" : ""}`}
          title="Live transport: WebSocket (preferred) or SSE fallback"
        >
          <span className="dot" />
          {liveMode === "off" ? "offline" : `live · ${liveMode}`}
        </span>
      </div>

      {/* stat cards */}
      <section className="cards">
        {stats ? (
          <>
            <StatCard k="Calls (window)" v={num(stats.total)} />
            <StatCard k="Calls / min" v={stats.callsPerMin.toFixed(1)} />
            <StatCard
              k="Error rate"
              v={`${(stats.errorRate * 100).toFixed(1)}%`}
              sub={`${stats.errors} err`}
              cls={errCls}
            />
            <StatCard k="Avg latency" v={ms(stats.latency.avg)} />
            <StatCard k="p95 latency" v={ms(stats.latency.p95)} />
            <StatCard k="p99 latency" v={ms(stats.latency.p99)} />
            <StatCard k="Distinct tools" v={num(stats.distinctTools)} />
            <StatCard k="Output volume" v={bytes(stats.outputBytes)} />
          </>
        ) : (
          <div className="stat">
            <p className="k">Loading…</p>
            <div className="v">—</div>
          </div>
        )}
      </section>

      {/* time series */}
      <Panel title="Calls over time">
        {stats ? <TimeSeries series={stats.series} /> : <div className="muted">no data</div>}
        <div className="legend">
          <span>
            <i style={{ background: "#34d399" }} />
            ok
          </span>
          <span>
            <i style={{ background: "#f87171" }} />
            error
          </span>
        </div>
      </Panel>

      {/* breakdowns */}
      {stats && (
        <section className="cols-3">
          <Panel title="Top tools">
            <HBars
              rows={stats.byTool.map((t) => ({
                label: t.tool,
                value: t.count,
                sub: `${t.count}× · ${ms(t.p95Ms)} p95${t.errors ? ` · ${t.errors} err` : ""}`,
                color: t.errors ? "#f87171" : undefined,
              }))}
            />
          </Panel>
          <Panel title="By risk">
            <Donut
              segments={(Object.keys(stats.byRisk) as Risk[]).map((r) => ({
                label: r,
                value: stats.byRisk[r],
                color: RISK_COLOR[r],
              }))}
            />
          </Panel>
          <Panel title="Status">
            <Donut
              segments={[
                { label: "ok", value: feedStatus.ok, color: "#34d399" },
                {
                  label: "error",
                  value: feedStatus.error,
                  color: "#f87171",
                },
              ]}
            />
          </Panel>
          <Panel title="By device">
            {stats.byDevice.length ? (
              <HBars
                rows={stats.byDevice.map((d) => ({
                  label: d.device,
                  value: d.count,
                }))}
              />
            ) : (
              <div className="muted">single device</div>
            )}
          </Panel>
          <Panel title="Recent errors">
            {feedErrors.length ? (
              <div className="hbar">
                {feedErrors.slice(0, 8).map((e) => (
                  <div
                    className="hbar__row conn-errrow"
                    style={{ gridTemplateColumns: "auto 1fr" }}
                    key={e.id}
                    onClick={() => void openDetail(e)}
                  >
                    <span className="muted">{clock(e.ts)}</span>
                    <span
                      style={{
                        color: "var(--mt-bad)",
                        // Clamp to one line: a long connection error (e.g. a
                        // MAC-Telnet failure) must ellipsize, not balloon the row.
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        minWidth: 0,
                      }}
                      title={e.error ?? e.output}
                    >
                      {e.tool}: {e.error ?? e.output ?? "error"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">no errors 🎉</div>
            )}
          </Panel>
        </section>
      )}

      {/* devices & connectivity */}
      {devices && devices.devices.length > 0 && (
        <section className="cols">
          <Panel
            title="Connectivity"
            extra={
              <span className="muted">
                {devices.devices.filter((d) => d.status.reachable === true).length} online ·{" "}
                {devices.devices.filter((d) => d.status.reachable === false).length} offline ·{" "}
                {devices.devices.length} total
              </span>
            }
          >
            <ConnectivityGraph payload={devices} pulses={pulses} />
          </Panel>
          <div className="dev-grid">
            {devices.devices.map((d) => (
              <DeviceCard key={d.name} d={d} />
            ))}
          </div>
        </section>
      )}

      {/* live Layer-2 topology map (MNDP/CDP/LLDP discovery) */}
      {topology && topology.nodes.length > 0 && (
        <Panel
          title="Network topology"
          extra={
            <span className="muted">
              Layer-2 neighbours via MNDP/CDP/LLDP · click a neighbour to onboard it
            </span>
          }
        >
          <TopologyMap
            topo={topology}
            onOnboard={(name, body) => {
              setSeed({ name, body });
              setEditingConfig(true);
              document.querySelector(".cfgstudio")?.scrollIntoView({ behavior: "smooth" });
            }}
          />
        </Panel>
      )}

      {/* device system health — realtime gauges + per-metric charts */}
      {devices && devices.devices.length > 0 && (
        <Panel
          title="Device system health"
          extra={<span className="muted">CPU · memory · disk · latency — sampled every 30s</span>}
        >
          <div className="health-grid">
            {devices.devices.map((d) => (
              <DeviceHealthCard key={d.name} d={d} />
            ))}
          </div>
        </Panel>
      )}

      {/* config */}
      {config && (
        <Panel
          title="Configuration"
          extra={
            <button
              className="btn"
              onClick={() => setEditingConfig((v) => !v)}
              title="Edit the config JSON with autocomplete, validation and safe-apply"
            >
              {editingConfig ? "View" : "✎ Edit config"}
            </button>
          }
        >
          {editingConfig ? (
            <ConfigStudio
              key={seed ? `seed-${seed.name}` : "config"}
              initial={
                seed
                  ? {
                      ...config,
                      devices: {
                        ...((config.devices as Record<string, unknown>) ?? {}),
                        [seed.name]: seed.body,
                      },
                    }
                  : config
              }
              onClose={() => {
                setEditingConfig(false);
                setSeed(null);
              }}
              onReload={() => {
                setSeed(null);
                void api<Record<string, unknown>>("/api/config")
                  .then(setConfig)
                  .catch(() => {});
              }}
            />
          ) : (
            <>
              <div className="legend" style={{ margin: "0 0 10px" }}>
                <span>transport: {sval(mcp.transport)}</span>
                <span>read-only: {config.readOnly ? "yes" : "no"}</span>
                <span>
                  dashboard: {sval(dash.host)}:{sval(dash.port)}
                </span>
                <span>capture: {dash.captureBody ? "on" : "off"}</span>
                <span>s3: {config.s3 ? "configured" : "off"}</span>
              </div>
              <details className="cfg">
                <summary>Full effective configuration (secrets redacted)</summary>
                <JsonView value={config} maxHeight={340} />
              </details>
            </>
          )}
        </Panel>
      )}

      {/* live feed */}
      <div className="panel">
        <div className="sheet__hd" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Live tool calls</h2>
          <span style={{ flex: 1 }} />
          <span className="muted">
            {visible.length} shown · {feed.length} buffered
          </span>
        </div>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <div className="grow" style={{ flex: 1, minWidth: 180 }}>
            <input
              className="search"
              type="search"
              placeholder="Search tool / input / output / error…"
              value={filter.q}
              onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
            />
          </div>
          {sel("tool", "all tools", meta?.tools ?? [])}
          {sel("risk", "all risk", [
            "READ",
            "WRITE",
            "WRITE_IDEMPOTENT",
            "DESTRUCTIVE",
            "DANGEROUS",
          ])}
          {sel("device", "all devices", meta?.devices ?? [])}
          {sel("status", "all status", ["ok", "error"])}
          <select
            className="btn"
            value={windowMs}
            onChange={(e) => setWindowMs(Number(e.target.value))}
            title="Time window"
          >
            {WINDOWS.map(([label, val]) => (
              <option key={val} value={val}>
                window: {label}
              </option>
            ))}
          </select>
          <button
            className={`btn${paused ? " is-active" : ""}`}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button className="btn" onClick={() => exportRows("csv")}>
            CSV
          </button>
          <button className="btn" onClick={() => exportRows("json")}>
            JSON
          </button>
          <button
            className="btn"
            onClick={() => setFilter({ tool: "", risk: "", device: "", status: "", q: "" })}
          >
            Clear
          </button>
          {confirmingDelete && selectedIds.size > 0 ? (
            <>
              <button className="btn btn-danger" onClick={() => void deleteSelected()}>
                ✓ Confirm delete ({selectedIds.size})
              </button>
              <button className="btn" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn"
              disabled={selectedIds.size === 0}
              onClick={() => setConfirmingDelete(true)}
              title="Delete the selected rows"
            >
              🗑 Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </button>
          )}
        </div>
        {visible.length === 0 ? (
          hasFilters ? (
            <div className="feed-empty">
              <div className="feed-empty__icon">🔍</div>
              <p className="feed-empty__title">No calls match your filters</p>
              <p className="feed-empty__sub">
                {feed.length} call{feed.length === 1 ? "" : "s"} buffered — try widening the search
                or the risk / device / status filters.
              </p>
              <button
                className="btn"
                onClick={() => setFilter({ tool: "", risk: "", device: "", status: "", q: "" })}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="feed-empty">
              <div className={`feed-empty__pulse${liveMode !== "off" ? " is-on" : ""}`} />
              <p className="feed-empty__title">
                {liveMode === "off" ? "Not connected" : "Listening for tool calls…"}
              </p>
              <p className="feed-empty__sub">
                {liveMode === "off"
                  ? "The live stream is offline — it will reconnect automatically."
                  : "Tool calls the LLM makes against this server stream in here in real time."}
              </p>
            </div>
          )
        ) : (
          <div className="feedwrap">
            <table className="feed">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all shown rows"
                      checked={allShownSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someShownSelected;
                      }}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>time</th>
                  <th>tool</th>
                  <th>risk</th>
                  <th>device</th>
                  <th className="num">dur</th>
                  <th>status</th>
                  <th>output</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.map((e) => (
                  <tr
                    key={e.id}
                    className={
                      `${e.isError ? "is-err" : ""}${selectedIds.has(e.id) ? " is-selected" : ""}`.trim() ||
                      undefined
                    }
                    onClick={() => void openDetail(e)}
                  >
                    <td onClick={(ev) => ev.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={selectedIds.has(e.id)}
                        onChange={() => toggleSelect(e.id)}
                      />
                    </td>
                    <td>{clock(e.ts)}</td>
                    <td>{e.tool}</td>
                    <td>
                      <span className={`risk risk-${e.risk}`}>
                        {e.risk.replace("WRITE_IDEMPOTENT", "WRITE·I")}
                      </span>
                    </td>
                    <td>{e.device ?? "—"}</td>
                    <td className="num">{ms(e.durationMs)}</td>
                    <td>
                      <span className={e.isError ? "status-err" : "status-ok"}>
                        {e.isError ? "error" : "ok"}
                      </span>
                    </td>
                    <td className="preview">
                      {e.isError ? (e.error ?? "error") : e.output || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && <DetailDrawer event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<App />);
