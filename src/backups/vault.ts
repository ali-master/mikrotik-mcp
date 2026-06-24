/**
 * Local backup vault — config backups stored on the MCP server's OWN filesystem
 * (not on the device, not in S3). Each backup is one `/export` `.rsc` text file
 * named `<device>_<datestamp>.rsc`, captured over SSH/MAC-Telnet. The vault is
 * managed by the `*_local_backup` tools and the observability dashboard, and a
 * backup is restored by replaying its export through Safe Mode.
 *
 * Pure `node:fs` (no `bun:sqlite`, no device I/O here), so it loads cleanly in
 * the offline test runner and is trivially unit-testable.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { DEFAULT_BACKUP_DIR } from "../config";
import { getConfig } from "../core/runtime";

/** One backup file in the vault. */
export interface BackupFile {
  /** File name within the vault (e.g. `edge_2026-06-25_1430.rsc`). */
  name: string;
  /** Size of the export body in bytes. */
  bytes: number;
  /** Last-modified time (epoch ms). */
  modified: number;
  /** Device name parsed from the `<device>_…` filename prefix, when present. */
  device?: string;
}

/**
 * The vault directory, resolved as: `MIKROTIK_BACKUP_DIR` env override →
 * `config.backupDir` (dashboard-editable, persisted) → the built-in default.
 * Resilient to the config not being loaded (e.g. in unit tests).
 */
export function backupDir(): string {
  if (process.env.MIKROTIK_BACKUP_DIR) return process.env.MIKROTIK_BACKUP_DIR;
  try {
    const dir = getConfig().backupDir;
    if (dir) return dir;
  } catch {
    /* config not loaded — fall through to the default */
  }
  return DEFAULT_BACKUP_DIR;
}

/**
 * Validate a backup filename, rejecting path traversal — only a plain name made
 * of `[A-Za-z0-9._-]` is allowed, so a name can never escape the vault directory.
 */
export function safeName(name: string): string {
  const base = basename(name);
  // Reject anything that isn't already a plain in-vault filename: a name whose
  // basename differs from itself carried a path separator (`a/b`, `/abs`,
  // `x/../y`), and `.`/`..`/odd characters are never valid backup names. We do
  // NOT silently normalize traversal to its basename — that would surprise the
  // caller by operating on a different file than the one requested.
  if (base !== name || base === "." || base === ".." || !/^[A-Za-z0-9._-]+$/.test(base)) {
    throw new Error(`invalid backup name: ${name}`);
  }
  return base;
}

/** List vault backups, newest first. */
export function listBackups(): BackupFile[] {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".rsc"))
    .map((f) => {
      const st = statSync(join(dir, f));
      const us = f.indexOf("_");
      return {
        name: f,
        bytes: st.size,
        modified: st.mtimeMs,
        device: us > 0 ? f.slice(0, us) : undefined,
      };
    })
    .sort((a, b) => b.modified - a.modified);
}

/** Read a backup's `/export` body. Throws if the name is invalid or missing. */
export function readBackup(name: string): string {
  return readFileSync(join(backupDir(), safeName(name)), "utf8");
}

/** True when a backup with this (validated) name exists. */
export function backupExists(name: string): boolean {
  try {
    return existsSync(join(backupDir(), safeName(name)));
  } catch {
    return false;
  }
}

/**
 * Write `content` under `name` (creating the vault dir if needed). If the name
 * is taken, a numeric suffix is appended so an existing backup is never
 * clobbered. Returns the final filename written.
 */
export function writeBackup(name: string, content: string): string {
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  let final = safeName(name);
  if (existsSync(join(dir, final))) {
    const dot = final.lastIndexOf(".");
    const stem = dot > 0 ? final.slice(0, dot) : final;
    const ext = dot > 0 ? final.slice(dot) : "";
    let n = 2;
    while (existsSync(join(dir, `${stem}_${n}${ext}`))) n++;
    final = `${stem}_${n}${ext}`;
  }
  writeFileSync(join(dir, final), content, "utf8");
  return final;
}

/** Delete a backup. Returns false if it didn't exist. */
export function deleteBackup(name: string): boolean {
  const p = join(backupDir(), safeName(name));
  if (!existsSync(p)) return false;
  rmSync(p);
  return true;
}

/** Rename a backup (forcing an `.rsc` extension). Returns the new filename. */
export function renameBackup(oldName: string, newName: string): string {
  const dir = backupDir();
  const from = join(dir, safeName(oldName));
  let to = safeName(newName);
  if (!to.endsWith(".rsc")) to += ".rsc";
  const toPath = join(dir, to);
  if (!existsSync(from)) throw new Error(`backup not found: ${oldName}`);
  if (existsSync(toPath)) throw new Error(`a backup named '${to}' already exists`);
  renameSync(from, toPath);
  return to;
}

/**
 * Turn a RouterOS `/export` dump into the list of executable commands that
 * recreate it — section paths (lines starting with `/`) are prefixed onto each
 * following item line, backslash line-continuations are joined, and comment /
 * blank lines are dropped. Used by restore to replay an export over the command
 * channel (no on-device file needed).
 */
export function exportToCommands(text: string): string[] {
  // 1) Join backslash line-continuations into single logical lines.
  const lines: string[] = [];
  let buf = "";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    buf = buf ? `${buf} ${line.trim()}` : line;
    if (buf.trimEnd().endsWith("\\")) {
      // Drop the trailing `\` and any space before it so the next line joins
      // with exactly one separating space.
      buf = buf.trimEnd().slice(0, -1).trimEnd();
      continue;
    }
    lines.push(buf);
    buf = "";
  }
  if (buf) lines.push(buf);

  // 2) Prefix each item line with its current section path.
  const cmds: string[] = [];
  let section = "";
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue; // blank / comment / header
    if (t.startsWith("/")) {
      section = t; // section path, e.g. `/ip firewall filter`
      continue;
    }
    cmds.push(section ? `${section} ${t}` : t);
  }
  return cmds;
}
