import { useState } from "react";
import type { ReactNode } from "react";
import { CopyButton } from "./atoms";
import type { TopoNode, TopologyPayload } from "./types";

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
export function TopologyMap({
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
