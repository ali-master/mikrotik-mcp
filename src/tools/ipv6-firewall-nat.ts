/** IPv6 firewall NAT rules — `/ipv6 firewall nat`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, quoteValue, looksLikeError, isEmpty, Cmd } from "../core/routeros";
import type { ToolContext } from "../core/context";

const isDigits = (s: string): boolean => /^\d+$/.test(s);

async function updateNatRule(
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
    to_address?: string;
    to_ports?: string;
    src_address_list?: string;
    dst_address_list?: string;
    comment?: string;
    disabled?: boolean;
    log?: boolean;
    log_prefix?: string;
  },
  ctx: ToolContext,
): Promise<string> {
  ctx.info(`Updating IPv6 firewall NAT rule: rule_id=${a.rule_id}`);

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
  put("to-address", a.to_address);
  put("to-ports", a.to_ports);
  put("src-address-list", a.src_address_list);
  put("dst-address-list", a.dst_address_list);
  if (a.comment !== undefined) updates.push(`comment=${quoteValue(a.comment)}`);
  if (a.disabled !== undefined) updates.push(`disabled=${a.disabled ? "yes" : "no"}`);
  if (a.log !== undefined) {
    updates.push(`log=${a.log ? "yes" : "no"}`);
    if (a.log && a.log_prefix) updates.push(`log-prefix=${quoteValue(a.log_prefix)}`);
  }

  if (updates.length === 0) return "No updates specified.";

  const cmd = `/ipv6 firewall nat set ${a.rule_id} ${updates.join(" ")}`;
  const result = await executeMikrotikCommand(cmd, ctx);
  if (looksLikeError(result)) return `Failed to update IPv6 firewall NAT rule: ${result}`;

  const details = await executeMikrotikCommand(
    `/ipv6 firewall nat print detail where .id=${a.rule_id}`,
    ctx,
  );
  return `IPv6 firewall NAT rule updated successfully:\n\n${details}`;
}

export const ipv6FirewallNatTools: ToolModule = [
  defineTool({
    name: "create_ipv6_nat_rule",
    title: "Create IPv6 Firewall NAT Rule",
    annotations: WRITE,
    description:
      "Creates an IPv6 NAT rule (`/ipv6 firewall nat add`) — the address/port translation table for IPv6 traffic, used to redirect or masquerade connections. " +
      "chain: 'srcnat' (applied after routing, for outbound traffic) or 'dstnat' (applied before routing, for inbound traffic). " +
      "action: masquerade/src-nat/dst-nat/netmap/redirect/accept/drop/return/jump/passthrough/log. " +
      "to_address: rewrite target for src-nat/dst-nat/netmap. " +
      "place_before: rule number or ID (*N) to insert before a specific position. " +
      "For IPv4 NAT use create_nat_rule; for IPv6 packet filtering use create_ipv6_filter_rule; for IPv6 traffic marking use create_ipv6_mangle_rule; for IPv6 pre-connection-tracking drops use create_ipv6_raw_rule. " +
      "Returns the created rule's full detail including its `.id`.",
    inputSchema: {
      chain: z.enum(["srcnat", "dstnat"]),
      action: z.enum([
        "accept",
        "drop",
        "masquerade",
        "src-nat",
        "dst-nat",
        "netmap",
        "redirect",
        "return",
        "jump",
        "passthrough",
        "log",
      ]),
      src_address: z.string().optional(),
      dst_address: z.string().optional(),
      src_port: z.string().optional(),
      dst_port: z.string().optional(),
      protocol: z.string().optional(),
      in_interface: z.string().optional(),
      out_interface: z.string().optional(),
      to_address: z.string().optional(),
      to_ports: z.string().optional(),
      src_address_list: z.string().optional(),
      dst_address_list: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
      log: z.boolean().default(false),
      log_prefix: z.string().optional(),
      place_before: z.string().optional().describe("Rule number or ID (*N) to insert before"),
    },
    async handler(a, ctx) {
      ctx.info(`Creating IPv6 firewall NAT rule: chain=${a.chain}, action=${a.action}`);

      const cmd = new Cmd("/ipv6 firewall nat add")
        .set("chain", a.chain)
        .set("action", a.action)
        .opt("src-address", a.src_address)
        .opt("dst-address", a.dst_address)
        .opt("src-port", a.src_port)
        .opt("dst-port", a.dst_port)
        .opt("protocol", a.protocol)
        .opt("in-interface", a.in_interface)
        .opt("out-interface", a.out_interface)
        .opt("to-address", a.to_address)
        .opt("to-ports", a.to_ports)
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
            `/ipv6 firewall nat print detail where .id=${trimmed}`,
            ctx,
          );
          return details.trim()
            ? `IPv6 firewall NAT rule created successfully:\n\n${details}`
            : `IPv6 firewall NAT rule created with ID: ${result}`;
        }
        return `Failed to create IPv6 firewall NAT rule: ${result}`;
      }

      const count = await executeMikrotikCommand("/ipv6 firewall nat print detail count-only", ctx);
      const c = count.trim();
      if (isDigits(c) && Number.parseInt(c, 10) > 0) {
        const details = await executeMikrotikCommand(
          `/ipv6 firewall nat print detail from=${Number.parseInt(c, 10) - 1}`,
          ctx,
        );
        return `IPv6 firewall NAT rule created successfully:\n\n${details}`;
      }
      return "IPv6 firewall NAT rule creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ipv6_nat_rules",
    title: "List IPv6 Firewall NAT Rules",
    annotations: READ,
    description:
      "Lists IPv6 NAT rules (`/ipv6 firewall nat print`) with optional filters — use to inspect all address/port translation rules in the srcnat or dstnat chain. " +
      "Filters: chain_filter, action_filter, src_address_filter, dst_address_filter, disabled_only, invalid_only, dynamic_only. " +
      "For a single rule's full detail use get_ipv6_nat_rule. " +
      "For IPv4 NAT use list_nat_rules; for IPv6 filter rules use list_ipv6_filter_rules; for IPv6 mangle use list_ipv6_mangle_rules; for IPv6 raw use list_ipv6_raw_rules. " +
      "Returns matching rule list with `.id` values needed by get_ipv6_nat_rule, update_ipv6_nat_rule, remove_ipv6_nat_rule, move_ipv6_nat_rule, enable_ipv6_nat_rule, and disable_ipv6_nat_rule.",
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
      ctx.info("Listing IPv6 firewall NAT rules");

      const filters: string[] = [];
      if (a.chain_filter) filters.push(`chain=${a.chain_filter}`);
      if (a.action_filter) filters.push(`action=${a.action_filter}`);
      if (a.src_address_filter) filters.push(`src-address~"${a.src_address_filter}"`);
      if (a.dst_address_filter) filters.push(`dst-address~"${a.dst_address_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.invalid_only) filters.push("invalid=yes");
      if (a.dynamic_only) filters.push("dynamic=yes");

      const result = await executeMikrotikCommand(
        `/ipv6 firewall nat print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No IPv6 firewall NAT rules found matching the criteria."
        : `IPV6 FIREWALL NAT RULES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipv6_nat_rule",
    title: "Get IPv6 Firewall NAT Rule",
    annotations: READ,
    description:
      "Fetches full detail of a single IPv6 NAT rule (`/ipv6 firewall nat print detail where .id=...`) — use when you need all fields of one rule rather than scanning the full list. " +
      'rule_id takes the `.id` value from list_ipv6_nat_rules (e.g. "*1" or "0"). ' +
      "For IPv4 use get_nat_rule; for the IPv6 filter table use get_ipv6_filter_rule. " +
      "Returns all fields for the matched rule, or a not-found message if the ID does not exist.",
    inputSchema: {
      rule_id: z.string().describe('Rule ID from list output e.g. "*1" or "0"'),
    },
    async handler(a, ctx) {
      ctx.info(`Getting IPv6 firewall NAT rule details: rule_id=${a.rule_id}`);
      const result = await executeMikrotikCommand(
        `/ipv6 firewall nat print detail where .id=${a.rule_id}`,
        ctx,
      );
      return isEmpty(result)
        ? `IPv6 firewall NAT rule with ID '${a.rule_id}' not found.`
        : `IPV6 FIREWALL NAT RULE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_ipv6_nat_rule",
    title: "Update IPv6 Firewall NAT Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Modifies fields of an existing IPv6 NAT rule (`/ipv6 firewall nat set`) — use to change action, addresses, ports, chain, or flags without removing and recreating the rule. " +
      "rule_id takes the `.id` from list_ipv6_nat_rules. " +
      'Pass "" for any optional field to clear it (e.g. to_address=""). ' +
      "For IPv4 use update_nat_rule; for the IPv6 filter table use update_ipv6_filter_rule. " +
      "To only toggle active state use enable_ipv6_nat_rule or disable_ipv6_nat_rule. " +
      "Returns the updated rule's full detail.",
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
      to_address: z.string().optional(),
      to_ports: z.string().optional(),
      src_address_list: z.string().optional(),
      dst_address_list: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
      log: z.boolean().optional(),
      log_prefix: z.string().optional(),
    },
    async handler(a, ctx) {
      return updateNatRule(a, ctx);
    },
  }),

  defineTool({
    name: "remove_ipv6_nat_rule",
    title: "Remove IPv6 Firewall NAT Rule",
    annotations: DESTRUCTIVE,
    description:
      "Permanently deletes an IPv6 NAT rule (`/ipv6 firewall nat remove`) — use to remove a translation entry entirely. " +
      "First verifies the rule exists via a count-only check; returns a not-found message if absent. " +
      "rule_id takes the `.id` from list_ipv6_nat_rules. " +
      "For IPv4 use remove_nat_rule; for the IPv6 filter table use remove_ipv6_filter_rule. " +
      "To temporarily deactivate instead of delete, use disable_ipv6_nat_rule.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing IPv6 firewall NAT rule: rule_id=${a.rule_id}`);

      const count = await executeMikrotikCommand(
        `/ipv6 firewall nat print count-only where .id=${a.rule_id}`,
        ctx,
      );
      if (count.trim() === "0") return `IPv6 firewall NAT rule with ID '${a.rule_id}' not found.`;

      const result = await executeMikrotikCommand(`/ipv6 firewall nat remove ${a.rule_id}`, ctx);
      if (looksLikeError(result)) return `Failed to remove IPv6 firewall NAT rule: ${result}`;
      return `IPv6 firewall NAT rule with ID '${a.rule_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "move_ipv6_nat_rule",
    title: "Move IPv6 Firewall NAT Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Repositions an IPv6 NAT rule to a different ordinal slot (`/ipv6 firewall nat move ... destination=N`) — NAT rules are evaluated top-to-bottom so position controls which rule matches first. " +
      "destination is a 0-based integer index. rule_id takes the `.id` from list_ipv6_nat_rules. " +
      "For IPv4 use move_nat_rule; for the IPv6 filter table use move_ipv6_filter_rule. " +
      "Confirms success or returns the error message from the device.",
    inputSchema: {
      rule_id: z.string(),
      destination: z.number().int().describe("0-based target position index"),
    },
    async handler(a, ctx) {
      ctx.info(`Moving IPv6 firewall NAT rule: rule_id=${a.rule_id} to position ${a.destination}`);

      const count = await executeMikrotikCommand(
        `/ipv6 firewall nat print count-only where .id=${a.rule_id}`,
        ctx,
      );
      if (count.trim() === "0") return `IPv6 firewall NAT rule with ID '${a.rule_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/ipv6 firewall nat move ${a.rule_id} destination=${a.destination}`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to move IPv6 firewall NAT rule: ${result}`;
      return `IPv6 firewall NAT rule with ID '${a.rule_id}' moved to position ${a.destination}.`;
    },
  }),

  defineTool({
    name: "enable_ipv6_nat_rule",
    title: "Enable IPv6 Firewall NAT Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Re-activates a disabled IPv6 NAT rule (`/ipv6 firewall nat set ... disabled=no`) — use to restore a rule that was previously disabled without recreating it. " +
      "rule_id takes the `.id` from list_ipv6_nat_rules. " +
      "To deactivate use disable_ipv6_nat_rule; to permanently delete use remove_ipv6_nat_rule. " +
      "For IPv4 NAT use enable_nat_rule. " +
      "Returns the updated rule's full detail.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateNatRule({ rule_id: a.rule_id, disabled: false }, ctx);
    },
  }),

  defineTool({
    name: "disable_ipv6_nat_rule",
    title: "Disable IPv6 Firewall NAT Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Temporarily deactivates an IPv6 NAT rule (`/ipv6 firewall nat set ... disabled=yes`) without removing it — use to suspend a translation rule while preserving its configuration. " +
      "rule_id takes the `.id` from list_ipv6_nat_rules. " +
      "To re-activate use enable_ipv6_nat_rule; to permanently delete use remove_ipv6_nat_rule. " +
      "For IPv4 NAT use disable_nat_rule. " +
      "Returns the updated rule's full detail.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateNatRule({ rule_id: a.rule_id, disabled: true }, ctx);
    },
  }),
];
