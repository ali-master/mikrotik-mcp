import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ms } from "./format";
import { Badge } from "./geist";
import type { DeviceInfo, DevicesPayload, DeviceStatus } from "./types";

/**
 * A pill-backed SVG label whose rounded rect is sized to the REAL rendered text
 * width (`getComputedTextLength`) rather than a character-count guess — so the
 * "⤳ via …" jump badge fits its content exactly, whatever the bastion name and
 * however the arrow/space glyphs render. Falls back to an estimate for the first
 * paint, then snaps to the measured width on mount/text change.
 */
function PillLabel({
  x,
  y,
  text,
  className,
  textClassName,
  padX = 9,
  fontSize = 9,
}: {
  x: number;
  y: number;
  text: string;
  className: string;
  textClassName: string;
  padX?: number;
  fontSize?: number;
}): ReactNode {
  const ref = useRef<SVGTextElement>(null);
  const [w, setW] = useState(() => text.length * fontSize * 0.62);
  useLayoutEffect(() => {
    const measured = ref.current?.getComputedTextLength();
    if (measured && measured > 0) setW(measured);
  }, [text, fontSize]);
  const bw = Math.round(w + padX * 2);
  return (
    <g transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
      <rect className={className} x={-bw / 2} y={-9} rx={9} width={bw} height={18} />
      <text
        ref={ref}
        className={textClassName}
        x={0}
        y={3.5}
        textAnchor="middle"
        fontSize={fontSize}
      >
        {text}
      </text>
    </g>
  );
}

// ── connectivity graph ───────────────────────────────────────────────────────
export function statusInfo(s: DeviceStatus): { label: string; color: string } {
  if (s.reachable === true) return { label: "online", color: "#d4d4d8" };
  if (s.reachable === false) return { label: "offline", color: "#f87171" };
  return { label: "checking…", color: "#71717a" };
}

/**
 * A stable, vivid colour per device, derived deterministically from its name —
 * so each device keeps the same colour across reloads with no storage, and a new
 * device gets a distinct hue. Used to tint its connectivity orb and device card.
 */
export function deviceColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 62%)`;
}

/** A point on a quadratic Bézier (core → control → device) at parameter `t`. */
export function qPoint(
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
export function qAngle(
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

export const FLOW_CMD = "#e4e4e7"; // command: LLM → device
export const FLOW_RES = "#d4d4d8"; // response: device → LLM
export const JUMP_HUE = "#f59e0b"; // SSH jump tunnel (ProxyJump) — amber accent

/**
 * The bastion a device is reached through, or null. A `jumpVia` names another
 * configured device; an inline `jumpHost` is shown as `host:port`.
 */
export function jumpLabel(d: DeviceInfo): string | null {
  if (d.jumpVia) return d.jumpVia;
  if (d.jumpHost) return `${d.jumpHost.host}:${d.jumpHost.port}`;
  return null;
}

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
export const NODE_MAX_R = 70;
export const NODE_MAX_CHARS = Math.floor((2 * NODE_MAX_R - 24) / 6.2);
export const nodeLabel = (raw: string): string =>
  raw.length > NODE_MAX_CHARS ? `${raw.slice(0, NODE_MAX_CHARS - 1)}…` : raw;
/** Circle radius that fits `label` across its diameter, clamped to [23, NODE_MAX_R]. */
export const nodeRadius = (label: string): number =>
  Math.max(23, Math.min(NODE_MAX_R, label.length * 3.1 + 12));

export function ConnectivityGraph({
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
          <linearGradient id="conn-tunnel-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={JUMP_HUE} stopOpacity="0.15" />
            <stop offset="0.5" stopColor={JUMP_HUE} stopOpacity="0.95" />
            <stop offset="1" stopColor={JUMP_HUE} stopOpacity="0.15" />
          </linearGradient>
          <filter id="conn-tunnel-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
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

        {/* ── SSH ProxyJump tunnels ─────────────────────────────────────────
            A device reached THROUGH a bastion gets an encrypted side-channel
            drawn around the rim: an amber, glowing, animated conduit from its
            jump host to it, with a padlock that physically travels the tunnel in
            the jump direction. When the bastion is a configured device the arc
            links the two orbs; an inline jumpHost gets its own satellite lock. */}
        {nodes.map((nd) => {
          const via = nd.d.jumpVia;
          const bastion = via ? nodes.find((m) => m.d.name === via) : undefined;
          const inline = !bastion && nd.d.jumpHost ? nd.d.jumpHost : undefined;
          if (!bastion && !inline) return null;

          // Endpoints: bastion orb → this orb, or external satellite → this orb.
          const to = { x: nd.x, y: nd.y };
          const dirL = Math.hypot(nd.x - cx, nd.y - cy) || 1;
          const ux = (nd.x - cx) / dirL;
          const uy = (nd.y - cy) / dirL;
          const from = bastion
            ? { x: bastion.x, y: bastion.y }
            : { x: nd.x + ux * (nd.r + 46), y: nd.y + uy * (nd.r + 46) };

          // Bow the arc OUTWARD (away from the core) so it rides the rim, clear
          // of the central command/response lanes.
          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2;
          const ol = Math.hypot(mx - cx, my - cy) || 1;
          const bow = bastion ? 50 : 16;
          const ctrl = {
            x: mx + ((mx - cx) / ol) * bow,
            y: my + ((my - cy) / ol) * bow,
          };
          const path = `M${from.x.toFixed(1)},${from.y.toFixed(1)} Q${ctrl.x.toFixed(1)},${ctrl.y.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}`;
          const label = jumpLabel(nd.d) ?? "";
          const badge = qPoint(from, ctrl, to, 0.5);
          const pid = `conn-tunnel-${nd.i}`;

          return (
            <g key={`jump-${nd.d.name}`} className="conn-tunnel-g">
              {/* soft amber halo under the conduit */}
              <path className="conn-tunnel-halo" d={path} stroke={JUMP_HUE} />
              {/* the encrypted conduit: animated dashed gradient stroke */}
              <path
                id={pid}
                className="conn-tunnel"
                d={path}
                stroke="url(#conn-tunnel-grad)"
                filter="url(#conn-tunnel-glow)"
              />
              {/* external-bastion satellite (no device orb to anchor to) */}
              {inline && (
                <>
                  <circle
                    className="conn-tunnel-sat"
                    cx={from.x}
                    cy={from.y}
                    r={11}
                    fill="#1c1917"
                    stroke={JUMP_HUE}
                  />
                  <text x={from.x} y={from.y + 3.5} textAnchor="middle" fontSize={11}>
                    🛡️
                  </text>
                </>
              )}
              {/* the padlock that travels the tunnel (bastion → device) */}
              <text className="conn-tunnel-lock" fontSize={13} textAnchor="middle">
                🔒
                <animateMotion dur="2.4s" repeatCount="indefinite" calcMode="linear" rotate="auto">
                  <mpath href={`#${pid}`} />
                </animateMotion>
              </text>
              {/* midpoint "via" badge — pill sized to the real text width */}
              <PillLabel
                x={badge.x}
                y={badge.y}
                text={`⤳ via ${label}`}
                className="conn-tunnel-badge"
                textClassName="conn-tunnel-badge-tx"
              />
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
        {payload.devices.some((d) => jumpLabel(d)) && (
          <span>
            <i style={{ background: JUMP_HUE }} /> 🔒 SSH jump tunnel (ProxyJump)
          </span>
        )}
      </div>
    </>
  );
}

export function DeviceCard({ d }: { d: DeviceInfo }): ReactNode {
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
      {jumpLabel(d) && (
        <div
          className="jump-route"
          title={`Reached over SSH through the bastion ${jumpLabel(d)} (ProxyJump) — no port exposed on ${d.name}.`}
        >
          <span className="jump-route__hop jump-route__hop--bastion">
            🛡️ {jumpLabel(d)}
            {d.jumpVia ? <i className="jump-route__tag">jump</i> : null}
          </span>
          <span className="jump-route__wire jump-route__wire--enc">
            <span className="jump-route__lock" aria-hidden>
              🔒
            </span>
          </span>
          <span
            className="jump-route__hop jump-route__hop--dest"
            style={{ borderColor: col }}
            title={d.name}
          >
            📡 {d.name}
          </span>
        </div>
      )}
    </div>
  );
}
