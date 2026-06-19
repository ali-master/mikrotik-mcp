/** Policy routing rules — `/routing rule` (RouterOS v7). */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, WRITE_IDEMPOTENT, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { yesno, whereClause, looksLikeError, isEmpty, commandUnsupported, Cmd } from "../core/routeros";

const UNSUPPORTED =
  "Routing rules are not available on this device (requires RouterOS v7 with the routing package).";

const ACTIONS = ["lookup", "lookup-only-in-table", "drop", "unreachable"] as const;

export const routingRuleTools: ToolModule = [
  defineTool({
    name: "list_routing_rules",
    title: "List Routing Rules",
    annotations: READ,
    description:
      "Lists policy routing rules (`/routing rule`). Rules are evaluated top-down and pick which routing " +
      "table a packet is looked up in based on source/destination, interface or routing-mark.",
    inputSchema: {
      table_filter: z.string().optional().describe("Match rules targeting this table"),
      disabled_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing routing rules");
      const filters: string[] = [];
      if (a.table_filter) filters.push(`table="${a.table_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      const result = await executeMikrotikCommand(`/routing rule print detail${whereClause(filters)}`, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result) ? "No routing rules found." : `ROUTING RULES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_routing_rule",
    title: "Get Routing Rule",
    annotations: READ,
    description: "Gets detailed information about a specific routing rule by its internal id.",
    inputSchema: { rule_id: z.string().describe('Rule id from list output, e.g. "*3"') },
    async handler(a, ctx) {
      ctx.info(`Getting routing rule: ${a.rule_id}`);
      const result = await executeMikrotikCommand(
        `/routing rule print detail where .id=${a.rule_id}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result) ? `Routing rule '${a.rule_id}' not found.` : `ROUTING RULE:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_routing_rule",
    title: "Add Routing Rule",
    annotations: WRITE,
    description:
      "Adds a policy routing rule. Match on source/destination prefix, incoming interface and/or routing-mark; " +
      "`action=lookup` resolves in `table` (and continues to lower-priority tables if no match), " +
      "`lookup-only-in-table` stops at that table, `drop`/`unreachable` discard the packet.",
    inputSchema: {
      action: z.enum(ACTIONS).default("lookup"),
      table: z.string().optional().describe("Target routing table for lookup actions"),
      src_address: z.string().optional().describe('Source prefix, e.g. "192.168.10.0/24"'),
      dst_address: z.string().optional().describe('Destination prefix'),
      routing_mark: z.string().optional().describe("Match packets carrying this routing-mark"),
      interface: z.string().optional().describe("Match this incoming interface"),
      min_prefix: z.number().int().optional(),
      max_prefix: z.number().int().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
      place_before: z.string().optional().describe("Insert before this rule id to control ordering"),
    },
    async handler(a, ctx) {
      ctx.info(`Adding routing rule: action=${a.action}, table=${a.table}`);
      const cmd = new Cmd("/routing rule add")
        .set("action", a.action)
        .opt("table", a.table)
        .opt("src-address", a.src_address)
        .opt("dst-address", a.dst_address)
        .opt("routing-mark", a.routing_mark)
        .opt("interface", a.interface)
        .opt("min-prefix", a.min_prefix)
        .opt("max-prefix", a.max_prefix)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .opt("place-before", a.place_before)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to add routing rule: ${result}`;
      const t = result.trim();
      return t ? `Routing rule added (id ${t}).` : "Routing rule added successfully.";
    },
  }),

  defineTool({
    name: "update_routing_rule",
    title: "Update Routing Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      'Updates a routing rule by id. Pass "" to src_address, dst_address, routing_mark, interface or table to clear.',
    inputSchema: {
      rule_id: z.string().describe('Rule id, e.g. "*3"'),
      action: z.enum(ACTIONS).optional(),
      table: z.string().optional(),
      src_address: z.string().optional(),
      dst_address: z.string().optional(),
      routing_mark: z.string().optional(),
      interface: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating routing rule: ${a.rule_id}`);
      const base = `/routing rule set ${a.rule_id}`;
      const cmd = new Cmd(base);
      if (a.action !== undefined) cmd.set("action", a.action);
      const clearable: Array<[string, string | undefined]> = [
        ["table", a.table],
        ["src-address", a.src_address],
        ["dst-address", a.dst_address],
        ["routing-mark", a.routing_mark],
        ["interface", a.interface],
      ];
      for (const [key, val] of clearable) {
        if (val !== undefined) cmd.raw(val === "" ? `!${key}` : `${key}=${val}`);
      }
      if (a.comment !== undefined) cmd.set("comment", a.comment);
      if (a.disabled !== undefined) cmd.bool("disabled", a.disabled);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to update routing rule: ${result}`;
      const details = await executeMikrotikCommand(`/routing rule print detail where .id=${a.rule_id}`, ctx);
      return `Routing rule updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_routing_rule",
    title: "Remove Routing Rule",
    annotations: DESTRUCTIVE,
    description: "Removes a routing rule by id.",
    inputSchema: { rule_id: z.string().describe('Rule id, e.g. "*3"') },
    async handler(a, ctx) {
      ctx.info(`Removing routing rule: ${a.rule_id}`);
      const result = await executeMikrotikCommand(`/routing rule remove ${a.rule_id}`, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to remove routing rule: ${result}`;
      return `Routing rule '${a.rule_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "set_routing_rule_enabled",
    title: "Enable/Disable Routing Rule",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables or disables a routing rule by id.",
    inputSchema: {
      rule_id: z.string().describe('Rule id, e.g. "*3"'),
      enabled: z.boolean().describe("true to enable, false to disable"),
    },
    async handler(a, ctx) {
      ctx.info(`Setting routing rule ${a.rule_id} enabled=${a.enabled}`);
      const result = await executeMikrotikCommand(
        `/routing rule set ${a.rule_id} disabled=${yesno(!a.enabled)}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to update routing rule: ${result}`;
      return `Routing rule '${a.rule_id}' ${a.enabled ? "enabled" : "disabled"}.`;
    },
  }),
];
