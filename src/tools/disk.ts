/** Storage / disk management — `/disk`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { READ, defineTool, DANGEROUS } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { quoteValue, looksLikeError, isEmpty, commandUnsupported, Cmd } from "../core/routeros";

export const diskTools: ToolModule = [
  defineTool({
    name: "list_disks",
    title: "List All Attached Disks",
    annotations: READ,
    description:
      "List all storage disks (`/disk print`) attached to the MikroTik device — USB drives, NVMe, and internal flash. " +
      "Use this to discover available storage and obtain disk names before calling get_disk or format_disk. " +
      "Returns each disk's name, type, size, and status. " +
      "For per-disk detail use get_disk.",
    async handler(_a, ctx) {
      ctx.info("Listing disks");
      const result = await executeMikrotikCommand("/disk print", ctx);
      if (commandUnsupported(result)) return "Disk management is not available on this device.";
      return isEmpty(result) ? "No disks found." : `DISKS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_disk",
    title: "Get Disk Details",
    annotations: READ,
    description:
      "Get detailed information about a single disk (`/disk print detail where name=...`). " +
      "Use this to inspect a specific disk's filesystem type, free space, mount status, and other properties. " +
      "The `name` argument takes a disk name (e.g. `disk1`) as returned by list_disks. " +
      "For all disks in one call use list_disks; to erase and reformat a disk use format_disk.",
    inputSchema: { name: z.string().describe("Disk name, e.g. 'disk1'") },
    async handler(a, ctx) {
      ctx.info(`Getting disk details: name=${a.name}`);
      const result = await executeMikrotikCommand(`/disk print detail where name="${a.name}"`, ctx);
      if (commandUnsupported(result)) return "Disk management is not available on this device.";
      return isEmpty(result) ? `Disk '${a.name}' not found.` : `DISK DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "format_disk",
    title: "Format Disk (Destructive Erase)",
    annotations: DANGEROUS,
    description:
      "Erase and reformat a disk (`/disk format-drive`) — PERMANENTLY DESTROYS all data on the target disk. " +
      "Use this to prepare a new or blank storage device for use on the router. " +
      "Requires confirm=true to proceed; without it the command is aborted. " +
      "Optional file_system (ext4, fat32, exfat, ntfs) selects the filesystem; optional label sets the volume label. " +
      "The `name` argument takes a disk name (e.g. `disk1`) as returned by list_disks. " +
      "For read-only disk inspection use list_disks or get_disk.",
    inputSchema: {
      name: z.string().describe("Disk name to format, e.g. 'disk1'"),
      file_system: z
        .enum(["ext4", "fat32", "exfat", "ntfs"])
        .optional()
        .describe("File system to create"),
      label: z.string().optional().describe("Volume label"),
      confirm: z.boolean().describe("Must be true to actually erase the disk"),
    },
    async handler(a, ctx) {
      ctx.info(`Format disk requested: name=${a.name}, confirm=${a.confirm}`);
      if (!a.confirm) return "Format not confirmed. Pass confirm=true to ERASE the disk.";

      const cmd = new Cmd(`/disk format-drive ${quoteValue(a.name)}`)
        .opt("file-system", a.file_system)
        .opt("label", a.label)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return "Disk management is not available on this device.";
      if (looksLikeError(result)) return `Failed to format disk: ${result}`;
      return `Formatting disk '${a.name}'...\n\n${result}`;
    },
  }),
];
