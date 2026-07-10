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
import { Button, Dot, Input } from "./geist";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
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

/**
 * Categorical palette for entity types, as `var()` references rather than hex so
 * both themes resolve them from `tailwind.css`. These land in SVG `fill`/`stroke`
 * attributes and inline styles, where a Tailwind class cannot reach.
 */
const TYPE_COLORS = [
  "var(--entity-1)",
  "var(--entity-2)",
  "var(--entity-3)",
  "var(--entity-4)",
  "var(--entity-5)",
  "var(--entity-6)",
  "var(--entity-7)",
  "var(--entity-8)",
  "var(--entity-9)",
  "var(--entity-10)",
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
  const repulsion = 3000;
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
      // Clamp to bounds — account for pill width based on label length.
      const pad = Math.max(40, n.label.length * 2.7 + 16);
      n.x = Math.max(pad, Math.min(width - pad, n.x));
      n.y = Math.max(30, Math.min(height - 30, n.y));
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

  const nodeMap = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout.nodes]);

  if (graph.entities.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center" style={{ height: H }}>
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
          <path d="M0 0 L10 3 L0 6Z" fill="var(--muted-foreground)" />
        </marker>
      </defs>
      {/* Edges */}
      {layout.edges.map((e, i) => {
        const s = nodeMap.get(e.source);
        const t = nodeMap.get(e.target);
        if (!s || !t) return null;
        const highlighted = selected != null && (e.source === selected || e.target === selected);
        const dimmed = selected != null && !highlighted;
        // Offset line ends by the pill edge so arrows don't overlap nodes.
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // Approximate pill half-width for each node.
        const pillW = (n: FNode): number => {
          const textW = n.label.length * 5.4;
          const halfH = 13 + Math.min(n.obsCount, 6);
          return Math.max(halfH, textW / 2 + 12);
        };
        const sOff = pillW(s) + 4;
        const tOff = pillW(t) + 4;
        const sx = s.x + (dx / dist) * sOff;
        const sy = s.y + (dy / dist) * sOff;
        const ex = t.x - (dx / dist) * tOff;
        const ey = t.y - (dy / dist) * tOff;
        const mx = (sx + ex) / 2;
        const my = (sy + ey) / 2;
        return (
          <g key={i} opacity={dimmed ? 0.15 : 1}>
            <line
              x1={sx}
              y1={sy}
              x2={ex}
              y2={ey}
              stroke={highlighted ? "var(--foreground)" : "var(--border)"}
              strokeWidth={highlighted ? 1.8 : 1}
              markerEnd="url(#mem-arrow)"
            />
            <text
              x={mx}
              y={my - 5}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              fontSize="8"
              style={{ pointerEvents: "none" }}
            >
              {e.label}
            </text>
          </g>
        );
      })}
      {/* Nodes — pill-shaped, width adapts to label text */}
      {layout.nodes.map((n) => {
        const isSel = n.id === selected;
        const dimmed = selected != null && !isSel;
        const c = typeColor(n.type);
        // Estimate text width: ~5.4px per char at fontSize 9, with padding.
        const label = n.label;
        const textW = label.length * 5.4;
        const padX = 12;
        const halfH = 13 + Math.min(n.obsCount, 6);
        const halfW = Math.max(halfH, textW / 2 + padX);
        const rx = halfH; // rounded ends
        return (
          <g
            key={n.id}
            opacity={dimmed ? 0.25 : 1}
            style={{ cursor: "pointer" }}
            onClick={() => setSelected(isSel ? null : n.id)}
          >
            <rect
              x={n.x - halfW}
              y={n.y - halfH}
              width={halfW * 2}
              height={halfH * 2}
              rx={rx}
              ry={rx}
              fill={c}
              fillOpacity={0.15}
              stroke={isSel ? "var(--foreground)" : c}
              strokeWidth={isSel ? 2 : 1.2}
            />
            <text
              x={n.x}
              y={n.y + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--foreground)"
              fontSize="9"
              fontWeight={isSel ? 600 : 400}
              style={{ pointerEvents: "none" }}
            >
              {label}
            </text>
            <text
              x={n.x}
              y={n.y + halfH + 11}
              textAnchor="middle"
              fill="var(--muted-foreground)"
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
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-2 flex items-center gap-2.5">
        <h3 className="m-0 flex items-center font-mono text-[15px]">
          <Dot color={typeColor(entity.entityType)} className="mr-2 size-2.5" />
          {entity.name}
        </h3>
        <span className="flex-1" />
        <Button type="error" ghost size="sm" onClick={onDelete} title="Delete entity">
          Delete
        </Button>
        <Button type="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="mt-0 mb-2 text-xs text-muted-foreground">
        Type: <strong>{entity.entityType}</strong> · Created:{" "}
        {new Date(entity.createdAt).toLocaleString()} · Updated:{" "}
        {new Date(entity.updatedAt).toLocaleString()}
      </p>

      {entity.observations.length > 0 && (
        <>
          <h4 className="mt-3 mb-1.5 text-xs text-muted-foreground">
            Observations ({entity.observations.length})
          </h4>
          <ul className="m-0 pl-[18px] text-[13px]">
            {entity.observations.map((o, i) => (
              <li key={i} className="mb-0.5">
                {o}
              </li>
            ))}
          </ul>
        </>
      )}

      {(outgoing.length > 0 || incoming.length > 0) && (
        <>
          <h4 className="mt-3 mb-1.5 text-xs text-muted-foreground">Relations</h4>
          <div className="text-[13px]">
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

function ActivityPanel({ activity }: { activity: MemoryActivityEntry[] }): ReactNode {
  if (activity.length === 0) {
    return <p className="text-muted-foreground text-[13px]">No activity yet.</p>;
  }
  return (
    <div className="max-h-[280px] overflow-y-auto">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Subject</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activity.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {clock(a.ts)}
              </TableCell>
              <TableCell>{ACTION_LABELS[a.action] ?? a.action}</TableCell>
              <TableCell className="max-w-[260px] truncate">{a.subject}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
      const res = await postJson<{ ok?: boolean; error?: string }>("/api/memory/config", {
        dbPath,
      });
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
      <label className="mb-1 block text-xs text-muted-foreground">Database path</label>
      <div className="flex gap-1.5">
        <Input
          type="text"
          value={dbPath}
          onChange={(e) => setDbPath(e.target.value)}
          className="flex-1 text-[13px]"
        />
        <Button size="sm" onClick={save} disabled={saving || dbPath === config.dbPath}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {msg && (
        <p className={cn("mt-1 text-xs", msg === "Saved" ? "text-success" : "text-destructive")}>
          {msg}
        </p>
      )}
      {config.stats && (
        <div className="mt-3 grid grid-cols-3 gap-3">
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
      const g = await api<MemoryGraph>(`/api/memory/search?q=${encodeURIComponent(search)}`);
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
        <p className="text-destructive">{error}</p>
      </Panel>
    );
  }

  return (
    <>
      {/* Stats row */}
      {stats && (
        <div className="reveal grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
          <div className="flex gap-1.5">
            <Input
              type="text"
              placeholder="Search entities…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-[200px] text-xs"
            />
            <Button size="sm" onClick={handleSearch}>
              Search
            </Button>
            {search && (
              <Button
                size="sm"
                type="secondary"
                onClick={() => {
                  setSearch("");
                  void load();
                }}
              >
                Clear
              </Button>
            )}
          </div>
        }
      >
        {graph && <GraphPanel graph={graph} />}
      </Panel>

      <div className="reveal grid grid-cols-2 gap-4">
        {/* Entity browser */}
        <Panel title="Entities">
          {graph && graph.entities.length > 0 ? (
            <div className="max-h-[360px] overflow-y-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Obs</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {graph.entities.map((e) => (
                    <TableRow
                      key={e.name}
                      className="cursor-pointer"
                      data-state={selectedEntity?.name === e.name ? "selected" : undefined}
                      onClick={() => setSelectedEntity(e)}
                    >
                      <TableCell>
                        <Dot color={typeColor(e.entityType)} className="mr-1.5" />
                        {e.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{e.entityType}</TableCell>
                      <TableCell>{e.observations.length}</TableCell>
                      <TableCell className="text-muted-foreground">{clock(e.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-[13px]">
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
        <div className="reveal grid grid-cols-2 gap-4">
          {stats.entityTypes.length > 0 && (
            <Panel title="Entity Types">
              <div className="flex flex-wrap gap-2">
                {stats.entityTypes.map((t) => (
                  <span
                    key={t.type}
                    className="inline-flex items-center gap-1 rounded-xl px-2.5 py-0.5 text-xs"
                    // Pill hues come from the per-type palette, so they stay inline.
                    style={{
                      background: `${typeColor(t.type)}22`,
                      border: `1px solid ${typeColor(t.type)}44`,
                    }}
                  >
                    <Dot color={typeColor(t.type)} />
                    {t.type}
                    <span className="text-muted-foreground">({t.count})</span>
                  </span>
                ))}
              </div>
            </Panel>
          )}
          {stats.relationTypes.length > 0 && (
            <Panel title="Relation Types">
              <div className="flex flex-wrap gap-2">
                {stats.relationTypes.map((t) => (
                  <span
                    key={t.type}
                    className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted px-2.5 py-0.5 text-xs"
                  >
                    {t.type}
                    <span className="text-muted-foreground">({t.count})</span>
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
