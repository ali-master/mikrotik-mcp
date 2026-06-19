/** Storage / disk management — `/disk`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import {  READ, defineTool, DANGEROUS } from "../core/registry";
import type {ToolModule} from "../core/registry";
import { quoteValue, looksLikeError, isEmpty, commandUnsupported, Cmd } from "../core/routeros";

export const diskTools: ToolModule = [
  defineTool({
    name: "list_disks",
    title: "List Disks",
    annotations: READ,
    description: "Lists storage disks (USB, NVMe, internal flash) attached to the MikroTik device.",
    async handler(_a, ctx) {
      ctx.info("Listing disks");
      const result = await executeMikrotikCommand("/disk print", ctx);
      if (commandUnsupported(result)) return "Disk management is not available on this device.";
      return isEmpty(result) ? "No disks found." : `DISKS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_disk",
    title: "Get Disk",
    annotations: READ,
    description: "Gets detailed information about a specific disk.",
    inputSchema: { name: z.string().describe("Disk name, e.g. 'disk1'") },
    async handler(a, ctx) {
      ctx.info(`Getting disk details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/disk print detail where name="${a.name}"`,
        ctx,
      );
      if (commandUnsupported(result)) return "Disk management is not available on this device.";
      return isEmpty(result) ? `Disk '${a.name}' not found.` : `DISK DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "format_disk",
    title: "Format Disk",
    annotations: DANGEROUS,
    description:
      "Formats (ERASES) a disk on the MikroTik device. This destroys all data on the disk. Requires confirm=true.",
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
