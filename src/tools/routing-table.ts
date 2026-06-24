/** Routing tables (FIB) — `/routing table` (RouterOS v7). */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { yesno, looksLikeError, isEmpty, commandUnsupported, Cmd } from "../core/routeros";

const UNSUPPORTED =
  "Routing tables are not available on this device (requires RouterOS v7 with the routing package).";

export const routingTableTools: ToolModule = [
  defineTool({
    name: "list_routing_tables",
    title: "List Routing Tables",
    annotations: READ,
    description:
      "Lists routing tables (`/routing table`). Each named table is a separate RIB; set `fib` on a table to " +
      "also install its routes into the forwarding plane (FIB). The built-in `main` table is always present.",
    inputSchema: {
      name_filter: z.string().optional().describe("Substring match on table name"),
    },
    async handler(a, ctx) {
      ctx.info("Listing routing tables");
      const where = a.name_filter ? ` where name~"${a.name_filter}"` : "";
      const result = await executeMikrotikCommand(`/routing table print detail${where}`, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result) ? "No routing tables found." : `ROUTING TABLES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_routing_table_def",
    title: "Get Routing Table",
    annotations: READ,
    description: "Gets detailed information about a specific routing table definition by name.",
    inputSchema: { name: z.string().describe("Routing table name") },
    async handler(a, ctx) {
      ctx.info(`Getting routing table: ${a.name}`);
      const result = await executeMikrotikCommand(
        `/routing table print detail where name="${a.name}"`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? `Routing table '${a.name}' not found.`
        : `ROUTING TABLE:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_routing_table",
    title: "Add Routing Table",
    annotations: WRITE,
    description:
      "Adds a named routing table. Enable `fib` to install the table's routes into the forwarding plane " +
      "(otherwise the table is RIB-only and used purely for lookups by routing rules/marks).",
    inputSchema: {
      name: z.string().describe("Unique table name, referenced by routes and routing rules"),
      fib: z.boolean().default(true).describe("Install routes into the FIB (forwarding plane)"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding routing table: ${a.name}`);
      const cmd = new Cmd("/routing table add")
        .set("name", a.name)
        .bool("fib", a.fib)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to add routing table: ${result}`;
      const details = await executeMikrotikCommand(
        `/routing table print detail where name="${a.name}"`,
        ctx,
      );
      return `Routing table '${a.name}' added successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "update_routing_table",
    title: "Update Routing Table",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates a routing table's fib flag, comment, or disabled state.",
    inputSchema: {
      name: z.string().describe("Existing routing table name"),
      fib: z.boolean().optional().describe("Install routes into the FIB"),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating routing table: ${a.name}`);
      const base = `/routing table set [find name="${a.name}"]`;
      const cmd = new Cmd(base);
      if (a.fib !== undefined) cmd.bool("fib", a.fib);
      if (a.comment !== undefined) cmd.set("comment", a.comment);
      if (a.disabled !== undefined) cmd.bool("disabled", a.disabled);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to update routing table: ${result}`;
      const details = await executeMikrotikCommand(
        `/routing table print detail where name="${a.name}"`,
        ctx,
      );
      return `Routing table '${a.name}' updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_routing_table",
    title: "Remove Routing Table",
    annotations: DESTRUCTIVE,
    description: "Removes a routing table by name. The built-in `main` table cannot be removed.",
    inputSchema: { name: z.string().describe("Routing table name to remove") },
    async handler(a, ctx) {
      ctx.info(`Removing routing table: ${a.name}`);
      const result = await executeMikrotikCommand(
        `/routing table remove [find name="${a.name}"]`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to remove routing table: ${result}`;
      return `Routing table '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "set_routing_table_enabled",
    title: "Enable/Disable Routing Table",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables or disables a routing table by name.",
    inputSchema: {
      name: z.string().describe("Routing table name"),
      enabled: z.boolean().describe("true to enable, false to disable"),
    },
    async handler(a, ctx) {
      ctx.info(`Setting routing table ${a.name} enabled=${a.enabled}`);
      const result = await executeMikrotikCommand(
        `/routing table set [find name="${a.name}"] disabled=${yesno(!a.enabled)}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to update routing table: ${result}`;
      return `Routing table '${a.name}' ${a.enabled ? "enabled" : "disabled"}.`;
    },
  }),
];
