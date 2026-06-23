/**
 * Safe-apply state machine for the dashboard's Config Studio.
 *
 * Saving a config is risky: one bad device entry or a typo in the dashboard's
 * own bind address can lock you out with the server none the wiser. So writes go
 * through a RouterOS-Safe-Mode-style ritual: back up the current file, write the
 * new one, hot-swap the in-memory config, and **arm a rollback timer**. The
 * dashboard must confirm ("keep") within `rollbackMs`; if it doesn't — because
 * you locked yourself out, or the browser lost the server — the timer fires and
 * everything reverts to the backup.
 *
 * All I/O (filesystem, clock, timers, the runtime config) is injected, so the
 * machine is unit-tested with fakes — no real files, no real `setTimeout`.
 */
import { MikrotikConfigSchema } from "../config";
import type { ConfigSource, MikrotikConfig } from "../config";
import { backupName, serializeConfig } from "../config-write";

/** A single validation problem, addressed by its dotted JSON path. */
export interface ConfigIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ConfigIssue[];
  /** The parsed, default-applied config when `ok`. */
  value?: MikrotikConfig;
}

/**
 * Validate an arbitrary object against the authoritative Zod config schema,
 * flattening any issues to `{ path, message }`. This is the SAME schema
 * `loadConfig` uses, so the editor can never accept something the server would
 * later reject.
 */
export function validateConfig(raw: unknown): ValidationResult {
  const r = MikrotikConfigSchema.safeParse(raw);
  if (r.success) return { ok: true, errors: [], value: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => ({
      path: i.path.join(".") || "(root)",
      message: i.message,
    })),
  };
}

/** Injected side-effecting dependencies (real ones in prod, fakes in tests). */
export interface AdminDeps {
  getConfig: () => MikrotikConfig;
  setConfig: (c: MikrotikConfig) => void;
  source: () => ConfigSource;
  /** Read a file's text, or null when it doesn't exist / can't be read. */
  readFile: (path: string) => string | null;
  /** Persist text to a path (atomically in prod). */
  writeText: (path: string, text: string) => void;
  now: () => number;
  /** Schedule `fn` after `ms`; returns an opaque handle for {@link AdminDeps.cancel}. */
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
}

export interface ApplyResult {
  pendingId: string;
  rollbackMs: number;
  path: string;
  fromFile: boolean;
}

interface Pending {
  id: string;
  backupPath: string;
  /** In-memory config to restore on rollback. */
  previous: MikrotikConfig;
  timer: unknown;
}

export interface ConfigAdmin {
  /** Back up, write `parsed`, hot-swap, and arm rollback (0 ⇒ no timer). */
  applyConfig: (parsed: MikrotikConfig, rollbackMs: number) => ApplyResult;
  /** Confirm a pending apply, cancelling its rollback timer. */
  keepConfig: (id: string) => boolean;
  /** Revert a pending apply to its backup now. Also fired automatically on timeout. */
  rollback: (id: string) => boolean;
  pendingId: () => string | null;
}

/** Build a config-admin bound to the given dependencies. */
export function createConfigAdmin(deps: AdminDeps): ConfigAdmin {
  let pending: Pending | null = null;

  const rollback = (id: string): boolean => {
    if (!pending || pending.id !== id) return false;
    const { backupPath, previous, timer } = pending;
    deps.cancel(timer);
    pending = null;
    const backup = deps.readFile(backupPath);
    if (backup != null) deps.writeText(deps.source().path, backup);
    deps.setConfig(previous);
    return true;
  };

  const applyConfig = (parsed: MikrotikConfig, rollbackMs: number): ApplyResult => {
    // A new apply supersedes any still-pending one (its timer is dropped; its
    // already-written file stands as the new baseline).
    if (pending) deps.cancel(pending.timer);

    const src = deps.source();
    const previous = deps.getConfig();
    const ts = deps.now();
    const id = `cfg_${ts}`;

    // Back up whatever is on disk now (or the serialized in-memory config when
    // no file exists yet), then write the new config and hot-swap it live.
    const backupPath = backupName(src.path, ts);
    const existing = deps.readFile(src.path) ?? serializeConfig(previous);
    deps.writeText(backupPath, existing);
    deps.writeText(src.path, serializeConfig(parsed));
    deps.setConfig(parsed);

    const timer = rollbackMs > 0 ? deps.schedule(() => void rollback(id), rollbackMs) : null;
    pending = { id, backupPath, previous, timer };
    return { pendingId: id, rollbackMs, path: src.path, fromFile: src.fromFile };
  };

  const keepConfig = (id: string): boolean => {
    if (!pending || pending.id !== id) return false;
    deps.cancel(pending.timer);
    pending = null;
    return true;
  };

  return { applyConfig, keepConfig, rollback, pendingId: () => pending?.id ?? null };
}
