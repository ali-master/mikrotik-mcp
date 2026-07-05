/**
 * MemoryView — Knowledge Graph dashboard page.
 *
 * Four panels: force-directed graph, entity browser, activity log, and config.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, deleteJson, postJson } from "./api";
import { Panel, StatCard } from "./atoms";
import { clock } from "./format";
import type {
  MemoryActivityEntry,
  MemoryConfig,
  MemoryEntity,
  MemoryGraph,
  MemoryRelation,
  MemoryStats,
} from "./types";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Deterministic hue from a string (0–360). */
function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return h % 360;
}

const TYPE_COLORS = [
  "#3291ff",
  "#34d399",
  "#a78bfa",
  "#f59e0b",
  "#ef4444",
  "#2dd4bf",
  "#f472b6",
  "#60a5fa",
  "#facc15",
  "#fb923c",
];

function typeColor(t: string): string {
  return TYPE_COLORS[Math.abs(hueOf(t)) % TYPE_COLORS.length];
}

const ACTION_LABELS: Record<string, string> = {
  create_entity: "Created entity",
  delete_entity: "Deleted entity",
  create_relation: "Created relation",
  delete_relation: "Deleted relation",
  add_observation: "Added observations",
  delete_observation: "Deleted observations",
};

// ── Force layout ─────────────────────────────────────────────────────────────

interface FNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  obsCount: number;
}

interface FEdge {
  source: string;
  target: string;
  label: string;
}

function forceLayout(
  entities: MemoryEntity[],
  relations: MemoryRelation[],
  width: number,
  height: number,
): { nodes: FNode[]; edges: FEdge[] } {
  const cx = width / 2;
  const cy = height / 2;

  const nodes: FNode[] = entities.map((e, i) => {
    const angle = (2 * Math.PI * i) / Math.max(entities.length, 1);
    const r = Math.min(width, height) * 0.3;
    return {
      id: e.name,
      label: e.name,
      type: e.entityType,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      vx: 0,
      vy: 0,
      obsCount: e.observations.length,
    };
  });

  const edges: FEdge[] = relations.map((r) => ({
    source: r.from,
    target: r.to,
    label: r.relationType,
  }));

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Simple force simulation
  const repulsion = 2000;
  const attraction = 0.005;
  const damping = 0.85;
  const iterations = 200;

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsion / (dist * dist);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx += dx;
        a.vy += dy;
        b.vx -= dx;
        b.vy -= dy;
      }
    }

    // Attraction along edges
    for (const e of edges) {
      const s = nodeMap.get(e.source);
      const t = nodeMap.get(e.target);
      if (!s || !t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const fx = dx * attraction;
      const fy = dy * attraction;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    // Centering force
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.001;
      n.vy += (cy - n.y) * 0.001;
    }

    // Apply velocity with damping
    for (const n of nodes) {
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx;
      n.y += n.vy;
      // Clamp to bounds
      n.x = Math.max(40, Math.min(width - 40, n.x));
      n.y = Math.max(40, Math.min(height - 40, n.y));
    }
  }

  return { nodes, edges };
}

// ── Graph SVG ────────────────────────────────────────────────────────────────

function GraphPanel({ graph }: { graph: MemoryGraph }): ReactNode {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const W = 700;
  const H = 460;

  const layout = useMemo(
    () => forceLayout(graph.entities, graph.relations, W, H),
    [graph.entities, graph.relations],
  );

  const nodeMap = useMemo(
    () => new Map(layout.nodes.map((n) => [n.id, n])),
    [layout.nodes],
  );

  if (graph.entities.length === 0) {
    return (
      <div
        style={{
          height: H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--mt-text-faint)",
        }}
      >
        <p>No entities yet — create some via the MCP tools.</p>
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", maxHeight: H, display: "block" }}
    >
      <defs>
        <marker
          id="mem-arrow"
          viewBox="0 0 10 6"
          refX="10"
          refY="3"
          markerWidth="8"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 3 L0 6Z" fill="#666" />
        </marker>
      </defs>
      {/* Edges */}
      {layout.edges.map((e, i) => {
        const s = nodeMap.get(e.source);
        const t = nodeMap.get(e.target);
        if (!s || !t) return null;
        const highlighted =
          selected != null && (e.source === selected || e.target === selected);
        const dimmed = selected != null && !highlighted;
        // Offset the line ends by the node radius so arrow doesn't overlap
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nr = 22;
        const sx = s.x + (dx / dist) * nr;
        const sy = s.y + (dy / dist) * nr;
        const ex = t.x - (dx / dist) * nr;
        const ey = t.y - (dy / dist) * nr;
        const mx = (sx + ex) / 2;
        const my = (sy + ey) / 2;
        return (
          <g key={i} opacity={dimmed ? 0.15 : 1}>
            <line
              x1={sx}
              y1={sy}
              x2={ex}
              y2={ey}
              stroke={highlighted ? "#e4e4e7" : "#444"}
              strokeWidth={highlighted ? 1.8 : 1}
              markerEnd="url(#mem-arrow)"
            />
            <text
              x={mx}
              y={my - 5}
              textAnchor="middle"
              fill="#888"
              fontSize="8"
              style={{ pointerEvents: "none" }}
            >
              {e.label}
            </text>
          </g>
        );
      })}
      {/* Nodes */}
      {layout.nodes.map((n) => {
        const isSel = n.id === selected;
        const dimmed = selected != null && !isSel;
        const r = 18 + Math.min(n.obsCount, 8) * 1.5;
        const c = typeColor(n.type);
        return (
          <g
            key={n.id}
            opacity={dimmed ? 0.25 : 1}
            style={{ cursor: "pointer" }}
            onClick={() => setSelected(isSel ? null : n.id)}
          >
            <circle
              cx={n.x}
              cy={n.y}
              r={r}
              fill={c}
              fillOpacity={0.15}
              stroke={isSel ? "#fff" : c}
              strokeWidth={isSel ? 2 : 1.2}
            />
            <text
              x={n.x}
              y={n.y + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#e8eaed"
              fontSize="9"
              fontWeight={isSel ? 600 : 400}
              style={{ pointerEvents: "none" }}
            >
              {n.label.length > 16 ? `${n.label.slice(0, 14)}…` : n.label}
            </text>
            <text
              x={n.x}
              y={n.y + r + 11}
              textAnchor="middle"
              fill="#888"
              fontSize="7"
              style={{ pointerEvents: "none" }}
            >
              {n.type}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Entity detail ────────────────────────────────────────────────────────────

function EntityDetail({
  entity,
  relations,
  onClose,
  onDelete,
}: {
  entity: MemoryEntity;
  relations: MemoryRelation[];
  onClose: () => void;
  onDelete: () => void;
}): ReactNode {
  const incoming = relations.filter((r) => r.to === entity.name);
  const outgoing = relations.filter((r) => r.from === entity.name);

  return (
    <div className="panel" style={{ border: "1px solid var(--mt-border)" }}>
      <div className="sheet__hd" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: typeColor(entity.entityType),
              marginRight: 8,
            }}
          />
          {entity.name}
        </h3>
        <span style={{ flex: 1 }} />
        <button
          className="btn btn--danger btn--xs"
          onClick={onDelete}
          title="Delete entity"
        >
          Delete
        </button>
        <button className="btn btn--xs" onClick={onClose} style={{ marginLeft: 6 }}>
          Close
        </button>
      </div>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
        Type: <strong>{entity.entityType}</strong> · Created:{" "}
        {new Date(entity.createdAt).toLocaleString()} · Updated:{" "}
        {new Date(entity.updatedAt).toLocaleString()}
      </p>

      {entity.observations.length > 0 && (
        <>
          <h4 style={{ margin: "12px 0 6px", fontSize: 12, color: "#9aa3af" }}>
            Observations ({entity.observations.length})
          </h4>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {entity.observations.map((o, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                {o}
              </li>
            ))}
          </ul>
        </>
      )}

      {(outgoing.length > 0 || incoming.length > 0) && (
        <>
          <h4 style={{ margin: "12px 0 6px", fontSize: 12, color: "#9aa3af" }}>
            Relations
          </h4>
          <div style={{ fontSize: 13 }}>
            {outgoing.map((r, i) => (
              <div key={`o${i}`}>
                → <strong>{r.relationType}</strong> → {r.to}
              </div>
            ))}
            {incoming.map((r, i) => (
              <div key={`i${i}`}>
                ← <strong>{r.relationType}</strong> ← {r.from}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Activity log ─────────────────────────────────────────────────────────────

function ActivityPanel({
  activity,
}: {
  activity: MemoryActivityEntry[];
}): ReactNode {
  if (activity.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        No activity yet.
      </p>
    );
  }
  return (
    <div style={{ maxHeight: 280, overflowY: "auto" }}>
      <table className="tbl" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Subject</th>
          </tr>
        </thead>
        <tbody>
          {activity.map((a) => (
            <tr key={a.id}>
              <td className="muted" style={{ whiteSpace: "nowrap" }}>
                {clock(a.ts)}
              </td>
              <td>{ACTION_LABELS[a.action] ?? a.action}</td>
              <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
                {a.subject}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Config panel ─────────────────────────────────────────────────────────────

function ConfigPanel({
  config,
  onSaved,
}: {
  config: MemoryConfig;
  onSaved: () => void;
}): ReactNode {
  const [dbPath, setDbPath] = useState(config.dbPath);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setDbPath(config.dbPath);
  }, [config.dbPath]);

  const save = useCallback(async () => {
    setSaving(true);
    setMsg("");
    try {
      const res = await postJson<{ ok?: boolean; error?: string }>(
        "/api/memory/config",
        { dbPath },
      );
      if (res.ok) {
        setMsg("Saved");
        onSaved();
      } else {
        setMsg(res.error ?? "Failed");
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSaving(false);
    }
  }, [dbPath, onSaved]);

  return (
    <div>
      <label style={{ fontSize: 12, color: "#9aa3af", display: "block", marginBottom: 4 }}>
        Database path
      </label>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="text"
          value={dbPath}
          onChange={(e) => setDbPath(e.target.value)}
          className="input"
          style={{ flex: 1, fontSize: 13 }}
        />
        <button
          className="btn btn--sm"
          onClick={save}
          disabled={saving || dbPath === config.dbPath}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {msg && (
        <p
          style={{
            fontSize: 12,
            marginTop: 4,
            color: msg === "Saved" ? "#34d399" : "#ef4444",
          }}
        >
          {msg}
        </p>
      )}
      {config.stats && (
        <div className="stats-row" style={{ marginTop: 12 }}>
          <StatCard k="Entities" v={String(config.stats.entities)} />
          <StatCard k="Relations" v={String(config.stats.relations)} />
          <StatCard k="Observations" v={String(config.stats.observations)} />
        </div>
      )}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export function MemoryView(): ReactNode {
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [config, setConfig] = useState<MemoryConfig | null>(null);
  const [activity, setActivity] = useState<MemoryActivityEntry[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<MemoryEntity | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [g, s, c, a] = await Promise.all([
        api<MemoryGraph>("/api/memory/graph"),
        api<MemoryStats>("/api/memory/stats"),
        api<MemoryConfig>("/api/memory/config"),
        api<MemoryActivityEntry[]>("/api/memory/activity?limit=50"),
      ]);
      setGraph(g);
      setStats(s);
      setConfig(c);
      setActivity(a);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 10_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleSearch = useCallback(async () => {
    if (!search.trim()) {
      void load();
      return;
    }
    try {
      const g = await api<MemoryGraph>(
        `/api/memory/search?q=${encodeURIComponent(search)}`,
      );
      setGraph(g);
    } catch (e) {
      setError(String(e));
    }
  }, [search, load]);

  const handleDelete = useCallback(
    async (name: string) => {
      await deleteJson("/api/memory/entities", { names: [name] });
      setSelectedEntity(null);
      void load();
    },
    [load],
  );

  if (error && !graph) {
    return (
      <Panel title="Knowledge Graph">
        <p style={{ color: "#ef4444" }}>{error}</p>
      </Panel>
    );
  }

  return (
    <>
      {/* Stats row */}
      {stats && (
        <div className="stats-row reveal">
          <StatCard k="Entities" v={String(stats.entities)} />
          <StatCard k="Relations" v={String(stats.relations)} />
          <StatCard k="Observations" v={String(stats.observations)} />
          <StatCard k="Entity types" v={String(stats.entityTypes.length)} />
          <StatCard k="Relation types" v={String(stats.relationTypes.length)} />
        </div>
      )}

      {/* Graph panel */}
      <Panel
        title="Knowledge Graph"
        className="reveal"
        extra={
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              placeholder="Search entities…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="input"
              style={{ width: 200, fontSize: 12 }}
            />
            <button className="btn btn--xs" onClick={handleSearch}>
              Search
            </button>
            {search && (
              <button
                className="btn btn--xs"
                onClick={() => {
                  setSearch("");
                  void load();
                }}
              >
                Clear
              </button>
            )}
          </div>
        }
      >
        {graph && <GraphPanel graph={graph} />}
      </Panel>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
        className="reveal"
      >
        {/* Entity browser */}
        <Panel title="Entities">
          {graph && graph.entities.length > 0 ? (
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Obs</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {graph.entities.map((e) => (
                    <tr
                      key={e.name}
                      style={{
                        cursor: "pointer",
                        background:
                          selectedEntity?.name === e.name
                            ? "rgba(255,255,255,0.05)"
                            : undefined,
                      }}
                      onClick={() => setSelectedEntity(e)}
                    >
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            backgroundColor: typeColor(e.entityType),
                            marginRight: 6,
                          }}
                        />
                        {e.name}
                      </td>
                      <td className="muted">{e.entityType}</td>
                      <td>{e.observations.length}</td>
                      <td className="muted">{clock(e.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              {graph ? "No entities." : "Loading…"}
            </p>
          )}
        </Panel>

        {/* Entity detail or activity log */}
        {selectedEntity && graph ? (
          <EntityDetail
            entity={selectedEntity}
            relations={graph.relations}
            onClose={() => setSelectedEntity(null)}
            onDelete={() => handleDelete(selectedEntity.name)}
          />
        ) : (
          <Panel title="Activity Log">
            <ActivityPanel activity={activity} />
          </Panel>
        )}
      </div>

      {/* Type breakdown */}
      {stats && (stats.entityTypes.length > 0 || stats.relationTypes.length > 0) && (
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
          className="reveal"
        >
          {stats.entityTypes.length > 0 && (
            <Panel title="Entity Types">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {stats.entityTypes.map((t) => (
                  <span
                    key={t.type}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 10px",
                      borderRadius: 12,
                      background: `${typeColor(t.type)}22`,
                      border: `1px solid ${typeColor(t.type)}44`,
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: typeColor(t.type),
                      }}
                    />
                    {t.type}
                    <span className="muted">({t.count})</span>
                  </span>
                ))}
              </div>
            </Panel>
          )}
          {stats.relationTypes.length > 0 && (
            <Panel title="Relation Types">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {stats.relationTypes.map((t) => (
                  <span
                    key={t.type}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 10px",
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid var(--mt-border)",
                      fontSize: 12,
                    }}
                  >
                    {t.type}
                    <span className="muted">({t.count})</span>
                  </span>
                ))}
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* Config */}
      {config && (
        <Panel title="Memory Configuration" className="reveal">
          <ConfigPanel config={config} onSaved={load} />
        </Panel>
      )}
    </>
  );
}
