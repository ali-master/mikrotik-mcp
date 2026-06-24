/**
 * Config version history — point-in-time snapshots of the dashboard's own
 * configuration, stored on the MCP server's filesystem (one JSON file per
 * version) so a change can be reviewed, diffed, and rolled back from the Config
 * page.
 *
 * Two kinds of version:
 *   • `auto`       — recorded automatically after every successful config apply.
 *   • `checkpoint` — saved manually with a label (e.g. "pre-upgrade").
 *
 * Retention prunes the OLDEST `auto` versions beyond a cap; named checkpoints are
 * never pruned. Pure `node:fs` (no `bun:sqlite`, no device I/O) so it loads in
 * the offline test runner and is trivially unit-testable.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG_HISTORY_DIR } from "../config";

/** How many `auto` versions to keep (named checkpoints are exempt). */
export const AUTO_RETENTION = 50;

export type VersionKind = "auto" | "checkpoint";

/** Metadata for one stored config version (no config body). */
export interface ConfigVersion {
  /** Stable id — the filename stem, `v<ts>`. */
  id: string;
  /** Capture time (epoch ms). */
  ts: number;
  kind: VersionKind;
  /** Optional human label (checkpoints, or a note like "restored from …"). */
  label?: string;
  /** Size of the serialized config body in bytes. */
  bytes: number;
}

/** The on-disk file shape. */
interface VersionFile {
  ts: number;
  kind: VersionKind;
  label?: string;
  config: unknown;
}

/**
 * The history directory, resolved as: `MIKROTIK_CONFIG_HISTORY_DIR` env override
 * → the built-in default. Resilient to the env not being set.
 */
export function historyDir(): string {
  return process.env.MIKROTIK_CONFIG_HISTORY_DIR || DEFAULT_CONFIG_HISTORY_DIR;
}

/** A version id is always `v<digits>` — reject anything else (path-safety). */
function idToFile(id: string): string {
  if (!/^v\d+$/.test(id)) throw new Error(`invalid version id: ${id}`);
  return `${id}.json`;
}

/** List all versions, newest first. */
export function listVersions(): ConfigVersion[] {
  const dir = historyDir();
  if (!existsSync(dir)) return [];
  const out: ConfigVersion[] = [];
  for (const f of readdirSync(dir)) {
    if (!/^v\d+\.json$/.test(f)) continue;
    try {
      const raw = readFileSync(join(dir, f), "utf8");
      const parsed = JSON.parse(raw) as VersionFile;
      out.push({
        id: f.replace(/\.json$/, ""),
        ts: parsed.ts,
        kind: parsed.kind === "checkpoint" ? "checkpoint" : "auto",
        label: parsed.label,
        bytes: Buffer.byteLength(JSON.stringify(parsed.config ?? {}, null, 2), "utf8"),
      });
    } catch {
      /* skip an unreadable/partial file rather than failing the whole list */
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/** Read one version's full config object. Throws if missing or invalid id. */
export function readVersion(id: string): VersionFile {
  const raw = readFileSync(join(historyDir(), idToFile(id)), "utf8");
  return JSON.parse(raw) as VersionFile;
}

/** Delete one version. Returns false if it didn't exist. */
export function deleteVersion(id: string): boolean {
  const p = join(historyDir(), idToFile(id));
  if (!existsSync(p)) return false;
  rmSync(p);
  return true;
}

/**
 * Record a new version of `config`. `now` is injected (no `Date.now()` in the
 * pure layer); on a same-millisecond collision the timestamp is nudged forward
 * so every version gets a unique id. Prunes old `auto` versions afterwards.
 */
export function recordVersion(
  config: unknown,
  kind: VersionKind,
  now: number,
  label?: string,
): ConfigVersion {
  const dir = historyDir();
  mkdirSync(dir, { recursive: true });
  let ts = now;
  while (existsSync(join(dir, `v${ts}.json`))) ts++;
  const body: VersionFile = { ts, kind, label, config };
  writeFileSync(join(dir, `v${ts}.json`), `${JSON.stringify(body, null, 2)}\n`, "utf8");
  pruneAuto(dir);
  return {
    id: `v${ts}`,
    ts,
    kind,
    label,
    bytes: Buffer.byteLength(JSON.stringify(config ?? {}, null, 2), "utf8"),
  };
}

/** Drop the oldest `auto` versions beyond {@link AUTO_RETENTION}; keep checkpoints. */
function pruneAuto(dir: string): void {
  const autos = listVersions().filter((v) => v.kind === "auto");
  if (autos.length <= AUTO_RETENTION) return;
  // listVersions is newest-first; the tail past the cap is the oldest.
  for (const v of autos.slice(AUTO_RETENTION)) {
    try {
      rmSync(join(dir, `${v.id}.json`));
    } catch {
      /* already gone */
    }
  }
}

/** True when no versions exist yet (used to seed an initial baseline). */
export function isEmpty(): boolean {
  const dir = historyDir();
  if (!existsSync(dir)) return true;
  return !readdirSync(dir).some((f) => /^v\d+\.json$/.test(f));
}

/** Total bytes the history occupies on disk (for a storage hint in the UI). */
export function historyBytes(): number {
  const dir = historyDir();
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const f of readdirSync(dir)) {
    if (!/^v\d+\.json$/.test(f)) continue;
    try {
      total += statSync(join(dir, f)).size;
    } catch {
      /* skip */
    }
  }
  return total;
}
