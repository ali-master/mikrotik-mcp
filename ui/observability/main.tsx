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
import type { ReactNode } from "react";
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
}
interface DeviceInfo {
  name: string;
  host: string;
  port: number;
  username: string;
  authMode: string;
  isDefault: boolean;
  description?: string;
  status: DeviceStatus;
  activity: { calls: number; errors: number; lastSeen: number; avgMs: number };
}
interface DevicesPayload {
  server: string;
  defaultDevice: string;
  devices: DeviceInfo[];
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

/**
 * Animated "radar hub" connectivity map: the MCP server core emits sonar pulses,
 * each device hangs off a curved link, and online links carry a glowing data
 * packet that streams from the core outward. Status drives every accent colour;
 * all motion is CSS/SMIL (see `.conn-*` in styles.css) and respects
 * `prefers-reduced-motion`.
 */
function ConnectivityGraph({ payload }: { payload: DevicesPayload }): ReactNode {
  const devices = payload.devices;
  const n = Math.max(1, devices.length);
  const R = Math.min(150, 96 + n * 3);
  const PAD = 72;
  const W = 700;
  const H = Math.round((R + PAD) * 2);
  const cx = W / 2;
  const cy = H / 2;

  const nodes = devices.map((d, i) => {
    // Start at the top and fan evenly; nudge a half-step when even so two
    // devices don't sit dead-vertical (which would hide the curve).
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2 + (n % 2 === 0 ? Math.PI / n : 0);
    return { d, i, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  });

  return (
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

      {/* links + flowing packets */}
      {nodes.map(({ d, i, x, y }) => {
        const info = statusInfo(d.status);
        const online = d.status.reachable === true;
        const checking = d.status.reachable == null;
        const mx = (cx + x) / 2;
        const my = (cy + y) / 2;
        const dx = x - cx;
        const dy = y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const off = 26 * (i % 2 ? 1 : -1);
        const px = mx + (-dy / len) * off;
        const py = my + (dx / len) * off;
        const dPath = `M${cx},${cy} Q${px.toFixed(1)},${py.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
        return (
          <g key={`l-${d.name}`}>
            <path
              id={`conn-link-${i}`}
              className="conn-link"
              d={dPath}
              stroke={info.color}
              strokeDasharray={checking ? "2 8" : online ? undefined : "6 7"}
            />
            {online && (
              <>
                <path className="conn-flow" d={dPath} stroke={info.color} />
                <circle className="conn-packet" r={3.4} fill="#eafff6">
                  <animateMotion dur="2.4s" repeatCount="indefinite" calcMode="linear">
                    <mpath href={`#conn-link-${i}`} />
                  </animateMotion>
                </circle>
              </>
            )}
          </g>
        );
      })}

      {/* core hub */}
      <circle className="conn-hub-glow" cx={cx} cy={cy} r={42} />
      <circle className="conn-hub-ring" cx={cx} cy={cy} r={37} />
      <circle cx={cx} cy={cy} r={29} fill="url(#conn-hub)" stroke="#a5b4fc" strokeWidth={1.5} />
      <text x={cx} y={cy - 2} textAnchor="middle" fill="#fff" fontSize={12} fontWeight={700}>
        MCP
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#c7d2fe" fontSize={8.5}>
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
            <text x={x} y={y + 3} textAnchor="middle" fill="#e8eaed" fontSize={10} fontWeight={600}>
              {short}
            </text>
            <text x={x} y={y + 40} textAnchor="middle" fill="#9aa3af" fontSize={9}>
              {d.host}
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
        <span>host</span>
        <b>
          {d.host}:{d.port}
        </b>
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
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [feed, setFeed] = useState<ToolEvent[]>([]);
  const [windowMs, setWindowMs] = useState(3_600_000);
  const [paused, setPaused] = useState(false);
  const [liveMode, setLiveMode] = useState<LiveMode>("off");
  const [selected, setSelected] = useState<ToolEvent | null>(null);
  const [filter, setFilter] = useState<Filter>({
    tool: "",
    risk: "",
    device: "",
    status: "",
    q: "",
  });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Live stream → prepend to feed (unless paused).
  useLiveStream(
    useCallback((e: ToolEvent) => {
      if (pausedRef.current) return;
      setFeed((f) => [e, ...f].slice(0, FEED_CAP));
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

  const openDetail = useCallback(async (e: ToolEvent) => {
    try {
      setSelected(await api<ToolEvent>(`/api/event/${encodeURIComponent(e.id)}`));
    } catch {
      setSelected(e);
    }
  }, []);

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
                { label: "ok", value: stats.byStatus.ok, color: "#34d399" },
                {
                  label: "error",
                  value: stats.byStatus.error,
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
            {stats.recentErrors.length ? (
              <div className="hbar">
                {stats.recentErrors.slice(0, 8).map((e) => (
                  <div className="hbar__row" style={{ gridTemplateColumns: "auto 1fr" }} key={e.id}>
                    <span className="muted">{clock(e.ts)}</span>
                    <span
                      style={{
                        color: "var(--mt-bad)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={e.error}
                    >
                      {e.tool}: {e.error}
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
            <ConnectivityGraph payload={devices} />
          </Panel>
          <div className="dev-grid">
            {devices.devices.map((d) => (
              <DeviceCard key={d.name} d={d} />
            ))}
          </div>
        </section>
      )}

      {/* config */}
      {config && (
        <Panel title="Configuration">
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
                {visible.slice(0, 200).map((e) => (
                  <tr
                    key={e.id}
                    className={e.isError ? "is-err" : undefined}
                    onClick={() => void openDetail(e)}
                  >
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
