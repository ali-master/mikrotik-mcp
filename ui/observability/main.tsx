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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from "react";
import { createRoot } from "react-dom/client";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { api, deleteEvents, postJson, withToken } from "./api";
import { ActivityChart, MetricArea, RadialGauge, RiskDonut } from "./charts";
import { ConfigHistoryPanel, FieldGuidePanel } from "./config-panels";
import { Badge, Button, Dot, Note, Spinner } from "./geist";
import "./tailwind.css";
import "./styles.css";

gsap.registerPlugin(ScrollTrigger);

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
interface PacketSummary {
  ts: number;
  len: number;
  ethType: string;
  src?: string;
  dst?: string;
  protocol?: string;
  info: string;
}
interface CaptureStats {
  running: boolean;
  port: number;
  startedAt: number | null;
  packets: number;
  bytes: number;
  protocols: Record<string, number>;
  topTalkers: { addr: string; count: number }[];
  pcapFrames: number;
}
interface CapturePayload {
  packets: PacketSummary[];
  stats: CaptureStats;
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
  READ: "#d4d4d8",
  WRITE: "#a1a1aa",
  WRITE_IDEMPOTENT: "#e4e4e7",
  DESTRUCTIVE: "#f87171",
  DANGEROUS: "#ef4444",
};

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
  className,
}: {
  title?: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={`panel${className ? ` ${className}` : ""}`}>
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
  if (s.reachable === true) return { label: "online", color: "#d4d4d8" };
  if (s.reachable === false) return { label: "offline", color: "#f87171" };
  return { label: "checking…", color: "#71717a" };
}

/**
 * A stable, vivid colour per device, derived deterministically from its name —
 * so each device keeps the same colour across reloads with no storage, and a new
 * device gets a distinct hue. Used to tint its connectivity orb and device card.
 */
function deviceColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 62%)`;
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

const FLOW_CMD = "#e4e4e7"; // command: LLM → device
const FLOW_RES = "#d4d4d8"; // response: device → LLM

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
/** Truncate a node label to what the largest orb can hold (mono ≈ 6.2px/char). */
const NODE_MAX_R = 70;
const NODE_MAX_CHARS = Math.floor((2 * NODE_MAX_R - 24) / 6.2);
const nodeLabel = (raw: string): string =>
  raw.length > NODE_MAX_CHARS ? `${raw.slice(0, NODE_MAX_CHARS - 1)}…` : raw;
/** Circle radius that fits `label` across its diameter, clamped to [23, NODE_MAX_R]. */
const nodeRadius = (label: string): number =>
  Math.max(23, Math.min(NODE_MAX_R, label.length * 3.1 + 12));

function ConnectivityGraph({
  payload,
  pulses,
}: {
  payload: DevicesPayload;
  pulses: Record<string, number>;
}): ReactNode {
  const devices = payload.devices;
  const n = Math.max(1, devices.length);

  // Each orb's radius scales with its device name, so the ring must leave room
  // for the largest orb AND a clear lane between the core and every node, or the
  // command/response lines, arrows and packets get hidden under the circles.
  const sized = devices.map((d) => {
    const label = nodeLabel(d.name);
    return { d, label, r: nodeRadius(label) };
  });
  const maxR = Math.max(23, ...sized.map((s) => s.r));
  const CORE = 46; // core hub glow radius
  const LANE = 64; // guaranteed clear gap (core edge → node edge) for the flow
  // Ring radius: clearance from the core for the lanes, plus enough that adjacent
  // orbs on the ring don't collide, plus a sensible floor.
  const spacingR = n > 1 ? (maxR + 18) / Math.sin(Math.PI / n) : 0;
  const R = Math.max(CORE + LANE + maxR, spacingR, 120);
  const PAD = maxR + 60; // orb + its two label lines + margin
  const W = Math.max(700, Math.round((R + maxR + 40) * 2));
  const H = Math.round((R + PAD) * 2);
  const cx = W / 2;
  const cy = H / 2;
  const core = { x: cx, y: cy };

  const nodes = sized.map((s, i) => {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2 + (n % 2 === 0 ? Math.PI / n : 0);
    return { ...s, i, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
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
          <radialGradient id="conn-hub" cx="0.5" cy="0.34" r="0.75">
            <stop offset="0" stopColor="#fafafa" />
            <stop offset="0.6" stopColor="#d4d4d8" />
            <stop offset="1" stopColor="#a1a1aa" />
          </radialGradient>
          <radialGradient id="conn-orb" cx="0.5" cy="0.32" r="0.85">
            <stop offset="0" stopColor="#27272a" />
            <stop offset="1" stopColor="#18181b" />
          </radialGradient>
          <radialGradient id="conn-burst" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fafafa" />
            <stop offset="0.5" stopColor="#e4e4e7" />
            <stop offset="1" stopColor="#a1a1aa" stopOpacity="0" />
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
        <circle cx={cx} cy={cy} r={29} fill="url(#conn-hub)" stroke="#71717a" strokeWidth={1.5} />
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#09090b" fontSize={12} fontWeight={700}>
          LLM
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fill="#3f3f46" fontSize={8} fontWeight={600}>
          ⇄ MCP
        </text>
        <text x={cx} y={cy + 18} textAnchor="middle" fill="#3f3f46" fontSize={7.5} fontWeight={600}>
          server
        </text>

        {/* device nodes */}
        {nodes.map(({ d, x, y, r, label }) => {
          const info = statusInfo(d.status);
          const online = d.status.reachable === true;
          const detail = online ? `${d.status.latencyMs ?? "?"} ms` : info.label;
          // Each device's orb carries its own persistent colour; the small corner
          // dot still shows live online/offline status.
          const col = deviceColor(d.name);
          return (
            <g key={`n-${d.name}`} className="conn-node">
              {online && <circle className="conn-node-halo" cx={x} cy={y} r={r + 1} stroke={col} />}
              {/* subtle fill tint in the device's colour, over the dark orb */}
              <circle cx={x} cy={y} r={r} fill="url(#conn-orb)" />
              <circle cx={x} cy={y} r={r} fill={col} opacity={0.16} />
              <circle cx={x} cy={y} r={r} fill="none" stroke={col} strokeWidth={2.5} />
              <circle
                className={online ? "conn-blink" : undefined}
                cx={x + r * 0.7}
                cy={y - r * 0.7}
                r={4.5}
                fill={info.color}
                stroke="#0a121b"
                strokeWidth={1.5}
              />
              <text
                x={x}
                y={y + 3.5}
                textAnchor="middle"
                fill="#fafafa"
                fontSize={10}
                fontWeight={600}
              >
                {label}
              </text>
              <text x={x} y={y + r + 14} textAnchor="middle" fill="#a1a1aa" fontSize={9}>
                {d.address ?? d.host}
              </text>
              <text
                x={x}
                y={y + r + 26}
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
          <i style={{ background: "#e4e4e7" }} /> live call (round-trip)
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
  const col = deviceColor(d.name);
  return (
    <div className="card dev-card" style={{ borderLeft: `3px solid ${col}` }}>
      <div className="dev-card__top">
        <span className="dot" style={{ background: col }} title="device colour" />
        <span className="dev-card__name">{d.name}</span>
        {d.isDefault && <Badge type="accent">default</Badge>}
        <span className="dot dot--status" style={{ background: info.color }} title={info.label} />
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
const memHuman = (b?: number): string => (b == null ? "?" : bytes(b));

/** One device's realtime system-health card: gauges + sparkline charts. */
function DeviceHealthCard({ d }: { d: DeviceInfo }): ReactNode {
  const s = d.status;
  const hist = d.history ?? [];
  const probed = s.reachable === true || hist.length > 0;
  if (!probed) {
    return (
      <div className="card health-card health-card--na">
        <div className="health-card__hd">
          <Dot color={statusInfo(s).color} />
          <span className="dev-card__name">{d.name}</span>
          {d.isDefault && <Badge type="accent">default</Badge>}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {s.reachable === false
            ? `Offline — ${s.error ?? "unreachable"}`
            : d.mac
              ? "Waiting for the first MAC-Telnet probe (these run every few minutes to avoid contending with tool calls)…"
              : "Waiting for the first health probe…"}
        </p>
      </div>
    );
  }
  return (
    <div className="card health-card">
      <div className="health-card__hd">
        <Dot color={statusInfo(s).color} />
        <span className="dev-card__name">{d.name}</span>
        {d.isDefault && <Badge type="accent">default</Badge>}
        <span style={{ flex: 1 }} />
        <Badge type={s.version ? "success" : "default"}>{s.version ? `v${s.version}` : "—"}</Badge>
      </div>
      <div className="health-card__sub muted">
        {s.boardName ?? "router"}
        {s.architecture ? ` · ${s.architecture}` : ""}
        {s.cpuCount ? ` · ${s.cpuCount} cpu` : ""}
        {s.uptime ? ` · up ${s.uptime}` : ""}
      </div>
      <div className="health-card__gauges">
        <RadialGauge value={s.cpuLoad} label="CPU" color="#ededed" />
        <RadialGauge value={s.memUsedPct} label="MEM" color="#bdbdc4" />
        <RadialGauge value={s.hddUsedPct} label="DISK" color="#8a8a92" />
      </div>
      <div className="health-card__charts">
        <div className="health-chart">
          <span className="health-chart__k">CPU load</span>
          <MetricArea values={hist.map((h) => h.cpuLoad)} color="#ededed" maxValue={100} unit="%" />
        </div>
        <div className="health-chart">
          <span className="health-chart__k">Memory used</span>
          <MetricArea
            values={hist.map((h) => h.memUsedPct)}
            color="#bdbdc4"
            maxValue={100}
            unit="%"
          />
        </div>
        <div className="health-chart">
          <span className="health-chart__k">Probe latency</span>
          <MetricArea values={hist.map((h) => h.latencyMs)} color="#bdbdc4" unit="ms" />
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

// ── GSAP scroll reveals ──────────────────────────────────────────────────────
/**
 * Fades + lifts every `.reveal` element into view on scroll. Panels render
 * asynchronously as data lands (devices, topology, capture…), so a
 * MutationObserver arms newcomers too — not just the elements present on mount.
 * Honours `prefers-reduced-motion`: when set, we never hide content (the CSS
 * `.js-motion` gate is also keyed off the class we add here).
 */
function useReveals(rootRef: RefObject<HTMLElement | null>): void {
  // Layout effect (pre-paint) so reveals are hidden before the first frame — no
  // flash-of-visible-then-animate. If the bundle never runs, nothing is hidden.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("js-motion");

    const seen = new WeakSet<Element>();
    const arm = (el: Element): void => {
      if (seen.has(el)) return;
      seen.add(el);
      gsap.set(el, { opacity: 0, y: 26 });
      ScrollTrigger.create({
        trigger: el,
        start: "top 90%",
        once: true,
        onEnter: () => gsap.to(el, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }),
      });
    };
    const scan = (node: ParentNode): void => {
      for (const el of node.querySelectorAll(".reveal")) arm(el);
    };
    scan(root);

    const mo = new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (n.matches(".reveal")) arm(n);
          scan(n);
        }
    });
    mo.observe(root, { childList: true, subtree: true });

    // The page keeps growing as polled data arrives; recompute trigger offsets
    // for a few seconds so late panels land at the right scroll positions.
    const refresh = setInterval(() => ScrollTrigger.refresh(), 1200);
    const stop = setTimeout(() => clearInterval(refresh), 7000);

    return () => {
      mo.disconnect();
      clearInterval(refresh);
      clearTimeout(stop);
      for (const t of ScrollTrigger.getAll()) t.kill();
      document.documentElement.classList.remove("js-motion");
    };
  }, [rootRef]);
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
    for (const f of ["items", "additionalProperties", "anyOf", "oneOf", "allOf"]) {
      const v = n[f];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
    // `$defs` / `definitions` are maps of (name → schema): walk each *value*, not
    // the container (whose own keys are def names, not properties), so device-level
    // fields survive if Zod ever emits a $ref form instead of an inlined schema.
    for (const f of ["$defs", "definitions", "patternProperties"]) {
      const v = n[f];
      if (v && typeof v === "object") for (const sub of Object.values(v)) walk(sub);
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
  const [ac, setAc] = useState<{
    items: string[];
    index: number;
    start: number;
    x: number;
    y: number;
  } | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; label: string }>>({});
  const [preview, setPreview] = useState<{ summary?: DiffSummary; unified?: string } | null>(null);
  const [pending, setPending] = useState<SaveResp | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [rollbackMs, setRollbackMs] = useState(60_000);
  const [msg, setMsg] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<number | null>(null);
  const hlRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLPreElement | null>(null);

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
    if (!items.length) {
      setAc(null);
      return;
    }
    // The editor font is monospace, so caret pixel position is exact: column ×
    // char-advance and line × line-height (12px / 1.5 = 18px, 10/12px padding).
    const before = el.value.slice(0, el.selectionStart).split("\n");
    const col = before[before.length - 1].length;
    const x = Math.min(12 + col * 7.22 - el.scrollLeft, el.clientWidth - 160);
    const y = 10 + before.length * 18 - el.scrollTop + 4;
    setAc({ items, index: 0, start, x: Math.max(4, x), y });
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
        <pre className="cfg-gutter" aria-hidden="true" ref={gutterRef}>
          {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
        </pre>
        <div className="cfg-ta-wrap">
          {/* Highlight overlay sits behind a transparent-text textarea; both share
              identical geometry and scroll in lockstep so the colours line up. */}
          <pre className="cfg-hl" aria-hidden="true" ref={hlRef}>
            {highlightJson(text)}
            {"\n"}
          </pre>
          <textarea
            ref={taRef}
            className="cfg-ta"
            spellCheck={false}
            wrap="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              refreshAc(e.currentTarget);
            }}
            onKeyDown={onKeyDown}
            onClick={() => setAc(null)}
            onScroll={(e) => {
              const ta = e.currentTarget;
              if (hlRef.current) {
                hlRef.current.scrollTop = ta.scrollTop;
                hlRef.current.scrollLeft = ta.scrollLeft;
              }
              if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
            }}
          />
          {ac && (
            <div className="cfg-ac" style={{ left: ac.x, top: ac.y }}>
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
  if (v == null) return "#3f3f46";
  if (v >= 85) return "#f87171";
  if (v >= 60) return "#a1a1aa";
  return "#d4d4d8";
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
              ? "#d4d4d8"
              : n.reachable === false
                ? "#f87171"
                : isDev
                  ? "#71717a"
                  : "#e4e4e7";
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
            <i className="dot" style={{ background: "#d4d4d8" }} /> online
          </span>
          <span>
            <i className="dot" style={{ background: "#f87171" }} /> offline
          </span>
          <span>
            <i className="dot" style={{ background: "#e4e4e7" }} /> neighbour
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
                <CopyButton
                  className="topo-btn"
                  title="Copy config stub"
                  label="Copy config stub"
                  text={JSON.stringify(
                    { [pickedNode.suggestedConfig.name]: stubBody(pickedNode.suggestedConfig) },
                    null,
                    2,
                  )}
                />
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

/** Tokenise JSON text into coloured `<span>`s (plain runs stay as raw strings). */
function highlightJson(json: string): ReactNode[] {
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
  return parts;
}

// ── Packet Capture Studio ────────────────────────────────────────────────────
const PROTO_COLOR: Record<string, string> = {
  TCP: "#e4e4e7",
  UDP: "#d4d4d8",
  ICMP: "#a1a1aa",
  ICMPv6: "#a1a1aa",
  ARP: "#e4e4e7",
  IPv6: "#a1a1aa",
};
const protoColor = (p: string | undefined): string => (p && PROTO_COLOR[p]) || "#71717a";

/** Live packet capture: protocol mix, top talkers, a scrolling packet list, pcap export. */
function PacketCapture(): ReactNode {
  const [data, setData] = useState<CapturePayload | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = (): void =>
      void api<CapturePayload>("/api/capture/packets?limit=150")
        .then(setData)
        .catch(() => {});
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, []);

  const stats = data?.stats;
  const packets = data?.packets ?? [];
  const stop = async (): Promise<void> => {
    setBusy(true);
    await postJson("/api/capture/stop", {}).catch(() => {});
    setBusy(false);
  };

  if (!stats || (!stats.running && stats.packets === 0)) {
    return (
      <div className="cap-idle muted">
        No capture running. Start one with the <code>start_packet_capture</code> tool — point the
        device's TZSP stream at this host — and decoded packets stream in here live.
      </div>
    );
  }

  const maxProto = Math.max(1, ...Object.values(stats.protocols));
  return (
    <div className="cap">
      <div className="cap-bar">
        <span className={`cap-dot${stats.running ? " is-on" : ""}`} />
        <b>{stats.running ? "capturing" : "stopped"}</b>
        <span className="muted">UDP {stats.port}</span>
        <span className="muted">
          {num(stats.packets)} pkts · {bytes(stats.bytes)}
        </span>
        <span style={{ flex: 1 }} />
        <a className="btn" href={withToken("/api/capture/pcap")} download="capture.pcap">
          ⤓ pcap
        </a>
        <button
          className="btn btn-danger"
          onClick={() => void stop()}
          disabled={busy || !stats.running}
        >
          ■ Stop
        </button>
      </div>
      <div className="cap-cols">
        <div className="cap-side">
          <div className="cap-h">Protocols</div>
          {Object.entries(stats.protocols).map(([p, n]) => (
            <div className="cap-pbar" key={p}>
              <span className="cap-plabel" style={{ color: protoColor(p) }}>
                {p}
              </span>
              <span className="cap-ptrack">
                <i style={{ width: `${(n / maxProto) * 100}%`, background: protoColor(p) }} />
              </span>
              <span className="cap-pn">{n}</span>
            </div>
          ))}
          <div className="cap-h" style={{ marginTop: 12 }}>
            Top talkers
          </div>
          {stats.topTalkers.length === 0 && <div className="muted">—</div>}
          {stats.topTalkers.map((t) => (
            <div className="cap-talker" key={t.addr}>
              <span>{t.addr}</span>
              <b>{t.count}</b>
            </div>
          ))}
        </div>
        <div className="cap-list">
          {packets.length === 0 ? (
            <div className="muted" style={{ padding: 10 }}>
              waiting for packets…
            </div>
          ) : (
            packets.map((p, i) => (
              <div className="cap-row" key={i}>
                <span className="cap-tt">{clock(p.ts)}</span>
                <span className="cap-proto" style={{ color: protoColor(p.protocol) }}>
                  {p.protocol ?? p.ethType}
                </span>
                <span className="cap-len">{p.len}</span>
                <span className="cap-info">{p.info}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function JsonView({ value, maxHeight }: { value: unknown; maxHeight?: number }): ReactNode {
  const json = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="body json" style={maxHeight ? { maxHeight } : undefined}>
      {highlightJson(json)}
    </pre>
  );
}

// ── Config snapshots view ────────────────────────────────────────────────────
interface Snapshot {
  id: string;
  device: string;
  ts: number;
  label?: string;
  rosVersion?: string;
  bytes: number;
  lines: number;
  sha: string;
  body?: string;
}

/** Browse stored `/export` snapshots and time-travel diff any two. */
function SnapshotsView(): ReactNode {
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sel, setSel] = useState<Snapshot | null>(null);
  const [diff, setDiff] = useState<{ summary: DiffSummary; unified: string } | null>(null);

  const load = useCallback(() => {
    void api<{ snapshots: Snapshot[] }>("/api/snapshots")
      .then((r) => setSnaps(r.snapshots))
      .catch(() => setSnaps([]));
  }, []);
  useEffect(() => load(), [load]);

  const viewBody = (id: string): void => {
    void api<Snapshot>(`/api/snapshot/${encodeURIComponent(id)}`)
      .then(setSel)
      .catch(() => {});
  };
  const runDiff = (): void => {
    if (!from || !to) return;
    void postJson<{ summary: DiffSummary; unified: string }>("/api/snapshots/diff", { from, to })
      .then(setDiff)
      .catch(() => {});
  };

  if (!snaps) return <div className="muted">loading snapshots…</div>;
  if (snaps.length === 0) {
    return (
      <div className="feed-empty">
        <div className="feed-empty__icon">🕰️</div>
        <p className="feed-empty__title">No config snapshots yet</p>
        <p className="feed-empty__sub">
          Capture one with the <code>capture_config_snapshot</code> tool — then time-travel diff any
          two here.
        </p>
      </div>
    );
  }

  const opts = snaps.map((s) => (
    <option key={s.id} value={s.id}>
      {s.device} · {s.label ?? s.id} · {clock(s.ts)}
    </option>
  ));

  return (
    <section className="view">
      <Panel
        title="Config snapshots"
        className="reveal"
        extra={
          <button className="btn" onClick={load}>
            ↻ Refresh
          </button>
        }
      >
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <select className="btn" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">diff from…</option>
            {opts}
          </select>
          <select className="btn" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">to…</option>
            {opts}
          </select>
          <button className="btn is-active" onClick={runDiff} disabled={!from || !to}>
            Diff →
          </button>
          <span className="muted">{snaps.length} snapshots</span>
        </div>
        <div className="feedwrap">
          <table className="feed">
            <thead>
              <tr>
                <th>captured</th>
                <th>device</th>
                <th>label</th>
                <th>version</th>
                <th className="num">lines</th>
                <th className="num">size</th>
                <th>output</th>
              </tr>
            </thead>
            <tbody>
              {snaps.map((s) => (
                <tr
                  key={s.id}
                  className={sel?.id === s.id ? "is-selected" : undefined}
                  onClick={() => viewBody(s.id)}
                >
                  <td>{clock(s.ts)}</td>
                  <td>{s.device}</td>
                  <td>{s.label ?? "—"}</td>
                  <td>{s.rosVersion ?? "—"}</td>
                  <td className="num">{s.lines}</td>
                  <td className="num">{bytes(s.bytes)}</td>
                  <td className="preview">view export →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {diff && (
        <Panel
          title="Time-travel diff"
          className="reveal"
          extra={
            <span className="muted">
              {diff.summary.changed
                ? `+${diff.summary.added} / -${diff.summary.removed}`
                : "identical"}
            </span>
          }
        >
          <pre className="cfg-diff">
            {(diff.unified || "(identical)").split("\n").map((l, i) => (
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
        </Panel>
      )}

      {sel && (
        <Panel
          title={`Snapshot · ${sel.label ?? sel.id}`}
          className="reveal"
          extra={
            <Button type="secondary" size="sm" onClick={() => setSel(null)}>
              ✕ Close
            </Button>
          }
        >
          <pre className="body" style={{ maxHeight: 460 }}>
            {sel.body || "(empty)"}
          </pre>
        </Panel>
      )}
    </section>
  );
}

// ── Change plan (dry-run) view ───────────────────────────────────────────────
interface PlanStep {
  index: number;
  command: string;
  path: string;
  op: string;
  risk: string;
  summary: string;
  lockoutRisk?: string;
}
interface ChangePlan {
  steps: PlanStep[];
  counts: { add: number; modify: number; remove: number; other: number; total: number };
  riskScore: number;
  grade: string;
  warnings: string[];
  reordered: boolean;
}
const OP_BADGE: Record<string, string> = {
  add: "+",
  set: "~",
  remove: "−",
  enable: "▲",
  disable: "▽",
  move: "⇅",
};

/** Paste intended commands and preview a risk-scored, safely-ordered plan (no device I/O). */
function ChangePlanView(): ReactNode {
  const [script, setScript] = useState("");
  const [res, setRes] = useState<{ plan: ChangePlan; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const r = await postJson<{ plan?: ChangePlan; text?: string; error?: string }>("/api/plan", {
      script,
    }).catch((): { plan?: ChangePlan; text?: string; error?: string } => ({
      error: "request failed",
    }));
    setBusy(false);
    if (r.error || !r.plan) {
      setErr(r.error ?? "no plan produced");
      setRes(null);
      return;
    }
    setRes({ plan: r.plan, text: r.text ?? "" });
  };

  const grade = res?.plan.grade ?? "";
  const gradeBad = grade === "critical" || grade === "high";

  return (
    <section className="view">
      <Panel
        title="Change plan — dry-run"
        className="reveal"
        extra={
          <span className="muted">
            terraform-style preview · pure analysis, never touches a device
          </span>
        }
      >
        <textarea
          className="plan-input"
          spellCheck={false}
          placeholder={
            "Paste intended RouterOS commands, one per line, e.g.\n/ip firewall filter add chain=input action=drop in-interface=WAN\n/ip address add address=10.0.0.1/24 interface=ether1\n/ip address remove [find address=192.168.88.1/24]"
          }
          value={script}
          onChange={(e) => setScript(e.target.value)}
        />
        <div className="toolbar" style={{ marginTop: 10 }}>
          <button
            className="btn is-active"
            onClick={() => void run()}
            disabled={busy || !script.trim()}
          >
            {busy ? "Planning…" : "▸ Plan"}
          </button>
          {err && <span className="cfg-err">{err}</span>}
        </div>
      </Panel>

      {res && (
        <Panel
          title="Plan"
          className="reveal"
          extra={
            <span className={`cfg-status ${gradeBad ? "is-bad" : "is-ok"}`}>
              risk {res.plan.riskScore} · {grade}
            </span>
          }
        >
          <div className="legend" style={{ marginTop: 0 }}>
            <span>+{res.plan.counts.add} to add</span>
            <span>~{res.plan.counts.modify} to modify</span>
            <span>-{res.plan.counts.remove} to remove</span>
            {res.plan.reordered && <span>· reordered into a safe sequence</span>}
          </div>
          {res.plan.warnings.length > 0 && (
            <div className="cfg-errors" style={{ margin: "10px 0" }}>
              {res.plan.warnings.map((w, i) => (
                <div className="cfg-err" key={i} style={{ color: "var(--mt-warn)" }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}
          <div className="plan-steps">
            {res.plan.steps.map((s) => (
              <div className={`plan-step risk-${s.risk}`} key={s.index}>
                <span className="plan-op">{OP_BADGE[s.op] ?? "•"}</span>
                <code>{s.command}</code>
                {s.lockoutRisk && <span className="plan-lock">⚠ lock-out</span>}
                <span className="plan-risk">{s.risk}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </section>
  );
}

// ── S3 backup management view ────────────────────────────────────────────────
interface S3Object {
  key: string;
  size: number;
  lastModified: string | null;
}
interface S3List {
  configured: boolean;
  target?: string;
  objects: S3Object[];
  truncated?: boolean;
}

/** List, download (presigned) and delete objects in the configured S3 bucket. */
function S3Manage(): ReactNode {
  const [data, setData] = useState<S3List | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<S3List>("/api/s3/list")
      .then(setData)
      .catch(() => setData({ configured: false, objects: [] }));
  }, []);
  useEffect(() => load(), [load]);

  const download = (key: string): void => {
    void api<{ url?: string }>(`/api/s3/presign?key=${encodeURIComponent(key)}`)
      .then((r) => {
        if (r.url) window.open(r.url, "_blank", "noopener");
        else setMsg("could not generate download link");
      })
      .catch(() => setMsg("could not generate download link"));
  };
  const del = async (key: string): Promise<void> => {
    setBusy(key);
    const r = await postJson<{ ok?: boolean; error?: string }>("/api/s3/delete", { key }).catch(
      (): { ok?: boolean; error?: string } => ({ error: "request failed" }),
    );
    setBusy(null);
    setConfirm(null);
    if (r.ok) {
      setMsg(`Deleted ${key}`);
      load();
    } else {
      setMsg(r.error ?? "delete failed");
    }
  };

  if (!data) return <div className="muted">loading S3 objects…</div>;
  if (!data.configured) {
    return (
      <div className="feed-empty">
        <div className="feed-empty__icon">☁️</div>
        <p className="feed-empty__title">S3 is not configured</p>
        <p className="feed-empty__sub">
          Add an <code>s3</code> block (bucket + credentials) to your config to manage backup
          objects here.
        </p>
      </div>
    );
  }

  return (
    <section className="view">
      <Panel
        title="S3 backups"
        className="reveal"
        extra={
          <>
            <span className="muted">
              {data.target} · {data.objects.length} object{data.objects.length === 1 ? "" : "s"}
              {data.truncated ? " (truncated)" : ""}
            </span>
            <button className="btn" onClick={load} style={{ marginLeft: 10 }}>
              ↻ Refresh
            </button>
          </>
        }
      >
        {msg && <div className="cfg-msg">{msg}</div>}
        {data.objects.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>
            No objects in the bucket. Upload one with the <code>upload_backup_to_s3</code> tool.
          </div>
        ) : (
          <div className="feedwrap">
            <table className="feed">
              <thead>
                <tr>
                  <th>key</th>
                  <th className="num">size</th>
                  <th>modified</th>
                  <th style={{ width: 200 }}>actions</th>
                </tr>
              </thead>
              <tbody>
                {data.objects.map((o) => (
                  <tr key={o.key}>
                    <td>{o.key}</td>
                    <td className="num">{bytes(o.size)}</td>
                    <td>{o.lastModified ? new Date(o.lastModified).toLocaleString() : "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn" onClick={() => download(o.key)}>
                        ⤓ Download
                      </button>{" "}
                      {confirm === o.key ? (
                        <>
                          <button
                            className="btn btn-danger"
                            disabled={busy === o.key}
                            onClick={() => void del(o.key)}
                          >
                            ✓ Confirm
                          </button>{" "}
                          <button className="btn" onClick={() => setConfirm(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button className="btn" onClick={() => setConfirm(o.key)}>
                          🗑 Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  );
}

// ── Local backup vault view ──────────────────────────────────────────────────
interface BackupItem {
  name: string;
  bytes: number;
  modified: number;
  device?: string;
}
interface BackupsData {
  dir: string;
  devices: string[];
  backups: BackupItem[];
}

/** Manage the host-side backup vault: create, download, upload, rename, restore, delete. */
function BackupsView(): ReactNode {
  const [data, setData] = useState<BackupsData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [restoreName, setRestoreName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null);
  const [device, setDevice] = useState("");
  const [body, setBody] = useState<{ name: string; content: string } | null>(null);
  const [dirEdit, setDirEdit] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    void api<BackupsData>("/api/backups")
      .then((d) => {
        setData(d);
        setDevice((cur) => cur || d.devices[0] || "");
      })
      .catch(() => setData({ dir: "", devices: [], backups: [] }));
  }, []);
  useEffect(() => load(), [load]);

  type R = { ok?: boolean; error?: string; name?: string };
  const post = (path: string, b: unknown): Promise<R> =>
    postJson<R>(path, b).catch((): R => ({ error: "request failed" }));

  const create = async (): Promise<void> => {
    setBusy(true);
    setMsg("Capturing /export…");
    const r = await postJson<{ ok?: boolean; name?: string; bytes?: number; error?: string }>(
      "/api/backups/create",
      { device: device || undefined },
    ).catch((): { ok?: boolean; name?: string; bytes?: number; error?: string } => ({
      error: "request failed",
    }));
    setBusy(false);
    setMsg(r.ok ? `Created ${r.name} (${r.bytes} bytes)` : `Create failed: ${r.error}`);
    if (r.ok) load();
  };
  const upload = async (file: File): Promise<void> => {
    const content = await file.text();
    const r = await post("/api/backups/upload", { name: file.name, content });
    setMsg(r.ok ? `Uploaded ${r.name}` : `Upload failed: ${r.error}`);
    if (r.ok) load();
  };
  const del = async (name: string): Promise<void> => {
    setConfirmDel(null);
    const r = await post("/api/backups/delete", { name });
    setMsg(r.ok ? `Deleted ${name}` : `Delete failed: ${r.error}`);
    if (r.ok) load();
  };
  const rename = async (): Promise<void> => {
    if (!renaming) return;
    const { name, value } = renaming;
    setRenaming(null);
    if (!value || value === name) return;
    const r = await post("/api/backups/rename", { name, new_name: value });
    setMsg(r.ok ? `Renamed to ${r.name}` : `Rename failed: ${r.error}`);
    if (r.ok) load();
  };
  const restore = async (confirm: boolean): Promise<void> => {
    if (!restoreName) return;
    setBusy(true);
    setMsg(confirm ? "Restoring in Safe Mode…" : "Dry-run restore in Safe Mode…");
    const r = await postJson<{
      ok?: boolean;
      committed?: boolean;
      applied?: number;
      message?: string;
    }>("/api/backups/restore", { name: restoreName, device: device || undefined, confirm }).catch(
      (): { ok?: boolean; committed?: boolean; applied?: number; message?: string } => ({
        ok: false,
        message: "request failed",
      }),
    );
    setBusy(false);
    setMsg(
      r.ok
        ? r.committed
          ? `Restored ${restoreName} → ${device}: ${r.message}`
          : `Dry-run OK (${r.applied} cmds, rolled back). Click “Restore (commit)” to apply for real.`
        : `Restore failed: ${r.message}`,
    );
    if (r.ok && confirm) setRestoreName(null);
  };
  const viewBody = (name: string): void => {
    void api<{ name: string; content: string }>(`/api/backups/get?name=${encodeURIComponent(name)}`)
      .then(setBody)
      .catch(() => {});
  };
  const saveDir = async (): Promise<void> => {
    if (dirEdit === null) return;
    const dir = dirEdit.trim();
    if (!dir || dir === data?.dir) {
      setDirEdit(null);
      return;
    }
    setBusy(true);
    type DirResp = {
      ok?: boolean;
      dir?: string;
      persisted?: boolean;
      warning?: string;
      error?: string;
    };
    const r = await postJson<DirResp>("/api/backups/dir", { dir }).catch(
      (): DirResp => ({ error: "request failed" }),
    );
    setBusy(false);
    setDirEdit(null);
    if (r.ok)
      setMsg(
        r.persisted ? `Backup path saved → ${r.dir}` : (r.warning ?? `Path applied → ${r.dir}`),
      );
    else setMsg(`Path change failed: ${r.error}`);
    if (r.ok) load();
  };

  if (!data) return <div className="muted">loading backups…</div>;

  return (
    <section className="view">
      <Panel
        title="Local backup vault"
        className="reveal"
        extra={
          dirEdit === null ? (
            <span className="muted backup-path">
              <span title={data.dir}>{data.dir}</span>
              <button
                className="linkish"
                title="Change backup directory"
                onClick={() => setDirEdit(data.dir)}
              >
                ✎ edit path
              </button>
            </span>
          ) : (
            <span className="backup-path">
              <input
                className="backup-path-input"
                value={dirEdit}
                autoFocus
                spellCheck={false}
                placeholder="~/.mikrotik-mcp/backups"
                onChange={(e) => setDirEdit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveDir();
                  if (e.key === "Escape") setDirEdit(null);
                }}
              />
              <button className="topo-btn cfg-save" onClick={() => void saveDir()} disabled={busy}>
                Save path
              </button>
              <button className="topo-btn" onClick={() => setDirEdit(null)}>
                Cancel
              </button>
            </span>
          )
        }
      >
        {msg && <div className="cfg-msg">{msg}</div>}
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <select className="btn" value={device} onChange={(e) => setDevice(e.target.value)}>
            {data.devices.length === 0 && <option value="">no devices</option>}
            {data.devices.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            className="btn is-active"
            onClick={() => void create()}
            disabled={busy || !device}
          >
            ⤓ Create backup
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            ⤒ Upload .rsc
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".rsc,text/plain"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.currentTarget.value = "";
            }}
          />
          <button className="btn" onClick={load}>
            ↻ Refresh
          </button>
        </div>

        {restoreName && (
          <div className="cfg-banner" style={{ marginBottom: 12 }}>
            <strong>Restore {restoreName}</strong> onto{" "}
            <select
              className="cfg-select"
              value={device}
              onChange={(e) => setDevice(e.target.value)}
            >
              {data.devices.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>{" "}
            via Safe Mode (auto-reverts on lock-out).
            <span style={{ flex: 1 }} />
            <button className="topo-btn" onClick={() => void restore(false)} disabled={busy}>
              Dry-run
            </button>
            <button
              className="topo-btn cfg-save"
              onClick={() => void restore(true)}
              disabled={busy}
            >
              Restore (commit)
            </button>
            <button className="topo-btn" onClick={() => setRestoreName(null)}>
              Cancel
            </button>
          </div>
        )}

        {data.backups.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>
            No backups yet. Click “Create backup” to capture this device’s config, or upload a
            `.rsc`.
          </div>
        ) : (
          <div className="feedwrap">
            <table className="feed">
              <thead>
                <tr>
                  <th>name</th>
                  <th>device</th>
                  <th className="num">size</th>
                  <th>captured</th>
                  <th style={{ width: 280 }}>actions</th>
                </tr>
              </thead>
              <tbody>
                {data.backups.map((b) => (
                  <tr key={b.name} className={body?.name === b.name ? "is-selected" : undefined}>
                    <td>{b.name}</td>
                    <td>{b.device ?? "—"}</td>
                    <td className="num">{bytes(b.bytes)}</td>
                    <td>{new Date(b.modified).toLocaleString()}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn" onClick={() => viewBody(b.name)}>
                        view
                      </button>{" "}
                      <a
                        className="btn"
                        href={withToken(`/api/backups/raw?name=${encodeURIComponent(b.name)}`)}
                        download={b.name}
                      >
                        ⤓
                      </a>{" "}
                      {renaming?.name === b.name ? (
                        <>
                          <input
                            className="search"
                            style={{ display: "inline-block", width: 150 }}
                            value={renaming.value}
                            autoFocus
                            onChange={(e) => setRenaming({ name: b.name, value: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && void rename()}
                          />{" "}
                          <button className="btn cfg-save" onClick={() => void rename()}>
                            ✓
                          </button>{" "}
                          <button className="btn" onClick={() => setRenaming(null)}>
                            ✕
                          </button>{" "}
                        </>
                      ) : (
                        <>
                          <button
                            className="btn"
                            onClick={() => setRenaming({ name: b.name, value: b.name })}
                          >
                            rename
                          </button>{" "}
                          <button className="btn cfg-save" onClick={() => setRestoreName(b.name)}>
                            restore
                          </button>{" "}
                        </>
                      )}
                      {confirmDel === b.name ? (
                        <>
                          <button className="btn btn-danger" onClick={() => void del(b.name)}>
                            ✓
                          </button>{" "}
                          <button className="btn" onClick={() => setConfirmDel(null)}>
                            ✕
                          </button>
                        </>
                      ) : (
                        <button className="btn" onClick={() => setConfirmDel(b.name)}>
                          🗑
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {body && (
        <Panel
          title={`Backup · ${body.name}`}
          className="reveal"
          extra={
            <Button type="secondary" size="sm" onClick={() => setBody(null)}>
              ✕ Close
            </Button>
          }
        >
          <pre className="body" style={{ maxHeight: 460 }}>
            {body.content || "(empty)"}
          </pre>
        </Panel>
      )}
    </section>
  );
}

// ── detail drawer ────────────────────────────────────────────────────────────
/** A clipboard glyph for icon-only copy affordances. */
function CopyIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/**
 * Copy-to-clipboard button with an inline "Copied!" confirmation tooltip. Pass
 * `icon` for an icon-only affordance (e.g. next to a title); otherwise a text
 * label is shown. The tooltip auto-dismisses after a moment.
 */
function CopyButton({
  text,
  label = "Copy",
  className = "btn",
  icon = false,
  title,
}: {
  text: string;
  label?: ReactNode;
  className?: string;
  icon?: boolean;
  title?: string;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (tRef.current && clearTimeout(tRef.current)), []);
  const onClick = (): void => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        if (tRef.current) clearTimeout(tRef.current);
        tRef.current = setTimeout(() => setCopied(false), 1400);
      },
      () => {},
    );
  };
  return (
    <button
      type="button"
      className={`copybtn ${className}${icon ? " copybtn--icon" : ""}${copied ? " is-copied" : ""}`}
      onClick={onClick}
      title={title ?? "Copy to clipboard"}
      aria-label={title ?? "Copy to clipboard"}
    >
      {icon ? <CopyIcon /> : label}
      <span className="copybtn__tip" role="status" aria-live="polite">
        Copied!
      </span>
    </button>
  );
}

function DetailDrawer({ event, onClose }: { event: ToolEvent; onClose: () => void }): ReactNode {
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet__hd">
          <span className={`risk risk-${event.risk}`}>{event.risk}</span>
          <h3 className="sheet__tool">
            {event.tool}
            <CopyButton text={event.tool} className="iconbtn" icon title="Copy tool name" />
          </h3>
          <span style={{ flex: 1 }} />
          <Button type="secondary" size="sm" onClick={onClose}>
            ✕ Close
          </Button>
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
          <CopyButton text={event.input} title="Copy input JSON" />
        </div>
        {event.input ? <JsonView value={event.input} /> : <pre className="body">—</pre>}
        <div className="sheet__hd">
          <h2 className="muted" style={{ margin: 0 }}>
            OUTPUT
          </h2>
          <span style={{ flex: 1 }} />
          <CopyButton text={event.output} title="Copy output" />
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

// ── view navigation ─────────────────────────────────────────────────────────
type ViewId =
  | "overview"
  | "devices"
  | "topology"
  | "packets"
  | "snapshots"
  | "plan"
  | "s3"
  | "backups"
  | "config"
  | "feed";
const VIEWS: { id: ViewId; label: string; sub: string }[] = [
  { id: "overview", label: "Overview", sub: "Calls, latency & risk at a glance" },
  { id: "devices", label: "Devices", sub: "Connectivity radar & system health" },
  { id: "topology", label: "Topology", sub: "Layer-2 neighbours via MNDP / CDP / LLDP" },
  { id: "packets", label: "Packets", sub: "Live TZSP capture & decode" },
  { id: "snapshots", label: "Snapshots", sub: "Config history & time-travel diff" },
  { id: "plan", label: "Change Plan", sub: "Dry-run intended RouterOS commands" },
  { id: "s3", label: "S3 Backups", sub: "List, download & delete S3 backup objects" },
  { id: "backups", label: "Backups", sub: "Local config vault — create, restore, manage" },
  { id: "config", label: "Config", sub: "Effective configuration & safe editor" },
  { id: "feed", label: "Live Feed", sub: "Every tool call, in real time" },
];

/**
 * Per-domain accent for each page. Drives the page's title gradient, the active
 * nav item, the help button, and assorted accents via the `--page-accent` /
 * `--page-accent-2` CSS variables set on `.main[data-view]`. Colour-coding the
 * pages makes the dashboard feel alive and helps orientation at a glance.
 */
// Monochrome chrome: every page uses the same white→light-zinc accent, so the
// sidebar, title, nav, glow and focus rings carry zero colour (only functional
// status colours — error/ok — remain, elsewhere).
const MONO_ACCENT: [string, string] = ["#ededed", "#a1a1a1"];
const VIEW_ACCENT: Record<ViewId, [string, string]> = {
  overview: MONO_ACCENT,
  devices: MONO_ACCENT,
  topology: MONO_ACCENT,
  packets: MONO_ACCENT,
  snapshots: MONO_ACCENT,
  plan: MONO_ACCENT,
  s3: MONO_ACCENT,
  backups: MONO_ACCENT,
  config: MONO_ACCENT,
  feed: MONO_ACCENT,
};

/**
 * Per-page help content. Every page exposes a collapsible "About this page"
 * guide (toggled from the header) explaining what it does plus a few concrete
 * tips — so a newcomer is never lost. Kept terse and action-oriented.
 */
const HELP: Record<ViewId, { what: string; tips: string[] }> = {
  overview: {
    what: "A live pulse of all MCP tool activity: total calls, error rate, p50/p95 latency, the busiest tools, and a risk breakdown — over a time window you choose.",
    tips: [
      "Change the time window (top-right) to zoom from the last 5 minutes out to 24 hours.",
      "The risk donut splits calls by annotation: read · write · destructive · dangerous.",
      "A rising error line usually points at one device or one tool — jump to Live Feed to see which.",
    ],
  },
  devices: {
    what: "Every configured router with its live reachability (SSH or MAC-Telnet), latency, identity, and system health — CPU, memory and disk — refreshed continuously.",
    tips: [
      "Each device gets a stable colour so you can track it across the connectivity radar.",
      "Health (CPU/Mem/Disk) is probed periodically; MAC-Telnet devices are probed on a slower cadence.",
      "Latency tiers are colour-coded green → amber → red; a grey node is currently unreachable.",
    ],
  },
  topology: {
    what: "A Layer-2 map of neighbours each router discovers via MNDP / CDP / LLDP — the physical adjacency of your network, drawn live.",
    tips: [
      "Solid nodes are configured devices; faint nodes are discovered-but-unmanaged neighbours.",
      "Use “Add to config →” on an unmanaged neighbour to pre-fill it in the Config editor.",
      "Drag to pan; the layout settles automatically as new neighbours arrive.",
    ],
  },
  packets: {
    what: "Live packet capture streamed from a router over TZSP — decode headers in real time without leaving the dashboard.",
    tips: [
      "Pick a device and start the capture; packets decode as they arrive.",
      "Stop the capture when done — it frees the router-side sniffer.",
      "Great for debugging a protocol issue alongside the Live Feed of tool calls.",
    ],
  },
  snapshots: {
    what: "Point-in-time captures of a device’s full configuration (/export), stored locally so you can diff any two and see exactly what changed.",
    tips: [
      "Capture a snapshot before a risky change, then diff after to audit the delta.",
      "The diff is line-level: green added, red removed.",
      "Snapshots are device config exports — for the dashboard’s OWN config history see the Config page.",
    ],
  },
  plan: {
    what: "Dry-run the exact RouterOS commands a change would run before it touches a device — a change plan you can review and trust.",
    tips: [
      "Paste or build intended commands to see them validated and ordered.",
      "Nothing is sent to the device from here — it’s a preview.",
      "Pair with Safe Mode (auto-revert) when you do apply for real.",
    ],
  },
  s3: {
    what: "Browse, download, and delete backup objects in your configured S3-compatible bucket — your off-box archive of device backups and exports.",
    tips: [
      "Filter by key prefix to find a device’s backups quickly.",
      "Download fetches the object through a presigned URL; delete is permanent.",
      "For host-side .rsc backups instead, use the Backups page.",
    ],
  },
  backups: {
    what: "A local config vault on the MCP server: capture a device’s /export as a timestamped .rsc file, then download, upload, rename, restore (via Safe Mode), or delete it.",
    tips: [
      "Restore offers a dry-run (applies then rolls back) before you commit for real.",
      "Edit the vault path inline in the header — it’s saved to your config.",
      "Filenames are stamped in the device’s local 24-hour clock.",
    ],
  },
  config: {
    what: "View the effective configuration, edit it safely with schema-aware validation and auto-rollback, browse a full field guide, and travel through config version history.",
    tips: [
      "Every successful apply is auto-saved to the version timeline — restore any point in time.",
      "Save a named checkpoint before a big change for an easy, labelled rollback.",
      "The Field Guide documents every config option, its type, and default — straight from the schema.",
    ],
  },
  feed: {
    what: "Every tool call as it happens — tool, device, risk, duration, and success/error — with full request/response detail on click.",
    tips: [
      "Filter by status to isolate failures, or by tool/device to follow one thread.",
      "Click any row to open the full (secret-redacted) request and response.",
      "Pause the stream when you want to inspect without rows shifting under you.",
    ],
  },
};

/** Collapsible "About this page" guide shown under each page header. */
function HelpPanel({ view }: { view: ViewId }): ReactNode {
  const h = HELP[view];
  return (
    <div className="pagehelp reveal" role="region" aria-label="Page help">
      <div className="pagehelp__icon" aria-hidden="true">
        ?
      </div>
      <div className="pagehelp__body">
        <p className="pagehelp__what">{h.what}</p>
        <ul className="pagehelp__tips">
          {h.tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Inline stroke icons for the sidebar — no icon-font dependency. */
function NavIcon({ name }: { name: ViewId }): ReactNode {
  const paths: Record<ViewId, ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1.6" />
        <rect x="13" y="3" width="8" height="5" rx="1.6" />
        <rect x="13" y="10" width="8" height="11" rx="1.6" />
        <rect x="3" y="13" width="8" height="8" rx="1.6" />
      </>
    ),
    devices: (
      <>
        <rect x="3" y="4" width="18" height="7" rx="2" />
        <rect x="3" y="13" width="18" height="7" rx="2" />
        <path d="M7 7.5h.01M7 16.5h.01" />
      </>
    ),
    topology: (
      <>
        <circle cx="12" cy="5" r="2.4" />
        <circle cx="5" cy="19" r="2.4" />
        <circle cx="19" cy="19" r="2.4" />
        <path d="M12 7.4 6.4 16.6M12 7.4 17.6 16.6" />
      </>
    ),
    packets: <path d="M3 12h4l2-7 4 14 2-7h6" />,
    snapshots: (
      <>
        <path d="M12 3 3 7.5 12 12 21 7.5 12 3Z" />
        <path d="M3 12 12 16.5 21 12" />
        <path d="M3 16.5 12 21 21 16.5" />
      </>
    ),
    plan: (
      <>
        <circle cx="6" cy="6" r="2.3" />
        <circle cx="6" cy="18" r="2.3" />
        <circle cx="18" cy="8" r="2.3" />
        <path d="M6 8.3v7.4M8.3 6H13a3 3 0 0 1 3 3v0" />
      </>
    ),
    s3: (
      <>
        <ellipse cx="12" cy="6" rx="7" ry="2.6" />
        <path d="M5 6v12c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6V6" />
        <path d="M5 12c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6" />
      </>
    ),
    backups: (
      <>
        <path d="M3 6.5 5 3.5h14l2 3" />
        <rect x="3" y="6.5" width="18" height="14" rx="2" />
        <path d="M9.5 12h5" />
      </>
    ),
    config: (
      <>
        <path d="M4 7h8M16 7h4M4 17h4M12 17h8" />
        <circle cx="14" cy="7" r="2.2" />
        <circle cx="10" cy="17" r="2.2" />
      </>
    ),
    feed: <path d="M4 6h16M4 12h16M4 18h10" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  useReveals(rootRef);
  const [view, setView] = useState<ViewId>("overview");
  // Per-page "About this page" help, remembered per view across reloads.
  const [helpOpen, setHelpOpen] = useState<Set<ViewId>>(() => {
    try {
      const raw = localStorage.getItem("mt-help-open");
      return new Set(raw ? (JSON.parse(raw) as ViewId[]) : []);
    } catch {
      return new Set();
    }
  });
  const toggleHelp = (v: ViewId): void =>
    setHelpOpen((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      try {
        localStorage.setItem("mt-help-open", JSON.stringify([...next]));
      } catch {
        /* storage unavailable — help just won't persist */
      }
      return next;
    });
  // Devices page: search + status filter so a large fleet stays navigable.
  const [deviceQuery, setDeviceQuery] = useState("");
  const [deviceFilter, setDeviceFilter] = useState<"all" | "online" | "offline">("all");
  const deviceCounts = useMemo(() => {
    const list = devices?.devices ?? [];
    return {
      online: list.filter((d) => d.status.reachable === true).length,
      offline: list.filter((d) => d.status.reachable === false).length,
      total: list.length,
    };
  }, [devices]);
  const shownDevices = useMemo(() => {
    const list = devices?.devices ?? [];
    const q = deviceQuery.trim().toLowerCase();
    return list.filter((d) => {
      if (deviceFilter === "online" && d.status.reachable !== true) return false;
      if (deviceFilter === "offline" && d.status.reachable !== false) return false;
      if (
        q &&
        !d.name.toLowerCase().includes(q) &&
        !(d.address ?? d.host ?? "").toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [devices, deviceQuery, deviceFilter]);

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

  const cur = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  return (
    <div
      className="shell"
      ref={rootRef}
      data-view={view}
      style={
        {
          "--page-accent": VIEW_ACCENT[view][0],
          "--page-accent-2": VIEW_ACCENT[view][1],
        } as CSSProperties
      }
    >
      {/* sidebar nav */}
      <aside className="nav">
        <div className="nav__brand">
          <div className="nav__mark">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <g stroke="#18181b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 12 L4 5 M12 12 L20 5 M12 12 L12 20" />
                <circle cx="12" cy="12" r="3" fill="#18181b" stroke="none" />
                <circle cx="4" cy="5" r="1.9" fill="#18181b" stroke="none" />
                <circle cx="20" cy="5" r="1.9" fill="#18181b" stroke="none" />
                <circle cx="12" cy="20" r="1.9" fill="#18181b" stroke="none" />
              </g>
            </svg>
          </div>
          <div className="nav__brandtext">
            <b>MikroTik MCP</b>
            <small>Observability</small>
          </div>
        </div>
        <nav className="nav__items">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`nav__item${view === v.id ? " is-active" : ""}`}
              onClick={() => setView(v.id)}
            >
              <NavIcon name={v.id} />
              <span>{v.label}</span>
              {v.id === "feed" && feed.length > 0 && (
                <span className="nav__badge">{feed.length > 999 ? "999+" : feed.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav__foot">
          <span
            className={`hero__live${liveMode !== "off" ? " is-on" : ""}`}
            title="Live transport: WebSocket (preferred) or SSE fallback"
          >
            <span className="dot" />
            {liveMode === "off" ? "offline" : `live · ${liveMode}`}
          </span>
          <small className="muted">
            {meta ? `${num(meta.total)} events · ${meta.transport}` : "connecting…"}
          </small>
        </div>
      </aside>

      {/* main content */}
      <main className="main" data-view={view}>
        <header className="topline reveal">
          <div className="topline__txt">
            <h1>{cur.label}</h1>
            <small>{cur.sub}</small>
          </div>
          <span className="topline__spacer" />
          {view === "overview" && (
            <select
              className="btn"
              value={windowMs}
              onChange={(e) => setWindowMs(Number(e.target.value))}
              title="Stats time window"
            >
              {WINDOWS.map(([label, val]) => (
                <option key={val} value={val}>
                  window: {label}
                </option>
              ))}
            </select>
          )}
          <button
            className={`help-toggle${helpOpen.has(view) ? " is-on" : ""}`}
            onClick={() => toggleHelp(view)}
            aria-expanded={helpOpen.has(view)}
            title="About this page"
          >
            <span className="help-toggle__q" aria-hidden="true">
              ?
            </span>
            Help
          </button>
        </header>

        {helpOpen.has(view) && <HelpPanel view={view} />}

        {/* ── Overview ── */}
        {view === "overview" && (
          <section className="view">
            <div className="cards reveal">
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
            </div>

            <div className="bento reveal">
              <Panel title="Calls over time" className="b-series">
                {stats ? (
                  <ActivityChart series={stats.series} />
                ) : (
                  <div className="muted">no data</div>
                )}
              </Panel>
              {stats && (
                <>
                  <Panel title="By risk" className="b-risk">
                    <RiskDonut
                      segments={(Object.keys(stats.byRisk) as Risk[]).map((r) => ({
                        label: r,
                        value: stats.byRisk[r],
                        color: RISK_COLOR[r],
                      }))}
                    />
                  </Panel>
                  <Panel title="Top tools" className="b-tools">
                    <HBars
                      rows={stats.byTool.map((t) => ({
                        label: t.tool,
                        value: t.count,
                        sub: `${t.count}× · ${ms(t.p95Ms)} p95${t.errors ? ` · ${t.errors} err` : ""}`,
                        color: t.errors ? "var(--mt-bad)" : undefined,
                      }))}
                    />
                  </Panel>
                  <Panel title="Status" className="b-status">
                    <RiskDonut
                      centerLabel="calls"
                      segments={[
                        { label: "ok", value: feedStatus.ok, color: "#a1a1a1" },
                        { label: "error", value: feedStatus.error, color: "#ff5c5c" },
                      ]}
                    />
                  </Panel>
                  <Panel title="By device" className="b-device">
                    {stats.byDevice.length ? (
                      <HBars
                        rows={stats.byDevice.map((d) => ({ label: d.device, value: d.count }))}
                      />
                    ) : (
                      <div className="muted">single device</div>
                    )}
                  </Panel>
                  <Panel title="Recent errors" className="b-errors">
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
                </>
              )}
            </div>
          </section>
        )}

        {/* ── Devices ── */}
        {view === "devices" &&
          (devices && devices.devices.length > 0 ? (
            <section className="view">
              {/* search + status filter — keeps a large fleet navigable */}
              <div className="dev-toolbar reveal">
                <input
                  className="search"
                  type="search"
                  placeholder="Search devices by name or address…"
                  value={deviceQuery}
                  onChange={(e) => setDeviceQuery(e.target.value)}
                  style={{ flex: 1, minWidth: 180 }}
                />
                <div className="dev-filters">
                  {(["all", "online", "offline"] as const).map((f) => (
                    <button
                      key={f}
                      className={`dev-fbtn${deviceFilter === f ? " is-active" : ""}`}
                      onClick={() => setDeviceFilter(f)}
                    >
                      {f === "all"
                        ? `All ${deviceCounts.total}`
                        : f === "online"
                          ? `Online ${deviceCounts.online}`
                          : `Offline ${deviceCounts.offline}`}
                    </button>
                  ))}
                </div>
                <span className="muted">
                  {shownDevices.length}/{deviceCounts.total} shown
                </span>
              </div>

              {/* connectivity radar — collapsible so it doesn't dominate a big fleet */}
              <details className="dev-collapse reveal" open={deviceCounts.total <= 8}>
                <summary>
                  Connectivity radar
                  <span className="muted">
                    {" "}
                    · {deviceCounts.online} online · {deviceCounts.offline} offline ·{" "}
                    {deviceCounts.total} total
                  </span>
                </summary>
                <ConnectivityGraph payload={devices} pulses={pulses} />
              </details>

              {/* responsive device grid (filtered) */}
              {shownDevices.length === 0 ? (
                <div className="feed-empty reveal">
                  <div className="feed-empty__icon">🔍</div>
                  <p className="feed-empty__title">No devices match</p>
                  <p className="feed-empty__sub">Try a different search or status filter.</p>
                </div>
              ) : (
                <div className="dev-grid-wide reveal">
                  {shownDevices.map((d) => (
                    <DeviceCard key={d.name} d={d} />
                  ))}
                </div>
              )}

              {/* system health (filtered) */}
              {shownDevices.length > 0 && (
                <Panel
                  title="Device system health"
                  className="reveal"
                  extra={<span className="muted">CPU · memory · disk · latency · live probe</span>}
                >
                  <div className="health-grid">
                    {shownDevices.map((d) => (
                      <DeviceHealthCard key={d.name} d={d} />
                    ))}
                  </div>
                </Panel>
              )}
            </section>
          ) : (
            <div className="feed-empty">
              <div className="feed-empty__icon">🖧</div>
              <p className="feed-empty__title">No devices configured</p>
              <Note type="secondary" label="Tip">
                Add a device to your config to see connectivity and system health here.
              </Note>
            </div>
          ))}

        {/* ── Topology ── */}
        {view === "topology" &&
          (topology && topology.nodes.length > 0 ? (
            <section className="view">
              <Panel
                title="Network topology"
                className="reveal"
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
                    setView("config");
                  }}
                />
              </Panel>
            </section>
          ) : (
            <div className="feed-empty">
              <div className="feed-empty__icon">🛰️</div>
              <p className="feed-empty__title">No neighbours discovered yet</p>
              <p className="feed-empty__sub">
                Layer-2 neighbours (MNDP / CDP / LLDP) appear here as the device reports them.
              </p>
            </div>
          ))}

        {/* ── Packets ── */}
        {view === "packets" && (
          <section className="view">
            <Panel
              title="Packet capture"
              className="reveal"
              extra={<span className="muted">live TZSP decode · /tool sniffer streaming</span>}
            >
              <PacketCapture />
            </Panel>
          </section>
        )}

        {/* ── Snapshots ── */}
        {view === "snapshots" && <SnapshotsView />}

        {/* ── Change Plan ── */}
        {view === "plan" && <ChangePlanView />}

        {/* ── S3 Backups ── */}
        {view === "s3" && <S3Manage />}

        {/* ── Local Backups ── */}
        {view === "backups" && <BackupsView />}

        {/* ── Config ── */}
        {view === "config" &&
          (config ? (
            <section className="view">
              <Panel
                title="Configuration"
                className="reveal"
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
                              ...(config.devices as Record<string, unknown>),
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

              <Panel
                title="Version history"
                className="reveal"
                extra={<span className="muted">point-in-time snapshots · diff &amp; restore</span>}
              >
                <ConfigHistoryPanel
                  onRestored={() =>
                    void api<Record<string, unknown>>("/api/config")
                      .then(setConfig)
                      .catch(() => {})
                  }
                />
              </Panel>

              <Panel
                title="Field guide"
                className="reveal"
                extra={
                  <span className="muted">every config option, documented from the schema</span>
                }
              >
                <FieldGuidePanel />
              </Panel>
            </section>
          ) : (
            <div className="feed-empty">
              <Spinner />
              <p className="feed-empty__title">Loading configuration…</p>
            </div>
          ))}

        {/* ── Live Feed ── */}
        {view === "feed" && (
          <div className="panel reveal">
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
              {/* time window selector lives in the Overview header */}
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
                    {feed.length} call{feed.length === 1 ? "" : "s"} buffered — try widening the
                    search or the risk / device / status filters.
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
        )}
      </main>

      {selected && <DetailDrawer event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<App />);
