/**
 * MikroTik MCP — Observability dashboard (single-page app).
 *
 * Served by the dashboard server (`src/observability/dashboard.ts`) on localhost.
 * Talks to that same origin: REST for history/analytics (`/api/stats`,
 * `/api/events`, `/api/meta`, `/api/event/:id`) and a WebSocket (`/api/stream`)
 * for the real-time feed of every tool call the LLM makes.
 *
 * No framework, no chart library — DOM is built with text nodes (XSS-safe) and
 * charts are hand-rolled SVG. A `?token=` in the URL is forwarded to every API
 * call and the WebSocket when the server requires one.
 */
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
  byTool: { tool: string; count: number; errors: number; avgMs: number; p95Ms: number }[];
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

// ── DOM helpers (text-node only) ─────────────────────────────────────────────
type Child = Node | string | number | null | undefined | false;
function h(tag: string, props: Record<string, string> = {}, ...kids: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === false || kid == null) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const SVGNS = "http://www.w3.org/2000/svg";
function s(tag: string, attrs: Record<string, string | number> = {}, ...kids: (SVGElement | string)[]): SVGElement {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const kid of kids) el.append(kid instanceof Node ? kid : document.createTextNode(kid));
  return el;
}
function btn(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = h("button", { class: `btn${cls ? ` ${cls}` : ""}` }, label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

// ── formatting ───────────────────────────────────────────────────────────────
function ms(n: number): string {
  if (n < 1) return "<1ms";
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}
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
function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}
function num(n: number): string {
  return n.toLocaleString();
}

const RISK_COLOR: Record<Risk, string> = {
  READ: "#34d399",
  WRITE: "#fbbf24",
  WRITE_IDEMPOTENT: "#6ea8fe",
  DESTRUCTIVE: "#f87171",
  DANGEROUS: "#ef4444",
};

// ── token + API ──────────────────────────────────────────────────────────────
const TOKEN = new URLSearchParams(location.search).get("token") ?? "";
function withToken(path: string): string {
  if (!TOKEN) return path;
  return `${path + (path.includes("?") ? "&" : "?")  }token=${encodeURIComponent(TOKEN)}`;
}
async function api<T>(path: string): Promise<T> {
  const res = await fetch(withToken(path), {
    headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

// ── state ────────────────────────────────────────────────────────────────────
const FEED_CAP = 500;
const WINDOWS: [string, number][] = [
  ["5m", 300_000],
  ["15m", 900_000],
  ["1h", 3_600_000],
  ["6h", 21_600_000],
  ["24h", 86_400_000],
];
const state = {
  feed: [] as ToolEvent[],
  stats: null as Stats | null,
  meta: null as Meta | null,
  devices: null as DevicesPayload | null,
  config: null as Record<string, unknown> | null,
  windowMs: 3_600_000,
  paused: false,
  connected: false,
  liveMode: "off" as "ws" | "sse" | "off",
  selected: null as ToolEvent | null,
  filter: { tool: "", risk: "", device: "", status: "", q: "" },
};

const root = document.getElementById("app")!;

// ── charts ───────────────────────────────────────────────────────────────────
function timeSeries(series: Bucket[]): SVGElement {
  const W = 720;
  const H = 140;
  const pad = 6;
  const n = series.length || 1;
  const bw = (W - pad * 2) / n;
  const max = Math.max(1, ...series.map((b) => b.ok + b.error));
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, preserveAspectRatio: "none" });
  series.forEach((b, i) => {
    const x = pad + i * bw;
    const okH = ((H - 18) * b.ok) / max;
    const errH = ((H - 18) * b.error) / max;
    const gap = bw > 3 ? 1 : 0;
    if (okH > 0) {
      svg.append(s("rect", { x: x + gap, y: H - 14 - okH, width: bw - gap * 2, height: okH, fill: "#34d399", opacity: 0.85, rx: 1 }));
    }
    if (errH > 0) {
      svg.append(s("rect", { x: x + gap, y: H - 14 - okH - errH, width: bw - gap * 2, height: errH, fill: "#f87171", rx: 1 }));
    }
  });
  // baseline + edge time labels
  svg.append(s("line", { x1: pad, y1: H - 14, x2: W - pad, y2: H - 14, stroke: "#262b33" }));
  if (series.length) {
    const t0 = s("text", { x: pad, y: H - 2, fill: "#6b7280", "font-size": 10 }, clock(series[0].t));
    const t1 = s("text", { x: W - pad, y: H - 2, fill: "#6b7280", "font-size": 10, "text-anchor": "end" }, clock(series[series.length - 1].t));
    svg.append(t0, t1);
  }
  return svg;
}

function donut(segments: { label: string; value: number; color: string }[]): HTMLElement {
  const total = segments.reduce((a, b) => a + b.value, 0);
  const R = 46;
  const C = 2 * Math.PI * R;
  const svg = s("svg", { viewBox: "0 0 120 120", width: 120, height: 120 });
  svg.append(s("circle", { cx: 60, cy: 60, r: R, fill: "none", stroke: "#1b1f26", "stroke-width": 16 }));
  let offset = 0;
  for (const seg of segments) {
    if (!seg.value) continue;
    const frac = seg.value / (total || 1);
    const arc = s("circle", {
      cx: 60,
      cy: 60,
      r: R,
      fill: "none",
      stroke: seg.color,
      "stroke-width": 16,
      "stroke-dasharray": `${C * frac} ${C}`,
      "stroke-dashoffset": -offset,
      transform: "rotate(-90 60 60)",
    });
    svg.append(arc);
    offset += C * frac;
  }
  svg.append(s("text", { x: 60, y: 58, "text-anchor": "middle", fill: "#e8eaed", "font-size": 20, "font-weight": 650 }, String(total)));
  svg.append(s("text", { x: 60, y: 74, "text-anchor": "middle", fill: "#9aa3af", "font-size": 9 }, "calls"));
  const legend = h(
    "div",
    { class: "legend" },
    ...segments.filter((seg) => seg.value).map((seg) => {
      const sw = h("i", {});
      sw.style.background = seg.color;
      return h("span", {}, sw, `${seg.label} ${seg.value}`);
    }),
  );
  return h("div", { style: "display:flex;gap:14px;align-items:center;flex-wrap:wrap" }, svg as unknown as Node, legend);
}

function hbars(rows: { label: string; value: number; sub?: string; color?: string }[]): HTMLElement {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h(
    "div",
    { class: "hbar" },
    ...rows.map((r) => {
      const fill = h("div", { class: "hbar__fill" });
      fill.style.width = `${(r.value / max) * 100}%`;
      if (r.color) fill.style.background = r.color;
      return h(
        "div",
        { class: "hbar__row" },
        h("span", { class: "hbar__label", title: r.label }, r.label),
        h("div", { class: "hbar__track" }, fill),
        h("span", { class: "hbar__val" }, r.sub ?? String(r.value)),
      );
    }),
  );
}

// ── devices & connectivity ───────────────────────────────────────────────────
function statusInfo(s: DeviceStatus): { label: string; color: string } {
  if (s.reachable === true) return { label: "online", color: "#34d399" };
  if (s.reachable === false) return { label: "offline", color: "#f87171" };
  return { label: "checking…", color: "#6b7280" };
}

/** Hub-and-spoke connectivity graph: the MCP server linked to each device. */
function connectivityGraph(payload: DevicesPayload): SVGElement {
  const W = 640;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;
  const devices = payload.devices;
  const n = Math.max(1, devices.length);
  const R = Math.min(115, 70 + n * 6);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, preserveAspectRatio: "xMidYMid meet" });

  // Edges first (under nodes).
  const nodes = devices.map((d, i) => {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { d, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  });
  for (const { d, x, y } of nodes) {
    const info = statusInfo(d.status);
    const line = s("line", {
      x1: cx,
      y1: cy,
      x2: x,
      y2: y,
      stroke: info.color,
      "stroke-width": 2,
      opacity: 0.55,
    });
    if (d.status.reachable == null) line.setAttribute("stroke-dasharray", "4 4");
    svg.append(line);
  }

  // Central MCP-server hub.
  svg.append(s("circle", { cx, cy, r: 30, fill: "#14171c", stroke: "#6ea8fe", "stroke-width": 2 }));
  svg.append(s("text", { x: cx, y: cy - 1, "text-anchor": "middle", fill: "#e8eaed", "font-size": 11, "font-weight": 650 }, "MCP"));
  svg.append(s("text", { x: cx, y: cy + 12, "text-anchor": "middle", fill: "#9aa3af", "font-size": 8 }, "server"));

  // Device nodes.
  for (const { d, x, y } of nodes) {
    const info = statusInfo(d.status);
    svg.append(s("circle", { cx: x, cy: y, r: 22, fill: "#1b1f26", stroke: info.color, "stroke-width": 2 }));
    svg.append(s("circle", { cx: x + 15, cy: y - 15, r: 4, fill: info.color }));
    svg.append(s("text", { x, y: y + 1, "text-anchor": "middle", fill: "#e8eaed", "font-size": 9, "font-weight": 600 }, d.name.length > 9 ? `${d.name.slice(0, 8)}…` : d.name));
    svg.append(s("text", { x, y: y + 34, "text-anchor": "middle", fill: "#9aa3af", "font-size": 9 }, d.host));
    const detail = d.status.reachable ? `${d.status.latencyMs ?? "?"}ms` : info.label;
    svg.append(s("text", { x, y: y + 45, "text-anchor": "middle", fill: info.color, "font-size": 8 }, detail));
  }
  return svg;
}

function deviceCard(d: DeviceInfo): HTMLElement {
  const info = statusInfo(d.status);
  const dot = h("span", { class: "dot" });
  dot.style.background = info.color;
  const statusLine =
    d.status.reachable === true
      ? `${info.label} · ${d.status.latencyMs ?? "?"}ms${d.status.version ? ` · v${d.status.version}` : ""}`
      : d.status.reachable === false
        ? `${info.label}${d.status.error ? ` · ${d.status.error}` : ""}`
        : info.label;
  return h(
    "div",
    { class: "card dev-card" },
    h(
      "div",
      { class: "dev-card__top" },
      dot,
      h("span", { class: "dev-card__name" }, d.name),
      d.isDefault ? h("span", { class: "badge" }, "default") : false,
      h("span", { style: "flex:1" }),
      h("span", { class: "chip" }, d.authMode),
    ),
    h(
      "div",
      { class: "dev-card__meta" },
      h("span", {}, "host"),
      h("b", {}, `${d.host}:${d.port}`),
      h("span", {}, "user"),
      h("b", {}, d.username),
      h("span", {}, "status"),
      h("b", { style: `color:${info.color}` }, statusLine),
      h("span", {}, "activity"),
      h("b", {}, `${d.activity.calls} calls · ${d.activity.errors} err${d.activity.avgMs ? ` · ${ms(d.activity.avgMs)} avg` : ""}`),
      d.description ? h("span", {}, "note") : false,
      d.description ? h("b", {}, d.description) : false,
    ),
  );
}

function renderDevices(): void {
  const slot = document.getElementById("devices");
  if (!slot) return;
  const p = state.devices;
  if (!p || !p.devices.length) {
    slot.replaceChildren(h("div", { class: "muted" }, "no devices configured"));
    return;
  }
  const online = p.devices.filter((d) => d.status.reachable === true).length;
  const offline = p.devices.filter((d) => d.status.reachable === false).length;
  slot.replaceChildren(
    h(
      "div",
      { class: "cols" },
      h(
        "div",
        { class: "panel" },
        h(
          "div",
          { class: "sheet__hd", style: "margin-bottom:8px" },
          h("h2", { style: "margin:0" }, "Connectivity"),
          h("span", { style: "flex:1" }),
          h("span", { class: "muted" }, `${online} online · ${offline} offline · ${p.devices.length} total`),
        ),
        connectivityGraph(p) as unknown as Node,
      ),
      h("div", { class: "dev-grid" }, ...p.devices.map(deviceCard)),
    ),
  );
}

function renderConfig(): void {
  const slot = document.getElementById("config");
  if (!slot) return;
  const c = state.config;
  if (!c) {
    slot.replaceChildren();
    return;
  }
  const mcp = (c.mcp ?? {}) as Record<string, unknown>;
  const dash = (c.dashboard ?? {}) as Record<string, unknown>;
  const sval = (v: unknown): string => {
    if (v == null) return "?";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
  };
  const summary = h(
    "div",
    { class: "legend", style: "margin:0 0 10px" },
    h("span", {}, `transport: ${sval(mcp.transport)}`),
    h("span", {}, `read-only: ${c.readOnly ? "yes" : "no"}`),
    h("span", {}, `dashboard: ${sval(dash.host)}:${sval(dash.port)}`),
    h("span", {}, `capture: ${dash.captureBody ? "on" : "off"}`),
    h("span", {}, `s3: ${c.s3 ? "configured" : "off"}`),
  );
  const pre = h("pre", { class: "body", style: "max-height:340px" }, JSON.stringify(c, null, 2));
  const details = h("details", { class: "cfg" }, h("summary", {}, "Full effective configuration (secrets redacted)"), pre);
  slot.replaceChildren(h("div", { class: "panel" }, h("h2", {}, "Configuration"), summary, details));
}

// ── sections ─────────────────────────────────────────────────────────────────
function statCard(k: string, v: string, sub?: string, cls = ""): HTMLElement {
  return h(
    "div",
    { class: `stat${cls ? ` ${cls}` : ""}` },
    h("p", { class: "k" }, k),
    h("div", { class: "v" }, v, sub ? h("small", {}, ` ${sub}`) : false),
  );
}

function renderCards(): void {
  const slot = document.getElementById("cards")!;
  const st = state.stats;
  if (!st) {
    slot.replaceChildren(h("div", { class: "stat" }, h("p", { class: "k" }, "Loading…"), h("div", { class: "v" }, "—")));
    return;
  }
  const errCls = st.errorRate >= 0.2 ? "is-bad" : st.errorRate >= 0.05 ? "is-warn" : "is-good";
  slot.replaceChildren(
    statCard("Calls (window)", num(st.total)),
    statCard("Calls / min", st.callsPerMin.toFixed(1)),
    statCard("Error rate", `${(st.errorRate * 100).toFixed(1)}%`, `${st.errors} err`, errCls),
    statCard("Avg latency", ms(st.latency.avg)),
    statCard("p95 latency", ms(st.latency.p95)),
    statCard("p99 latency", ms(st.latency.p99)),
    statCard("Distinct tools", num(st.distinctTools)),
    statCard("Output volume", bytes(st.outputBytes)),
  );
}

function renderCharts(): void {
  const st = state.stats;
  document.getElementById("chart")!.replaceChildren(
    st ? (timeSeries(st.series) as unknown as Node) : h("div", { class: "muted" }, "no data"),
    h(
      "div",
      { class: "legend" },
      (() => {
        const a = h("i", {});
        a.style.background = "#34d399";
        return h("span", {}, a, "ok");
      })(),
      (() => {
        const b = h("i", {});
        b.style.background = "#f87171";
        return h("span", {}, b, "error");
      })(),
    ),
  );

  const breakdowns = document.getElementById("breakdowns")!;
  if (!st) {
    breakdowns.replaceChildren();
    return;
  }
  const riskSegs = (Object.keys(st.byRisk) as Risk[])
    .map((r) => ({ label: r, value: st.byRisk[r], color: RISK_COLOR[r] }))
    .filter((x) => x.value > 0);
  const statusSegs = [
    { label: "ok", value: st.byStatus.ok, color: "#34d399" },
    { label: "error", value: st.byStatus.error, color: "#f87171" },
  ];
  breakdowns.replaceChildren(
    h(
      "div",
      { class: "panel" },
      h("h2", {}, "Top tools"),
      hbars(
        st.byTool.map((t) => ({
          label: t.tool,
          value: t.count,
          sub: `${t.count}× · ${ms(t.p95Ms)} p95${t.errors ? ` · ${t.errors} err` : ""}`,
          color: t.errors ? "#f87171" : undefined,
        })),
      ),
    ),
    h("div", { class: "panel" }, h("h2", {}, "By risk"), donut(riskSegs)),
    h("div", { class: "panel" }, h("h2", {}, "Status"), donut(statusSegs)),
    h(
      "div",
      { class: "panel" },
      h("h2", {}, "By device"),
      st.byDevice.length
        ? hbars(st.byDevice.map((d) => ({ label: d.device, value: d.count })))
        : h("div", { class: "muted" }, "single device"),
    ),
    h(
      "div",
      { class: "panel" },
      h("h2", {}, "Recent errors"),
      st.recentErrors.length
        ? h(
            "div",
            { class: "hbar" },
            ...st.recentErrors.slice(0, 8).map((e) =>
              h(
                "div",
                { class: "hbar__row", style: "grid-template-columns:auto 1fr" },
                h("span", { class: "muted" }, clock(e.ts)),
                h("span", { style: "color:var(--mt-bad);overflow:hidden;text-overflow:ellipsis", title: e.error }, `${e.tool}: ${e.error}`),
              ),
            ),
          )
        : h("div", { class: "muted" }, "no errors 🎉"),
    ),
  );
}

function matchesFilter(e: ToolEvent): boolean {
  const f = state.filter;
  if (f.tool && e.tool !== f.tool) return false;
  if (f.risk && e.risk !== f.risk) return false;
  if (f.device && e.device !== f.device) return false;
  if (f.status === "ok" && e.isError) return false;
  if (f.status === "error" && !e.isError) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (
      !e.tool.toLowerCase().includes(q) &&
      !e.input.toLowerCase().includes(q) &&
      !e.output.toLowerCase().includes(q) &&
      !(e.error ?? "").toLowerCase().includes(q)
    )
      return false;
  }
  return true;
}

function renderFeed(): void {
  const tbody = document.getElementById("feed-body")!;
  const rows = state.feed.filter(matchesFilter).slice(0, 200);
  tbody.replaceChildren(
    ...rows.map((e) => {
      const tr = h(
        "tr",
        e.isError ? { class: "is-err" } : {},
        h("td", {}, clock(e.ts)),
        h("td", {}, e.tool),
        h("td", {}, h("span", { class: `risk risk-${e.risk}` }, e.risk.replace("WRITE_IDEMPOTENT", "WRITE·I"))),
        h("td", {}, e.device ?? "—"),
        h("td", { class: "num" }, ms(e.durationMs)),
        h("td", {}, h("span", { class: e.isError ? "status-err" : "status-ok" }, e.isError ? "error" : "ok")),
        h("td", { class: "preview" }, e.isError ? (e.error ?? "error") : e.output || "—"),
      );
      tr.addEventListener("click", () => openDetail(e));
      return tr;
    }),
  );
  const count = document.getElementById("feed-count");
  if (count) count.textContent = `${rows.length} shown · ${state.feed.length} buffered`;
}

async function openDetail(e: ToolEvent): Promise<void> {
  // Fetch the full (untruncated-in-DB) record so bodies are complete.
  let full = e;
  try {
    full = await api<ToolEvent>(`/api/event/${encodeURIComponent(e.id)}`);
  } catch {
    /* fall back to the feed copy */
  }
  state.selected = full;
  renderDrawer();
}

function copyBtn(label: string, text: string): HTMLButtonElement {
  return btn(label, () => void navigator.clipboard?.writeText(text).catch(() => {}));
}

function renderDrawer(): void {
  const slot = document.getElementById("drawer")!;
  const e = state.selected;
  if (!e) {
    slot.replaceChildren();
    return;
  }
  const close = (): void => {
    state.selected = null;
    renderDrawer();
  };
  const overlay = h("div", { class: "overlay" });
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  const sheet = h(
    "div",
    { class: "sheet" },
    h(
      "div",
      { class: "sheet__hd" },
      h("span", { class: `risk risk-${e.risk}` }, e.risk),
      h("h3", {}, e.tool),
      h("span", { class: "hd__spacer", style: "flex:1" }),
      btn("✕ Close", close),
    ),
    h(
      "div",
      { class: "kv__body" },
      h("div", { class: "kv__k" }, "title"),
      h("div", { class: "kv__v" }, e.title),
      h("div", { class: "kv__k" }, "time"),
      h("div", { class: "kv__v" }, new Date(e.ts).toLocaleString()),
      h("div", { class: "kv__k" }, "device"),
      h("div", { class: "kv__v" }, e.device ?? "—"),
      h("div", { class: "kv__k" }, "transport"),
      h("div", { class: "kv__v" }, e.transport ?? "—"),
      h("div", { class: "kv__k" }, "duration"),
      h("div", { class: "kv__v" }, ms(e.durationMs)),
      h("div", { class: "kv__k" }, "status"),
      h("div", { class: "kv__v" }, h("span", { class: e.isError ? "status-err" : "status-ok" }, e.isError ? "error" : "ok")),
      h("div", { class: "kv__k" }, "output size"),
      h("div", { class: "kv__v" }, `${bytes(e.outputBytes)}${e.truncated ? " (truncated)" : ""}`),
      h("div", { class: "kv__k" }, "structured"),
      h("div", { class: "kv__v" }, e.hasStructured ? "yes (renders an MCP App view)" : "no"),
    ),
    e.error ? h("h2", { class: "muted" }, "ERROR") : false,
    e.error ? h("pre", { class: "body", style: "color:var(--mt-bad)" }, e.error) : false,
    h(
      "div",
      { class: "sheet__hd" },
      h("h2", { class: "muted", style: "margin:0" }, "INPUT (redacted)"),
      h("span", { style: "flex:1" }),
      copyBtn("Copy", e.input),
    ),
    h("pre", { class: "body" }, e.input || "—"),
    h(
      "div",
      { class: "sheet__hd" },
      h("h2", { class: "muted", style: "margin:0" }, "OUTPUT"),
      h("span", { style: "flex:1" }),
      copyBtn("Copy", e.output),
    ),
    h("pre", { class: "body" }, e.output || "—"),
  );
  overlay.append(sheet);
  slot.replaceChildren(overlay);
}

// ── data refresh ─────────────────────────────────────────────────────────────
async function refreshStats(): Promise<void> {
  try {
    state.stats = await api<Stats>(`/api/stats?window=${state.windowMs}&buckets=60`);
    renderCards();
    renderCharts();
  } catch (e) {
    console.error("[obs] stats failed", e);
  }
}
async function refreshMeta(): Promise<void> {
  try {
    state.meta = await api<Meta>("/api/meta");
    renderTopbar();
    populateFacets();
  } catch (e) {
    console.error("[obs] meta failed", e);
  }
}
async function loadInitialFeed(): Promise<void> {
  try {
    const { events } = await api<{ events: ToolEvent[] }>("/api/events?limit=200");
    state.feed = events;
    renderFeed();
  } catch (e) {
    console.error("[obs] events failed", e);
  }
}
async function refreshDevices(): Promise<void> {
  try {
    state.devices = await api<DevicesPayload>("/api/devices");
    renderDevices();
  } catch (e) {
    console.error("[obs] devices failed", e);
  }
}
async function refreshConfig(): Promise<void> {
  try {
    state.config = await api<Record<string, unknown>>("/api/config");
    renderConfig();
  } catch (e) {
    console.error("[obs] config failed", e);
  }
}

// ── live connection (Bun-native WebSocket, SSE fallback) ─────────────────────
function setLive(mode: "ws" | "sse" | "off"): void {
  state.liveMode = mode;
  state.connected = mode !== "off";
  renderTopbar();
}

/** Push a streamed event into the feed (respecting pause + cap). */
function pushEvent(e: ToolEvent): void {
  if (state.paused) return;
  state.feed.unshift(e);
  if (state.feed.length > FEED_CAP) state.feed.length = FEED_CAP;
  renderFeed();
}

/**
 * Connect the live feed. Prefers a Bun-native WebSocket; if it never opens
 * (some proxies block upgrades) it falls back to the Bun-native SSE endpoint.
 */
function connectLive(): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(withToken(`${proto}://${location.host}/api/stream`));
  let opened = false;
  ws.onopen = () => {
    opened = true;
    setLive("ws");
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (m) => {
    try {
      const msg = JSON.parse(m.data) as { type: string; event?: ToolEvent };
      if (msg.type === "event" && msg.event) pushEvent(msg.event);
    } catch {
      /* ignore malformed frame */
    }
  };
  ws.onclose = () => {
    setLive("off");
    if (opened)
      setTimeout(connectLive, 2000); // was working → retry WebSocket
    else connectSse(); // never upgraded → fall back to SSE
  };
}

function connectSse(): void {
  const es = new EventSource(withToken("/api/sse"));
  es.addEventListener("hello", () => setLive("sse"));
  es.addEventListener("tool", (ev) => {
    try {
      pushEvent(JSON.parse((ev as MessageEvent).data) as ToolEvent);
    } catch {
      /* ignore */
    }
  });
  es.onerror = () => {
    // EventSource auto-reconnects; reflect the transient drop in the banner.
    if (es.readyState === EventSource.CONNECTING) setLive("off");
  };
}

// ── top bar + filters ────────────────────────────────────────────────────────
function renderTopbar(): void {
  const slot = document.getElementById("topbar")!;
  const m = state.meta;
  slot.replaceChildren(
    h(
      "div",
      { class: "brand" },
      h("span", { class: "hd__dot" }),
      h(
        "div",
        {},
        h("h1", {}, "MikroTik MCP · Observability"),
        h("small", {}, m ? `${num(m.total)} events stored · transport ${m.transport}` : "connecting…"),
      ),
    ),
    h("span", { style: "flex:1" }),
    h(
      "span",
      { class: `live${state.connected ? " is-on" : ""}`, title: "Live transport: WebSocket (preferred) or SSE fallback" },
      h("span", { class: "dot" }),
      state.liveMode === "off" ? "offline" : `live · ${state.liveMode}`,
    ),
  );
}

function select(id: string, label: string, options: string[], onChange: (v: string) => void): HTMLElement {
  const sel = h("select", { class: "btn", id }) as HTMLSelectElement;
  sel.append(h("option", { value: "" }, label) as HTMLOptionElement);
  for (const o of options) sel.append(h("option", { value: o }, o) as HTMLOptionElement);
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function populateFacets(): void {
  const m = state.meta;
  if (!m) return;
  const toolSel = document.getElementById("f-tool") as HTMLSelectElement | null;
  const devSel = document.getElementById("f-device") as HTMLSelectElement | null;
  const fill = (sel: HTMLSelectElement | null, opts: string[], keep: string): void => {
    if (!sel) return;
    sel.replaceChildren(h("option", { value: "" }, sel.id === "f-tool" ? "all tools" : "all devices") as HTMLOptionElement);
    for (const o of opts) sel.append(h("option", { value: o }, o) as HTMLOptionElement);
    sel.value = keep;
  };
  fill(toolSel, m.tools, state.filter.tool);
  fill(devSel, m.devices, state.filter.device);
}

function renderFilters(): void {
  const slot = document.getElementById("filters")!;
  const search = h("input", { class: "search", type: "search", placeholder: "Search tool / input / output / error…", id: "f-q" }) as HTMLInputElement;
  search.addEventListener("input", () => {
    state.filter.q = search.value;
    renderFeed();
  });

  const winSel = h("select", { class: "btn", title: "Time window" }) as HTMLSelectElement;
  for (const [label, val] of WINDOWS) {
    const o = h("option", { value: String(val) }, `window: ${label}`) as HTMLOptionElement;
    if (val === state.windowMs) o.selected = true;
    winSel.append(o);
  }
  winSel.addEventListener("change", () => {
    state.windowMs = Number(winSel.value);
    void refreshStats();
  });

  const pauseBtn = btn(state.paused ? "▶ Resume" : "⏸ Pause", () => {
    state.paused = !state.paused;
    pauseBtn.textContent = state.paused ? "▶ Resume" : "⏸ Pause";
    pauseBtn.className = `btn${state.paused ? " is-active" : ""}`;
  });

  slot.replaceChildren(
    h("div", { class: "grow", style: "flex:1;min-width:180px" }, search),
    select("f-tool", "all tools", state.meta?.tools ?? [], (v) => {
      state.filter.tool = v;
      renderFeed();
    }),
    select("f-risk", "all risk", ["READ", "WRITE", "WRITE_IDEMPOTENT", "DESTRUCTIVE", "DANGEROUS"], (v) => {
      state.filter.risk = v;
      renderFeed();
    }),
    select("f-device", "all devices", state.meta?.devices ?? [], (v) => {
      state.filter.device = v;
      renderFeed();
    }),
    select("f-status", "all status", ["ok", "error"], (v) => {
      state.filter.status = v;
      renderFeed();
    }),
    winSel,
    pauseBtn,
    btn("CSV", exportCsv),
    btn("JSON", exportJson),
    btn("Clear", () => {
      state.filter = { tool: "", risk: "", device: "", status: "", q: "" };
      renderFilters();
      renderFeed();
    }),
  );
}

function exportCsv(): void {
  const rows = state.feed.filter(matchesFilter);
  const cols = ["ts", "tool", "risk", "device", "durationMs", "isError", "error"];
  const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const body = rows
    .map((e) =>
      [new Date(e.ts).toISOString(), e.tool, e.risk, e.device ?? "", String(e.durationMs), String(e.isError), e.error ?? ""]
        .map(esc)
        .join(","),
    )
    .join("\n");
  download("mcp-events.csv", `${cols.join(",")}\n${body}\n`, "text/csv");
}
function exportJson(): void {
  download("mcp-events.json", JSON.stringify(state.feed.filter(matchesFilter), null, 2), "application/json");
}
function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── shell ────────────────────────────────────────────────────────────────────
function shell(): void {
  root.replaceChildren(
    h("div", { id: "topbar", class: "topbar" }),
    h("section", { id: "cards", class: "cards" }),
    h(
      "div",
      { class: "panel" },
      h("h2", {}, "Calls over time"),
      h("div", { id: "chart" }),
    ),
    h("section", { id: "breakdowns", class: "cols-3" }),
    h("section", { id: "devices" }),
    h("section", { id: "config" }),
    h(
      "div",
      { class: "panel" },
      h(
        "div",
        { class: "sheet__hd", style: "margin-bottom:12px" },
        h("h2", { style: "margin:0" }, "Live tool calls"),
        h("span", { style: "flex:1" }),
        h("span", { id: "feed-count", class: "muted" }, "—"),
      ),
      h("div", { id: "filters", class: "toolbar", style: "margin-bottom:12px" }),
      h(
        "div",
        { class: "feedwrap" },
        h(
          "table",
          { class: "feed" },
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              h("th", {}, "time"),
              h("th", {}, "tool"),
              h("th", {}, "risk"),
              h("th", {}, "device"),
              h("th", { class: "num" }, "dur"),
              h("th", {}, "status"),
              h("th", {}, "output"),
            ),
          ),
          h("tbody", { id: "feed-body" }),
        ),
      ),
    ),
    h("div", { id: "drawer" }),
  );
  renderTopbar();
  renderFilters();
}

// ── boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.selected) {
    state.selected = null;
    renderDrawer();
  }
});

shell();
void refreshMeta();
void refreshStats();
void loadInitialFeed();
void refreshDevices();
void refreshConfig();
connectLive();
// Periodically refresh analytics + device connectivity (the live feed itself
// updates instantly over WebSocket/SSE).
setInterval(() => {
  if (!state.paused) {
    void refreshStats();
    void refreshMeta();
    void refreshDevices();
  }
}, 4000);
// Config rarely changes — refresh it on a slower cadence.
setInterval(() => void refreshConfig(), 30_000);
