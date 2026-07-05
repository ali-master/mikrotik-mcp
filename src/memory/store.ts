/**
 * Knowledge-graph memory persistence backed by Bun's native SQLite.
 *
 * `bun:sqlite` is imported **dynamically** inside {@link openMemoryStore} so the
 * static import graph stays Node-loadable (same discipline as the event store in
 * `src/observability/store.ts`). The schema uses three core tables (entities,
 * observations, relations) plus a mutation activity log for the dashboard.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Database } from "bun:sqlite";
import type {
  Entity,
  KnowledgeGraph,
  MemoryActivity,
  MemoryStats,
  Relation,
} from "./types";

// ── Store interface ──────────────────────────────────────────────────────────

export interface MemoryStore {
  createEntities(
    entities: { name: string; entityType: string; observations?: string[] }[],
  ): Entity[];
  createRelations(
    relations: { from: string; to: string; relationType: string }[],
  ): Relation[];
  addObservations(
    entries: { entityName: string; contents: string[] }[],
  ): { entityName: string; added: string[] }[];
  deleteEntities(names: string[]): number;
  deleteObservations(
    entries: { entityName: string; observations: string[] }[],
  ): number;
  deleteRelations(
    relations: { from: string; to: string; relationType: string }[],
  ): number;
  readGraph(): KnowledgeGraph;
  searchNodes(query: string, limit?: number): KnowledgeGraph;
  openNodes(names: string[]): KnowledgeGraph;
  stats(): MemoryStats;
  activity(limit?: number, since?: number): MemoryActivity[];
  close(): void;
}

// ── Schema DDL ───────────────────────────────────────────────────────────────

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS entities (
     name        TEXT PRIMARY KEY,
     entity_type TEXT NOT NULL,
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL
   )`,
  "CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type)",

  `CREATE TABLE IF NOT EXISTS observations (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     entity_name TEXT NOT NULL REFERENCES entities(name) ON DELETE CASCADE,
     content     TEXT NOT NULL,
     created_at  INTEGER NOT NULL,
     UNIQUE(entity_name, content)
   )`,
  "CREATE INDEX IF NOT EXISTS idx_obs_entity ON observations(entity_name)",

  `CREATE TABLE IF NOT EXISTS relations (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     from_entity   TEXT NOT NULL REFERENCES entities(name) ON DELETE CASCADE,
     to_entity     TEXT NOT NULL REFERENCES entities(name) ON DELETE CASCADE,
     relation_type TEXT NOT NULL,
     created_at    INTEGER NOT NULL,
     UNIQUE(from_entity, to_entity, relation_type)
   )`,
  "CREATE INDEX IF NOT EXISTS idx_rel_from ON relations(from_entity)",
  "CREATE INDEX IF NOT EXISTS idx_rel_to ON relations(to_entity)",

  `CREATE TABLE IF NOT EXISTS memory_activity (
     id      INTEGER PRIMARY KEY AUTOINCREMENT,
     ts      INTEGER NOT NULL,
     action  TEXT NOT NULL,
     subject TEXT NOT NULL,
     detail  TEXT
   )`,
  "CREATE INDEX IF NOT EXISTS idx_activity_ts ON memory_activity(ts)",
];

// ── Row shapes ───────────────────────────────────────────────────────────────

interface EntityRow {
  name: string;
  entity_type: string;
  created_at: number;
  updated_at: number;
}

interface RelationRow {
  from_entity: string;
  to_entity: string;
  relation_type: string;
  created_at: number;
}

interface ActivityRow {
  id: number;
  ts: number;
  action: string;
  subject: string;
  detail: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rowToEntity(r: EntityRow, observations: string[]): Entity {
  return {
    name: r.name,
    entityType: r.entity_type,
    observations,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToRelation(r: RelationRow): Relation {
  return {
    from: r.from_entity,
    to: r.to_entity,
    relationType: r.relation_type,
    createdAt: r.created_at,
  };
}

function rowToActivity(r: ActivityRow): MemoryActivity {
  return {
    id: r.id,
    ts: r.ts,
    action: r.action,
    subject: r.subject,
    detail: r.detail ?? undefined,
  };
}

// ── Implementation ───────────────────────────────────────────────────────────

class SqliteMemoryStore implements MemoryStore {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA foreign_keys = ON");
    for (const stmt of SCHEMA_STATEMENTS) db.run(stmt);
  }

  private log(action: string, subject: string, detail?: unknown): void {
    this.db
      .query(
        "INSERT INTO memory_activity (ts, action, subject, detail) VALUES ($ts, $action, $subject, $detail)",
      )
      .run({
        $ts: Date.now(),
        $action: action,
        $subject: subject,
        $detail: detail !== undefined ? JSON.stringify(detail) : null,
      });
  }

  private observationsFor(entityName: string): string[] {
    const rows = this.db
      .query("SELECT content FROM observations WHERE entity_name = $name ORDER BY id")
      .all({ $name: entityName }) as { content: string }[];
    return rows.map((r) => r.content);
  }

  private loadEntity(name: string): Entity | null {
    const row = this.db
      .query("SELECT * FROM entities WHERE name = $name")
      .get({ $name: name }) as EntityRow | null;
    if (!row) return null;
    return rowToEntity(row, this.observationsFor(name));
  }

  private relationsForEntities(names: Set<string>): Relation[] {
    if (names.size === 0) return [];
    const all = this.db.query("SELECT * FROM relations").all() as RelationRow[];
    return all
      .filter((r) => names.has(r.from_entity) || names.has(r.to_entity))
      .map(rowToRelation);
  }

  // ── Entity CRUD ──────────────────────────────────────────────────────────

  createEntities(
    entities: { name: string; entityType: string; observations?: string[] }[],
  ): Entity[] {
    const now = Date.now();
    const created: Entity[] = [];
    const insertEntity = this.db.query(
      "INSERT OR IGNORE INTO entities (name, entity_type, created_at, updated_at) VALUES ($name, $type, $ts, $ts)",
    );
    const insertObs = this.db.query(
      "INSERT OR IGNORE INTO observations (entity_name, content, created_at) VALUES ($name, $content, $ts)",
    );

    for (const e of entities) {
      const res = insertEntity.run({ $name: e.name, $type: e.entityType, $ts: now });
      if (Number(res.changes ?? 0) > 0) {
        const obs = e.observations ?? [];
        for (const o of obs) insertObs.run({ $name: e.name, $content: o, $ts: now });
        created.push({
          name: e.name,
          entityType: e.entityType,
          observations: obs,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    if (created.length > 0) {
      this.log(
        "create_entity",
        created.map((e) => e.name).join(", "),
        { count: created.length, types: created.map((e) => e.entityType) },
      );
    }
    return created;
  }

  deleteEntities(names: string[]): number {
    if (names.length === 0) return 0;
    let removed = 0;
    const del = this.db.query("DELETE FROM entities WHERE name = $name");
    for (const name of names) {
      const res = del.run({ $name: name });
      removed += Number(res.changes ?? 0);
    }
    if (removed > 0) {
      this.log("delete_entity", names.join(", "), { count: removed });
    }
    return removed;
  }

  // ── Observation CRUD ─────────────────────────────────────────────────────

  addObservations(
    entries: { entityName: string; contents: string[] }[],
  ): { entityName: string; added: string[] }[] {
    const now = Date.now();
    const results: { entityName: string; added: string[] }[] = [];
    const insertObs = this.db.query(
      "INSERT OR IGNORE INTO observations (entity_name, content, created_at) VALUES ($name, $content, $ts)",
    );
    const touchEntity = this.db.query(
      "UPDATE entities SET updated_at = $ts WHERE name = $name",
    );

    for (const entry of entries) {
      // Verify entity exists
      const exists = this.db
        .query("SELECT 1 FROM entities WHERE name = $name")
        .get({ $name: entry.entityName });
      if (!exists) continue;

      const added: string[] = [];
      for (const content of entry.contents) {
        const res = insertObs.run({
          $name: entry.entityName,
          $content: content,
          $ts: now,
        });
        if (Number(res.changes ?? 0) > 0) added.push(content);
      }
      if (added.length > 0) {
        touchEntity.run({ $name: entry.entityName, $ts: now });
        results.push({ entityName: entry.entityName, added });
      }
    }
    if (results.length > 0) {
      this.log(
        "add_observation",
        results.map((r) => r.entityName).join(", "),
        { entries: results.map((r) => ({ entity: r.entityName, count: r.added.length })) },
      );
    }
    return results;
  }

  deleteObservations(
    entries: { entityName: string; observations: string[] }[],
  ): number {
    const del = this.db.query(
      "DELETE FROM observations WHERE entity_name = $name AND content = $content",
    );
    const touchEntity = this.db.query(
      "UPDATE entities SET updated_at = $ts WHERE name = $name",
    );
    let removed = 0;
    const now = Date.now();
    for (const entry of entries) {
      let entryRemoved = 0;
      for (const obs of entry.observations) {
        const res = del.run({ $name: entry.entityName, $content: obs });
        entryRemoved += Number(res.changes ?? 0);
      }
      if (entryRemoved > 0) {
        touchEntity.run({ $name: entry.entityName, $ts: now });
        removed += entryRemoved;
      }
    }
    if (removed > 0) {
      this.log(
        "delete_observation",
        entries.map((e) => e.entityName).join(", "),
        { count: removed },
      );
    }
    return removed;
  }

  // ── Relation CRUD ────────────────────────────────────────────────────────

  createRelations(
    relations: { from: string; to: string; relationType: string }[],
  ): Relation[] {
    const now = Date.now();
    const created: Relation[] = [];
    const insert = this.db.query(
      "INSERT OR IGNORE INTO relations (from_entity, to_entity, relation_type, created_at) VALUES ($from, $to, $type, $ts)",
    );

    for (const r of relations) {
      // Verify both endpoints exist
      const fromExists = this.db
        .query("SELECT 1 FROM entities WHERE name = $name")
        .get({ $name: r.from });
      const toExists = this.db
        .query("SELECT 1 FROM entities WHERE name = $name")
        .get({ $name: r.to });
      if (!fromExists || !toExists) continue;

      const res = insert.run({
        $from: r.from,
        $to: r.to,
        $type: r.relationType,
        $ts: now,
      });
      if (Number(res.changes ?? 0) > 0) {
        created.push({
          from: r.from,
          to: r.to,
          relationType: r.relationType,
          createdAt: now,
        });
      }
    }
    if (created.length > 0) {
      this.log(
        "create_relation",
        created.map((r) => `${r.from} -[${r.relationType}]-> ${r.to}`).join(", "),
        { count: created.length },
      );
    }
    return created;
  }

  deleteRelations(
    relations: { from: string; to: string; relationType: string }[],
  ): number {
    const del = this.db.query(
      "DELETE FROM relations WHERE from_entity = $from AND to_entity = $to AND relation_type = $type",
    );
    let removed = 0;
    for (const r of relations) {
      const res = del.run({ $from: r.from, $to: r.to, $type: r.relationType });
      removed += Number(res.changes ?? 0);
    }
    if (removed > 0) {
      this.log(
        "delete_relation",
        relations
          .map((r) => `${r.from} -[${r.relationType}]-> ${r.to}`)
          .join(", "),
        { count: removed },
      );
    }
    return removed;
  }

  // ── Read / search ────────────────────────────────────────────────────────

  readGraph(): KnowledgeGraph {
    const entityRows = this.db
      .query("SELECT * FROM entities ORDER BY name")
      .all() as EntityRow[];
    const entities = entityRows.map((r) =>
      rowToEntity(r, this.observationsFor(r.name)),
    );
    const relationRows = this.db
      .query("SELECT * FROM relations ORDER BY id")
      .all() as RelationRow[];
    return { entities, relations: relationRows.map(rowToRelation) };
  }

  searchNodes(query: string, limit = 50): KnowledgeGraph {
    const pattern = `%${query}%`;
    // Find entities matching by name, type, or observation content
    const entityRows = this.db
      .query(
        `SELECT DISTINCT e.* FROM entities e
         LEFT JOIN observations o ON o.entity_name = e.name
         WHERE e.name LIKE $q OR e.entity_type LIKE $q OR o.content LIKE $q
         LIMIT $limit`,
      )
      .all({ $q: pattern, $limit: limit }) as EntityRow[];

    const entities = entityRows.map((r) =>
      rowToEntity(r, this.observationsFor(r.name)),
    );
    const names = new Set(entities.map((e) => e.name));
    return { entities, relations: this.relationsForEntities(names) };
  }

  openNodes(names: string[]): KnowledgeGraph {
    if (names.length === 0) return { entities: [], relations: [] };
    const entities: Entity[] = [];
    for (const name of names) {
      const e = this.loadEntity(name);
      if (e) entities.push(e);
    }
    const nameSet = new Set(entities.map((e) => e.name));
    return { entities, relations: this.relationsForEntities(nameSet) };
  }

  // ── Dashboard helpers ────────────────────────────────────────────────────

  stats(): MemoryStats {
    const entities =
      (this.db.query("SELECT COUNT(*) AS n FROM entities").get() as { n: number })
        .n;
    const relations =
      (
        this.db
          .query("SELECT COUNT(*) AS n FROM relations")
          .get() as { n: number }
      ).n;
    const observations =
      (
        this.db
          .query("SELECT COUNT(*) AS n FROM observations")
          .get() as { n: number }
      ).n;

    const entityTypes = (
      this.db
        .query(
          "SELECT entity_type AS type, COUNT(*) AS count FROM entities GROUP BY entity_type ORDER BY count DESC",
        )
        .all() as { type: string; count: number }[]
    );
    const relationTypes = (
      this.db
        .query(
          "SELECT relation_type AS type, COUNT(*) AS count FROM relations GROUP BY relation_type ORDER BY count DESC",
        )
        .all() as { type: string; count: number }[]
    );

    const recentActivity = this.activity(20);

    return { entities, relations, observations, entityTypes, relationTypes, recentActivity };
  }

  activity(limit = 50, since?: number): MemoryActivity[] {
    if (since != null) {
      const rows = this.db
        .query(
          "SELECT * FROM memory_activity WHERE ts >= $since ORDER BY ts DESC LIMIT $limit",
        )
        .all({ $since: since, $limit: limit }) as ActivityRow[];
      return rows.map(rowToActivity);
    }
    const rows = this.db
      .query("SELECT * FROM memory_activity ORDER BY ts DESC LIMIT $limit")
      .all({ $limit: limit }) as ActivityRow[];
    return rows.map(rowToActivity);
  }

  close(): void {
    this.db.close();
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Open (or create) a SQLite-backed memory store at `path` (`:memory:` for
 * ephemeral). Dynamically imports `bun:sqlite` so this module is safe to
 * reference from Node-loaded code paths that never call it.
 */
export async function openMemoryStore(path: string): Promise<MemoryStore> {
  if (path !== ":memory:") {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      // best-effort; opening the DB will surface a real failure
    }
  }
  const { Database } = await import("bun:sqlite");
  const db = new Database(path, { create: true });
  return new SqliteMemoryStore(db);
}
