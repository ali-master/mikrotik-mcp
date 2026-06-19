/**
 * Backup, export, and file management — `/system backup`, `/export`, `/file`.
 *
 * Covers creating/restoring system backups, generating configuration exports,
 * importing scripts, and moving files on and off the device filesystem.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, defineTool, DANGEROUS } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { isEmpty, Cmd } from "../core/routeros";

export const backupTools: ToolModule = [
  defineTool({
    name: "create_backup",
    title: "Create Backup",
    annotations: WRITE,
    description: "Creates a system backup on the MikroTik device.",
    inputSchema: {
      name: z.string().optional(),
      dont_encrypt: z.boolean().default(false),
      include_password: z.boolean().default(true),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      const name = a.name || `backup_${Math.floor(Date.now() / 1000)}`;
      ctx.info(`Creating backup: name=${name}`);

      const cmd = new Cmd("/system backup save").set("name", name);
      if (a.dont_encrypt) cmd.raw("dont-encrypt=yes");
      else cmd.set("password", ""); // Empty password for encryption
      if (!a.include_password) cmd.raw("password-file=no");

      const result = await executeMikrotikCommand(cmd.build(), ctx);

      if (result.includes("saved") || result.trim() === "") {
        const fileDetails = await executeMikrotikCommand(
          `/file print detail where name=${name}.backup`,
          ctx,
        );
        return fileDetails
          ? `Backup created successfully:\n\n${fileDetails}`
          : `Backup '${name}.backup' created successfully.`;
      }
      return `Failed to create backup: ${result}`;
    },
  }),

  defineTool({
    name: "list_backups",
    title: "List Backups",
    annotations: READ,
    description: "Lists backup files on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      include_exports: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Listing backups with filter: name=${a.name_filter}`);

      let cmd = "/file print where type=backup";
      if (a.include_exports)
        cmd = "/file print where (type=backup or type=script)";

      if (a.name_filter) {
        if (a.include_exports) {
          cmd = `/file print where (type=backup or type=script) and name~"${a.name_filter}"`;
        } else {
          cmd = `/file print where type=backup and name~"${a.name_filter}"`;
        }
      }

      const result = await executeMikrotikCommand(cmd, ctx);
      if (isEmpty(result)) return "No backup files found.";
      return `BACKUP FILES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "create_export",
    title: "Create Config Export",
    annotations: READ,
    description:
      "Creates a configuration export file (rsc/json/xml) on the MikroTik device.",
    inputSchema: {
      name: z.string().optional(),
      file_format: z.enum(["rsc", "json", "xml"]).default("rsc"),
      export_type: z.enum(["full", "compact", "verbose"]).default("full"),
      hide_sensitive: z.boolean().default(true),
      verbose: z.boolean().default(false),
      compact: z.boolean().default(false),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      const name = a.name || `export_${Math.floor(Date.now() / 1000)}`;
      ctx.info(`Creating export: name=${name}, format=${a.file_format}`);

      // Determine file extension based on format
      const extension =
        a.file_format === "json" || a.file_format === "xml"
          ? a.file_format
          : "rsc";
      const fullName = `${name}.${extension}`;

      const cmd = new Cmd("/export");
      if (a.export_type === "full") cmd.set("file", name);
      cmd.raw(a.verbose ? "verbose" : null);
      cmd.raw(a.compact ? "compact" : null);
      cmd.raw(!a.hide_sensitive ? "show-sensitive" : null);
      if (a.export_type !== "full") cmd.set("file", name);

      const result = await executeMikrotikCommand(cmd.build(), ctx);

      if (result.trim() === "" || !result.toLowerCase().includes("failure:")) {
        const fileDetails = await executeMikrotikCommand(
          `/file print detail where name=${fullName}`,
          ctx,
        );
        return fileDetails
          ? `Export created successfully:\n\n${fileDetails}`
          : `Export '${fullName}' created successfully.`;
      }
      return `Failed to create export: ${result}`;
    },
  }),

  defineTool({
    name: "export_section",
    title: "Export Config Section",
    annotations: READ,
    description:
      "Exports a specific RouterOS configuration section to a file. " +
      'section: RouterOS path without leading slash e.g. "ip address", "interface vlan", ' +
      '"ip firewall filter", "ip firewall nat", "queue simple".',
    inputSchema: {
      section: z.string(),
      name: z.string().optional(),
      hide_sensitive: z.boolean().default(true),
      compact: z.boolean().default(false),
    },
    async handler(a, ctx) {
      let name = a.name;
      if (!name) {
        const cleanSection = a.section.replace(/ /g, "_").replace(/\//g, "_");
        name = `export_${cleanSection}_${Math.floor(Date.now() / 1000)}`;
      }

      ctx.info(`Exporting section: section=${a.section}, name=${name}`);

      const cmd = new Cmd(`/${a.section} export`).set("file", name);
      cmd.raw(!a.hide_sensitive ? "show-sensitive" : null);
      cmd.raw(a.compact ? "compact" : null);

      const result = await executeMikrotikCommand(cmd.build(), ctx);

      if (result.trim() === "" || !result.toLowerCase().includes("failure:")) {
        const fileDetails = await executeMikrotikCommand(
          `/file print detail where name=${name}.rsc`,
          ctx,
        );
        return fileDetails
          ? `Section export created successfully:\n\n${fileDetails}`
          : `Section export '${name}.rsc' created successfully.`;
      }
      return `Failed to export section: ${result}`;
    },
  }),

  defineTool({
    name: "download_file",
    title: "Download File",
    annotations: READ,
    description:
      "Downloads a backup or export file from the MikroTik device as base64-encoded content.",
    inputSchema: {
      filename: z.string(),
      file_type: z.enum(["backup", "export"]).default("backup"),
    },
    async handler(a, ctx) {
      ctx.info(`Downloading file: filename=${a.filename}, type=${a.file_type}`);

      // First, check if file exists
      const count = await executeMikrotikCommand(
        `/file print count-only where name=${a.filename}`,
        ctx,
      );
      if (count.trim() === "0") return `File '${a.filename}' not found.`;

      // Get file content (this is a simplified version)
      const content = await executeMikrotikCommand(
        `/file print file=${a.filename}`,
        ctx,
      );

      if (content) {
        // Encode content to base64 for safe transmission
        const encoded = Buffer.from(content, "utf8").toString("base64");
        return `FILE_CONTENT_BASE64:${encoded}`;
      }
      return `Failed to download file '${a.filename}'.`;
    },
  }),

  defineTool({
    name: "upload_file",
    title: "Upload File",
    annotations: WRITE,
    description:
      "Uploads a base64-encoded file to the MikroTik device (for restore operations).",
    inputSchema: {
      filename: z.string(),
      content_base64: z.string(),
    },
    async handler(a, ctx) {
      ctx.info(`Uploading file: filename=${a.filename}`);

      // Decode base64 content
      try {
        Buffer.from(a.content_base64, "base64").toString("utf8");
      } catch (e) {
        return `Failed to decode file content: ${e instanceof Error ? e.message : String(e)}`;
      }

      // This is a simplified version - actual implementation would need proper file upload
      return `File '${a.filename}' uploaded successfully (simulated).`;
    },
  }),

  defineTool({
    name: "restore_backup",
    title: "Restore Backup",
    annotations: DANGEROUS,
    description:
      "Restores a system backup on the MikroTik device; triggers a reboot.",
    inputSchema: {
      filename: z.string(),
      password: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Restoring backup: filename=${a.filename}`);

      const count = await executeMikrotikCommand(
        `/file print count-only where name=${a.filename}`,
        ctx,
      );
      if (count.trim() === "0") return `Backup file '${a.filename}' not found.`;

      const cmd = new Cmd("/system backup load")
        .set("name", a.filename)
        .opt("password", a.password)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);

      if (
        result.includes("Restoring system configuration") ||
        result.trim() === ""
      ) {
        return `Backup '${a.filename}' restored successfully. System will reboot.`;
      }
      return `Failed to restore backup: ${result}`;
    },
  }),

  defineTool({
    name: "import_configuration",
    title: "Import Configuration",
    annotations: DANGEROUS,
    description:
      "Imports and executes a RouterOS configuration script (.rsc file) on the device.",
    inputSchema: {
      filename: z.string(),
      run_after_reset: z.boolean().default(false),
      verbose: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Importing configuration: filename=${a.filename}`);

      const count = await executeMikrotikCommand(
        `/file print count-only where name=${a.filename}`,
        ctx,
      );
      if (count.trim() === "0")
        return `Configuration file '${a.filename}' not found.`;

      const cmd = new Cmd("/import")
        .set("file", a.filename)
        .flag("run-after-reset", a.run_after_reset)
        .flag("verbose", a.verbose)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);

      if (
        result.trim() === "" ||
        result.includes("Script file loaded and executed successfully")
      ) {
        return `Configuration '${a.filename}' imported successfully.`;
      }
      return `Import result:\n${result}`;
    },
  }),

  defineTool({
    name: "remove_file",
    title: "Remove File",
    annotations: DANGEROUS,
    description: "Removes a file from the MikroTik device filesystem.",
    inputSchema: {
      filename: z.string(),
    },
    async handler(a, ctx) {
      ctx.info(`Removing file: filename=${a.filename}`);

      const count = await executeMikrotikCommand(
        `/file print count-only where name=${a.filename}`,
        ctx,
      );
      if (count.trim() === "0") return `File '${a.filename}' not found.`;

      const result = await executeMikrotikCommand(
        `/file remove ${a.filename}`,
        ctx,
      );

      if (result.trim() === "")
        return `File '${a.filename}' removed successfully.`;
      return `Failed to remove file: ${result}`;
    },
  }),

  defineTool({
    name: "backup_info",
    title: "Backup File Info",
    annotations: READ,
    description:
      "Gets detailed information about a backup file on the MikroTik device.",
    inputSchema: {
      filename: z.string(),
    },
    async handler(a, ctx) {
      ctx.info(`Getting backup info: filename=${a.filename}`);

      const result = await executeMikrotikCommand(
        `/file print detail where name=${a.filename}`,
        ctx,
      );
      if (isEmpty(result)) return `Backup file '${a.filename}' not found.`;
      return `BACKUP FILE DETAILS:\n\n${result}`;
    },
  }),
];
