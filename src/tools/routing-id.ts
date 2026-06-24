/** Routing Router-ID — `/routing id` (RouterOS v7). */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { yesno, looksLikeError, isEmpty, commandUnsupported, Cmd } from "../core/routeros";

const UNSUPPORTED =
  "Routing Router-ID is not available on this device (requires RouterOS v7 with the routing package).";

export const routingIdTools: ToolModule = [
  defineTool({
    name: "list_routing_ids",
    title: "List Routing IDs",
    annotations: READ,
    description:
      "Lists Router-ID instances (`/routing id`). Each instance assigns a stable 32-bit router identifier " +
      "to a routing process (OSPF/BGP) and can auto-select the ID from a chosen interface or loopback.",
    inputSchema: {
      name_filter: z.string().optional().describe("Substring match on the instance name"),
    },
    async handler(a, ctx) {
      ctx.info("Listing routing IDs");
      const where = a.name_filter ? ` where name~"${a.name_filter}"` : "";
      const result = await executeMikrotikCommand(`/routing id print detail${where}`, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result) ? "No routing IDs found." : `ROUTING IDs:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_routing_id",
    title: "Get Routing ID",
    annotations: READ,
    description: "Gets detailed information about a specific Router-ID instance by name.",
    inputSchema: {
      name: z.string().describe("Router-ID instance name"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting routing ID: ${a.name}`);
      const result = await executeMikrotikCommand(
        `/routing id print detail where name="${a.name}"`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? `Routing ID '${a.name}' not found.`
        : `ROUTING ID DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_routing_id",
    title: "Add Routing ID",
    annotations: WRITE,
    description:
      "Adds a Router-ID instance. Either pin a fixed `id` (an IPv4 address) or let RouterOS pick one " +
      "dynamically from an interface/loopback via `select_dynamic_id`.",
    inputSchema: {
      name: z.string().describe("Unique instance name, referenced by OSPF/BGP"),
      id: z.string().optional().describe("Fixed router-id as an IPv4 address, e.g. '10.0.0.1'"),
      select_dynamic_id: z
        .string()
        .optional()
        .describe("Interface/loopback name to auto-derive the id from when `id` is omitted"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding routing ID: ${a.name}`);
      const cmd = new Cmd("/routing id add")
        .set("name", a.name)
        .opt("id", a.id)
        .opt("select-dynamic-id", a.select_dynamic_id)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to add routing ID: ${result}`;
      const details = await executeMikrotikCommand(
        `/routing id print detail where name="${a.name}"`,
        ctx,
      );
      return `Routing ID '${a.name}' added successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "update_routing_id",
    title: "Update Routing ID",
    annotations: WRITE_IDEMPOTENT,
    description:
      'Updates a Router-ID instance. Pass "" to `id` or `select_dynamic_id` to clear that property.',
    inputSchema: {
      name: z.string().describe("Existing Router-ID instance name"),
      id: z.string().optional().describe('IPv4 router-id, or "" to clear'),
      select_dynamic_id: z.string().optional().describe('Interface/loopback name, or "" to clear'),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating routing ID: ${a.name}`);
      const base = `/routing id set [find name="${a.name}"]`;
      const cmd = new Cmd(base);
      if (a.id !== undefined) cmd.raw(a.id === "" ? "!id" : `id=${a.id}`);
      if (a.select_dynamic_id !== undefined) {
        cmd.raw(
          a.select_dynamic_id === ""
            ? "!select-dynamic-id"
            : `select-dynamic-id=${a.select_dynamic_id}`,
        );
      }
      if (a.comment !== undefined) cmd.set("comment", a.comment);
      if (a.disabled !== undefined) cmd.bool("disabled", a.disabled);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to update routing ID: ${result}`;
      const details = await executeMikrotikCommand(
        `/routing id print detail where name="${a.name}"`,
        ctx,
      );
      return `Routing ID '${a.name}' updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_routing_id",
    title: "Remove Routing ID",
    annotations: DESTRUCTIVE,
    description: "Removes a Router-ID instance by name.",
    inputSchema: {
      name: z.string().describe("Router-ID instance name to remove"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing routing ID: ${a.name}`);
      const result = await executeMikrotikCommand(
        `/routing id remove [find name="${a.name}"]`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to remove routing ID: ${result}`;
      return `Routing ID '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "set_routing_id_enabled",
    title: "Enable/Disable Routing ID",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables or disables a Router-ID instance by name.",
    inputSchema: {
      name: z.string().describe("Router-ID instance name"),
      enabled: z.boolean().describe("true to enable, false to disable"),
    },
    async handler(a, ctx) {
      ctx.info(`Setting routing ID ${a.name} enabled=${a.enabled}`);
      const result = await executeMikrotikCommand(
        `/routing id set [find name="${a.name}"] disabled=${yesno(!a.enabled)}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to update routing ID: ${result}`;
      return `Routing ID '${a.name}' ${a.enabled ? "enabled" : "disabled"}.`;
    },
  }),
];
