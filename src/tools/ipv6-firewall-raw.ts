/** IPv6 firewall raw rules — `/ipv6 firewall raw`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, quoteValue, looksLikeError, isEmpty, Cmd } from "../core/routeros";
import type { ToolContext } from "../core/context";

const isDigits = (s: string): boolean => /^\d+$/.test(s);

async function updateRawRule(
  a: {
    rule_id: string;
    chain?: string;
    action?: string;
    src_address?: string;
    dst_address?: string;
    src_port?: string;
    dst_port?: string;
    protocol?: string;
    in_interface?: string;
    out_interface?: string;
    src_address_list?: string;
    dst_address_list?: string;
    comment?: string;
    disabled?: boolean;
    log?: boolean;
    log_prefix?: string;
  },
  ctx: ToolContext,
): Promise<string> {
  ctx.info(`Updating IPv6 firewall raw rule: rule_id=${a.rule_id}`);

  const updates: string[] = [];
  const put = (key: string, val: string | undefined): void => {
    if (val === undefined) return;
    updates.push(val === "" ? `!${key}` : `${key}=${quoteValue(val)}`);
  };

  if (a.chain) updates.push(`chain=${a.chain}`);
  if (a.action) updates.push(`action=${a.action}`);
  put("src-address", a.src_address);
  put("dst-address", a.dst_address);
  put("src-port", a.src_port);
  put("dst-port", a.dst_port);
  put("protocol", a.protocol);
  put("in-interface", a.in_interface);
  put("out-interface", a.out_interface);
  put("src-address-list", a.src_address_list);
  put("dst-address-list", a.dst_address_list);
  if (a.comment !== undefined) updates.push(`comment=${quoteValue(a.comment)}`);
  if (a.disabled !== undefined) updates.push(`disabled=${a.disabled ? "yes" : "no"}`);
  if (a.log !== undefined) {
    updates.push(`log=${a.log ? "yes" : "no"}`);
    if (a.log && a.log_prefix) updates.push(`log-prefix=${quoteValue(a.log_prefix)}`);
  }

  if (updates.length === 0) return "No updates specified.";

  const cmd = `/ipv6 firewall raw set ${a.rule_id} ${updates.join(" ")}`;
  const result = await executeMikrotikCommand(cmd, ctx);
  if (looksLikeError(result)) return `Failed to update IPv6 firewall raw rule: ${result}`;

  const details = await executeMikrotikCommand(
    `/ipv6 firewall raw print detail where .id=${a.rule_id}`,
    ctx,
  );
  return `IPv6 firewall raw rule updated successfully:\n\n${details}`;
}

export const ipv6FirewallRawTools: ToolModule = [
  defineTool({
    name: "create_ipv6_raw_rule",
    title: "Create IPv6 Firewall Raw Rule",
    annotations: WRITE,
    description:
      "Creates an IPv6 firewall raw rule on the MikroTik device. The raw table " +
      "runs before connection tracking — use it to bypass tracking (notrack) " +
      "or drop traffic cheaply. chain: 'prerouting' or 'output'.",
    inputSchema: {
      chain: z.enum(["prerouting", "output"]),
      action: z.enum(["accept", "drop", "notrack", "jump", "log", "passthrough", "return"]),
      src_address: z.string().optional(),
      dst_address: z.string().optional(),
      src_port: z.string().optional(),
      dst_port: z.string().optional(),
      protocol: z.string().optional(),
      in_interface: z.string().optional(),
      out_interface: z.string().optional(),
      src_address_list: z.string().optional(),
      dst_address_list: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
      log: z.boolean().default(false),
      log_prefix: z.string().optional(),
      place_before: z.string().optional().describe("Rule number or ID (*N) to insert before"),
    },
    async handler(a, ctx) {
      ctx.info(`Creating IPv6 firewall raw rule: chain=${a.chain}, action=${a.action}`);

      const cmd = new Cmd("/ipv6 firewall raw add")
        .set("chain", a.chain)
        .set("action", a.action)
        .opt("src-address", a.src_address)
        .opt("dst-address", a.dst_address)
        .opt("src-port", a.src_port)
        .opt("dst-port", a.dst_port)
        .opt("protocol", a.protocol)
        .opt("in-interface", a.in_interface)
        .opt("out-interface", a.out_interface)
        .opt("src-address-list", a.src_address_list)
        .opt("dst-address-list", a.dst_address_list)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .flag("log", a.log)
        .opt("log-prefix", a.log ? a.log_prefix : undefined)
        .opt("place-before", a.place_before)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);

      if (result.trim()) {
        const trimmed = result.trim();
        if (trimmed.includes("*") || isDigits(trimmed)) {
          const details = await executeMikrotikCommand(
            `/ipv6 firewall raw print detail where .id=${trimmed}`,
            ctx,
          );
          return details.trim()
            ? `IPv6 firewall raw rule created successfully:\n\n${details}`
            : `IPv6 firewall raw rule created with ID: ${result}`;
        }
        return `Failed to create IPv6 firewall raw rule: ${result}`;
      }

      const count = await executeMikrotikCommand("/ipv6 firewall raw print detail count-only", ctx);
      const c = count.trim();
      if (isDigits(c) && Number.parseInt(c, 10) > 0) {
        const details = await executeMikrotikCommand(
          `/ipv6 firewall raw print detail from=${Number.parseInt(c, 10) - 1}`,
          ctx,
        );
        return `IPv6 firewall raw rule created successfully:\n\n${details}`;
      }
      return "IPv6 firewall raw rule creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ipv6_raw_rules",
    title: "List IPv6 Firewall Raw Rules",
    annotations: READ,
    description: "Lists IPv6 firewall raw rules on the MikroTik device.",
    inputSchema: {
      chain_filter: z.string().optional(),
      action_filter: z.string().optional(),
      src_address_filter: z.string().optional(),
      dst_address_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      invalid_only: z.boolean().default(false),
      dynamic_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPv6 firewall raw rules");

      const filters: string[] = [];
      if (a.chain_filter) filters.push(`chain=${a.chain_filter}`);
      if (a.action_filter) filters.push(`action=${a.action_filter}`);
      if (a.src_address_filter) filters.push(`src-address~"${a.src_address_filter}"`);
      if (a.dst_address_filter) filters.push(`dst-address~"${a.dst_address_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.invalid_only) filters.push("invalid=yes");
      if (a.dynamic_only) filters.push("dynamic=yes");

      const result = await executeMikrotikCommand(
        `/ipv6 firewall raw print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No IPv6 firewall raw rules found matching the criteria."
        : `IPV6 FIREWALL RAW RULES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipv6_raw_rule",
    title: "Get IPv6 Firewall Raw Rule",
    annotations: READ,
    description: "Gets detailed information about a specific IPv6 firewall raw rule.",
    inputSchema: {
      rule_id: z.string().describe('Rule ID from list output e.g. "*1" or "0"'),
    },
    async handler(a, ctx) {
      ctx.info(`Getting IPv6 firewall raw rule details: rule_id=${a.rule_id}`);
      const result = await executeMikrotikCommand(
        `/ipv6 firewall raw print detail where .id=${a.rule_id}`,
        ctx,
      );
      return isEmpty(result)
        ? `IPv6 firewall raw rule with ID '${a.rule_id}' not found.`
        : `IPV6 FIREWALL RAW RULE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_ipv6_raw_rule",
    title: "Update IPv6 Firewall Raw Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates an existing IPv6 firewall raw rule. " + 'Pass "" to clear an optional field.',
    inputSchema: {
      rule_id: z.string(),
      chain: z.string().optional(),
      action: z.string().optional(),
      src_address: z.string().optional(),
      dst_address: z.string().optional(),
      src_port: z.string().optional(),
      dst_port: z.string().optional(),
      protocol: z.string().optional(),
      in_interface: z.string().optional(),
      out_interface: z.string().optional(),
      src_address_list: z.string().optional(),
      dst_address_list: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
      log: z.boolean().optional(),
      log_prefix: z.string().optional(),
    },
    async handler(a, ctx) {
      return updateRawRule(a, ctx);
    },
  }),

  defineTool({
    name: "remove_ipv6_raw_rule",
    title: "Remove IPv6 Firewall Raw Rule",
    annotations: DESTRUCTIVE,
    description: "Removes an IPv6 firewall raw rule from the MikroTik device.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing IPv6 firewall raw rule: rule_id=${a.rule_id}`);

      const count = await executeMikrotikCommand(
        `/ipv6 firewall raw print count-only where .id=${a.rule_id}`,
        ctx,
      );
      if (count.trim() === "0") return `IPv6 firewall raw rule with ID '${a.rule_id}' not found.`;

      const result = await executeMikrotikCommand(`/ipv6 firewall raw remove ${a.rule_id}`, ctx);
      if (looksLikeError(result)) return `Failed to remove IPv6 firewall raw rule: ${result}`;
      return `IPv6 firewall raw rule with ID '${a.rule_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "move_ipv6_raw_rule",
    title: "Move IPv6 Raw Rule",
    annotations: WRITE_IDEMPOTENT,
    description: "Moves an IPv6 firewall raw rule to a different position in the chain.",
    inputSchema: {
      rule_id: z.string(),
      destination: z.number().int().describe("0-based target position index"),
    },
    async handler(a, ctx) {
      ctx.info(`Moving IPv6 firewall raw rule: rule_id=${a.rule_id} to position ${a.destination}`);

      const count = await executeMikrotikCommand(
        `/ipv6 firewall raw print count-only where .id=${a.rule_id}`,
        ctx,
      );
      if (count.trim() === "0") return `IPv6 firewall raw rule with ID '${a.rule_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/ipv6 firewall raw move ${a.rule_id} destination=${a.destination}`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to move IPv6 firewall raw rule: ${result}`;
      return `IPv6 firewall raw rule with ID '${a.rule_id}' moved to position ${a.destination}.`;
    },
  }),

  defineTool({
    name: "enable_ipv6_raw_rule",
    title: "Enable IPv6 Raw Rule",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables an IPv6 firewall raw rule.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateRawRule({ rule_id: a.rule_id, disabled: false }, ctx);
    },
  }),

  defineTool({
    name: "disable_ipv6_raw_rule",
    title: "Disable IPv6 Raw Rule",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables an IPv6 firewall raw rule.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateRawRule({ rule_id: a.rule_id, disabled: true }, ctx);
    },
  }),
];
