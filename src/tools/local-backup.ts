/**
 * Local backup vault tools — create, list, read, rename, delete and restore
 * config backups stored on the MCP server's OWN filesystem (see
 * `src/backups/vault.ts`). These are plain-text `/export` `.rsc` files, distinct
 * from the device-side binary backups (`backup.ts`), the local SQLite snapshot
 * store (`config-snapshot.ts`), and the S3 objects (`s3-backup.ts`). The same
 * vault is managed by the observability dashboard's Backups page.
 */
import { z } from "zod";
import {
  DANGEROUS,
  DESTRUCTIVE,
  READ,
  WRITE,
  WRITE_IDEMPOTENT,
  defineTool,
} from "../core/registry";
import type { ToolModule } from "../core/registry";
import { resolveDeviceName } from "../core/runtime";
import { createLocalBackup } from "../backups/create";
import { restoreLocalBackup } from "../backups/restore";
import { backupDir, deleteBackup, listBackups, readBackup, renameBackup } from "../backups/vault";

export const localBackupTools: ToolModule = [
  defineTool({
    name: "create_local_backup",
    title: "Create Local Config Backup (host vault)",
    annotations: WRITE,
    description:
      "Captures the device's full configuration with `/export` and saves it as a timestamped " +
      "plain-text `.rsc` file in the MCP server's LOCAL backup vault (default " +
      "`~/.mikrotik-mcp/backups/`, override with the `MIKROTIK_BACKUP_DIR` env var) — NOT on the " +
      "device and NOT in S3. The filename is `<device-slug>_<date_time>.rsc` — the device name is " +
      "slugified (spaces/underscores/etc → dash) — stamped in the device's local clock (24-hour; " +
      "Jalali for the Tehran timezone, Gregorian otherwise). This is a host-side, human-readable, " +
      "diffable copy you can restore later with restore_local_backup. Compare: create_backup makes " +
      "a binary `/system backup` file ON the device; capture_config_snapshot stores an export in " +
      "the local snapshot database; upload_backup_to_s3 pushes to S3. ALWAYS default to a FULL " +
      "backup of the complete configuration: call this with no option flags (the bare `/export`) " +
      "unless the user explicitly asks for less or more. Narrow it ONLY on request — set compact to " +
      "drop default values, or use export_section for a single subsection. Broaden it ONLY on " +
      "request — set verbose to include every parameter (even defaults), show_sensitive to include " +
      "secrets (keys/passwords), or use create_backup for a binary full-system snapshot. terse just " +
      "changes the text to one machine-readable line per item. Returns the saved filename, byte size " +
      "and vault path.",
    inputSchema: {
      label: z
        .string()
        .optional()
        .describe('Optional label appended to the filename, e.g. "pre-upgrade".'),
      show_sensitive: z
        .boolean()
        .default(false)
        .describe("Include secrets (keys/passwords) in the export. Default false."),
      verbose: z
        .boolean()
        .default(false)
        .describe("Include every parameter, even defaults (RouterOS `verbose`)."),
      compact: z
        .boolean()
        .default(false)
        .describe("Export only non-default values (RouterOS `compact`; ignored if verbose)."),
      terse: z
        .boolean()
        .default(false)
        .describe("One self-contained, machine-readable line per item (RouterOS `terse`)."),
    },
    async handler(a, ctx) {
      const r = await createLocalBackup(ctx, {
        label: a.label,
        showSensitive: a.show_sensitive,
        verbose: a.verbose,
        compact: a.compact,
        terse: a.terse,
      });
      if (!r.ok) return `Failed to capture export for a local backup: ${r.error}`;
      return (
        `Saved local backup '${r.name}' (${r.bytes} bytes) for device '${r.device}' to ` +
        `${backupDir()}. Restore it with restore_local_backup name=${r.name}.`
      );
    },
  }),

  defineTool({
    name: "list_local_backups",
    title: "List Local Config Backups (host vault)",
    annotations: READ,
    description:
      "Lists the `/export` config backups stored in the MCP server's LOCAL backup vault " +
      "(`~/.mikrotik-mcp/backups/` or `MIKROTIK_BACKUP_DIR`) — each with its filename, source " +
      "device, byte size and capture time, newest first. These are host-side text backups created " +
      "by create_local_backup, distinct from list_backups (binary `.backup` files ON the device) " +
      "and list_s3_backups (objects in an S3 bucket). Use a returned filename with " +
      "get_local_backup, restore_local_backup, rename_local_backup or delete_local_backup.",
    inputSchema: {},
    handler(_a, ctx) {
      ctx.info("Listing local backup vault");
      const items = listBackups();
      if (items.length === 0) {
        return `No local backups found in ${backupDir()}. Create one with create_local_backup.`;
      }
      const lines = items.map(
        (b) =>
          `${b.name}  (${b.bytes} bytes, ${b.device ?? "?"}, ${new Date(b.modified).toISOString()})`,
      );
      return `LOCAL BACKUPS (${backupDir()}):\n\n${lines.join("\n")}`;
    },
  }),

  defineTool({
    name: "get_local_backup",
    title: "Get Local Config Backup Contents (host vault)",
    annotations: READ,
    description:
      "Returns the full `/export` `.rsc` text of one backup in the MCP server's LOCAL vault, by " +
      "filename (get the name from list_local_backups). This is the exact configuration script that " +
      "restore_local_backup would replay onto a device — useful for reviewing or diffing a saved " +
      "config before restoring. Returns a 'not found' message if the filename doesn't exist. " +
      "`name` is the exact filename from list_local_backups.",
    inputSchema: {
      name: z.string().describe("Backup filename, e.g. 'edge_2026-06-25_1430.rsc'."),
    },
    handler(a, ctx) {
      ctx.info(`Reading local backup: ${a.name}`);
      try {
        return `LOCAL BACKUP '${a.name}':\n\n${readBackup(a.name)}`;
      } catch {
        return `Local backup '${a.name}' not found in ${backupDir()}.`;
      }
    },
  }),

  defineTool({
    name: "rename_local_backup",
    title: "Rename Local Config Backup (host vault)",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Renames a backup file in the MCP server's LOCAL vault (e.g. to label it 'pre-upgrade' or " +
      "'golden'). Forces an `.rsc` extension and refuses if the target name already exists. " +
      "Host-side only — it does NOT touch the device or S3. `name` is the current filename (from " +
      "list_local_backups); `new_name` is the desired filename. Returns the new filename.",
    inputSchema: {
      name: z.string().describe("Current backup filename."),
      new_name: z.string().describe("Desired filename (an `.rsc` suffix is added if missing)."),
    },
    handler(a, ctx) {
      ctx.info(`Renaming local backup: ${a.name} -> ${a.new_name}`);
      try {
        return `Renamed local backup to '${renameBackup(a.name, a.new_name)}'.`;
      } catch (e) {
        return `Failed to rename local backup: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  defineTool({
    name: "delete_local_backup",
    title: "Delete Local Config Backup (host vault)",
    annotations: DESTRUCTIVE,
    description:
      "Permanently deletes one backup file from the MCP server's LOCAL vault by filename. This " +
      "removes only the host-side copy — it does NOT touch the device's configuration, its " +
      "on-device `.backup` files, or any S3 object. Use list_local_backups to find the name; for " +
      "deleting an S3 object use delete_s3_backup instead. Returns a 'not found' message if the " +
      "filename doesn't exist.",
    inputSchema: {
      name: z.string().describe("Backup filename to delete."),
    },
    handler(a, ctx) {
      ctx.info(`Deleting local backup: ${a.name}`);
      try {
        return deleteBackup(a.name)
          ? `Deleted local backup '${a.name}'.`
          : `Local backup '${a.name}' not found in ${backupDir()}.`;
      } catch (e) {
        return `Failed to delete local backup: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  defineTool({
    name: "restore_local_backup",
    title: "Restore Local Config Backup to Device (Safe Mode)",
    annotations: DANGEROUS,
    description:
      "Replays a LOCAL vault backup's `/export` configuration onto a device INSIDE RouterOS Safe " +
      "Mode — every command is held in memory and AUTO-REVERTS if the SSH session drops, so a " +
      "change that would lock you out is undone instead of sticking. With confirm=false (default) " +
      "it applies the whole config, then rolls it all back — a true dry-run that proves the restore " +
      "runs cleanly. With confirm=true it commits, but ONLY after verifying the device still " +
      "answers. Because a `/export` is additive, restoring onto an already-configured device LAYERS " +
      "the saved config on top (duplicate rules are possible) — it is cleanest on a freshly " +
      "reset device. Requires SSH (Safe Mode is not available on MAC-Telnet devices). Alternatives: " +
      "import_configuration runs a `.rsc` already ON the device; restore_backup loads a binary " +
      "`.backup` (and reboots). `name` is the filename from list_local_backups.",
    inputSchema: {
      name: z.string().describe("Backup filename to restore (from list_local_backups)."),
      confirm: z
        .boolean()
        .default(false)
        .describe("false = apply, then roll back (dry-run). true = commit if still reachable."),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`Restoring local backup '${a.name}' to '${device}' (confirm=${a.confirm})`);
      const r = await restoreLocalBackup(device, a.name, a.confirm);
      const head = `RESTORE '${a.name}' → ${device}`;
      if (!r.ok) return `${head} FAILED: ${r.message}`;
      return r.committed
        ? `${head}: COMMITTED — the saved configuration is now live. ${r.message}`
        : `${head}: DRY-RUN — applied ${r.applied} command(s) then rolled everything back. ` +
            `Re-run with confirm=true to commit.`;
    },
  }),
];
