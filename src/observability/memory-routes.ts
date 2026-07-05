/**
 * Dashboard sub-router for the Knowledge Graph Memory view.
 *
 * Lazily opens a {@link MemoryStore} on first request (same pattern as the
 * snapshot store), and re-opens it when the dashboard changes the DB path at
 * runtime. Returns `null` for non-memory paths so the caller can chain the
 * next sub-router.
 */
import { getConfig, setConfig } from "../core/runtime";
import { getConfigSource } from "../config";
import { atomicWrite, serializeConfig } from "../config-write";
import { openMemoryStore } from "../memory/store";
import type { MemoryStore } from "../memory/store";
import { resetMemoryStore } from "../tools/memory";

// ── Lazy store ───────────────────────────────────────────────────────────────

let storePromise: Promise<MemoryStore> | null = null;

function getStore(): Promise<MemoryStore> {
  if (!storePromise) {
    const cfg = getConfig();
    storePromise = openMemoryStore(cfg.memory.dbPath);
  }
  return storePromise;
}

/** Close the memory store (called on dashboard shutdown). */
export function closeMemoryStore(): void {
  if (storePromise) {
    storePromise.then((s) => s.close()).catch(() => {});
    storePromise = null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function bodyJson<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function memoryRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const p = url.pathname;
  if (!p.startsWith("/api/memory")) return null;

  const cfg = getConfig();
  if (!cfg.memory.enabled) {
    return json({ error: "Knowledge-graph memory is disabled" }, 503);
  }

  // ── Config endpoints (no store required) ─────────────────────────────────

  if (p === "/api/memory/config" && req.method === "GET") {
    let stats = null;
    try {
      const store = await getStore();
      stats = store.stats();
    } catch {
      // store may not be openable yet
    }
    return json({
      enabled: cfg.memory.enabled,
      dbPath: cfg.memory.dbPath,
      stats,
    });
  }

  if (p === "/api/memory/config" && req.method === "POST") {
    const body = await bodyJson<{ dbPath?: string; enabled?: boolean }>(req);
    const updates: Record<string, unknown> = {};

    if (body.dbPath !== undefined && typeof body.dbPath === "string" && body.dbPath !== cfg.memory.dbPath) {
      // Close current stores
      closeMemoryStore();
      resetMemoryStore();

      updates.dbPath = body.dbPath;

      // Open at new path to verify it works
      storePromise = openMemoryStore(body.dbPath);
      try {
        await storePromise;
      } catch (e) {
        storePromise = null;
        return json(
          { error: `Failed to open memory DB at ${body.dbPath}: ${e instanceof Error ? e.message : String(e)}` },
          400,
        );
      }
    }

    if (body.enabled !== undefined && typeof body.enabled === "boolean") {
      updates.enabled = body.enabled;
    }

    if (Object.keys(updates).length > 0) {
      const newMemory = { ...cfg.memory, ...updates };
      const newCfg = { ...cfg, memory: newMemory };
      setConfig(newCfg);

      // Persist to config file
      const src = getConfigSource();
      try {
        atomicWrite(src.path, serializeConfig(newCfg));
      } catch {
        // best-effort persistence
      }
    }

    let stats = null;
    try {
      const store = await getStore();
      stats = store.stats();
    } catch {
      // may fail if disabled
    }

    return json({
      ok: true,
      enabled: getConfig().memory.enabled,
      dbPath: getConfig().memory.dbPath,
      stats,
    });
  }

  // ── All remaining endpoints require the store ────────────────────────────

  const store = await getStore();

  // ── Read endpoints ───────────────────────────────────────────────────────

  if (p === "/api/memory/graph" && req.method === "GET") {
    return json(store.readGraph());
  }

  if (p === "/api/memory/stats" && req.method === "GET") {
    return json(store.stats());
  }

  if (p === "/api/memory/search" && req.method === "GET") {
    const q = url.searchParams.get("q") || "";
    const limit = Number(url.searchParams.get("limit") ?? 50);
    return json(store.searchNodes(q, limit));
  }

  if (p === "/api/memory/activity" && req.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const since = url.searchParams.get("since");
    return json(store.activity(limit, since ? Number(since) : undefined));
  }

  // Single entity by name
  const entityMatch = p.match(/^\/api\/memory\/entity\/(.+)$/);
  if (entityMatch && req.method === "GET") {
    const name = decodeURIComponent(entityMatch[1]);
    const graph = store.openNodes([name]);
    if (graph.entities.length === 0) return json({ error: "Entity not found" }, 404);
    return json({ entity: graph.entities[0], relations: graph.relations });
  }

  // ── Write endpoints ──────────────────────────────────────────────────────

  if (p === "/api/memory/entities" && req.method === "POST") {
    const body = await bodyJson<{
      entities: { name: string; entityType: string; observations?: string[] }[];
    }>(req);
    const created = store.createEntities(body.entities ?? []);
    return json({ created, count: created.length });
  }

  if (p === "/api/memory/relations" && req.method === "POST") {
    const body = await bodyJson<{
      relations: { from: string; to: string; relationType: string }[];
    }>(req);
    const created = store.createRelations(body.relations ?? []);
    return json({ created, count: created.length });
  }

  if (p === "/api/memory/observations" && req.method === "POST") {
    const body = await bodyJson<{
      observations: { entityName: string; contents: string[] }[];
    }>(req);
    const results = store.addObservations(body.observations ?? []);
    return json({ results });
  }

  // ── Delete endpoints ─────────────────────────────────────────────────────

  if (p === "/api/memory/entities" && req.method === "DELETE") {
    const body = await bodyJson<{ names: string[] }>(req);
    const removed = store.deleteEntities(body.names ?? []);
    return json({ removed });
  }

  if (p === "/api/memory/relations" && req.method === "DELETE") {
    const body = await bodyJson<{
      relations: { from: string; to: string; relationType: string }[];
    }>(req);
    const removed = store.deleteRelations(body.relations ?? []);
    return json({ removed });
  }

  if (p === "/api/memory/observations" && req.method === "DELETE") {
    const body = await bodyJson<{
      deletions: { entityName: string; observations: string[] }[];
    }>(req);
    const removed = store.deleteObservations(body.deletions ?? []);
    return json({ removed });
  }

  return null;
}
