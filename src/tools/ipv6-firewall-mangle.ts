/** IPv6 firewall mangle rules — `/ipv6 firewall mangle`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import {
  whereClause,
  quoteValue,
  looksLikeError,
  isEmpty,
  extractCreatedId,
  readBackUnavailable,
  Cmd,
} from "../core/routeros";
import type { ToolContext } from "../core/context";

const isDigits = (s: string): boolean => /^\d+$/.test(s);

async function updateMangleRule(
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
    connection_mark?: string;
    packet_mark?: string;
    routing_mark?: string;
    new_connection_mark?: string;
    new_packet_mark?: string;
    new_routing_mark?: string;
    new_dscp?: string;
    new_hop_limit?: string;
    passthrough?: boolean;
    comment?: string;
    disabled?: boolean;
    log?: boolean;
    log_prefix?: string;
  },
  ctx: ToolContext,
): Promise<string> {
  ctx.info(`Updating IPv6 firewall mangle rule: rule_id=${a.rule_id}`);

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
  put("connection-mark", a.connection_mark);
  put("packet-mark", a.packet_mark);
  put("routing-mark", a.routing_mark);
  put("new-connection-mark", a.new_connection_mark);
  put("new-packet-mark", a.new_packet_mark);
  put("new-routing-mark", a.new_routing_mark);
  put("new-dscp", a.new_dscp);
  put("new-hop-limit", a.new_hop_limit);
  if (a.passthrough !== undefined) updates.push(`passthrough=${a.passthrough ? "yes" : "no"}`);
  if (a.comment !== undefined) updates.push(`comment=${quoteValue(a.comment)}`);
  if (a.disabled !== undefined) updates.push(`disabled=${a.disabled ? "yes" : "no"}`);
  if (a.log !== undefined) {
    updates.push(`log=${a.log ? "yes" : "no"}`);
    if (a.log && a.log_prefix) updates.push(`log-prefix=${quoteValue(a.log_prefix)}`);
  }

  if (updates.length === 0) return "No updates specified.";

  const cmd = `/ipv6 firewall mangle set ${a.rule_id} ${updates.join(" ")}`;
  const result = await executeMikrotikCommand(cmd, ctx);
  if (looksLikeError(result)) return `Failed to update IPv6 firewall mangle rule: ${result}`;

  const details = await executeMikrotikCommand(
    `/ipv6 firewall mangle print detail where .id=${a.rule_id}`,
    ctx,
  );
  return `IPv6 firewall mangle rule updated successfully:\n\n${details}`;
}

export const ipv6FirewallMangleTools: ToolModule = [
  defineTool({
    name: "create_ipv6_mangle_rule",
    title: "Create IPv6 Firewall Mangle Rule",
    annotations: WRITE,
    description:
      "Creates an IPv6 mangle rule (`/ipv6 firewall mangle add`) — the packet-marking and header-modification table for IPv6 traffic, " +
      "used to mark connections/packets/routing or change DSCP/hop-limit/MSS. " +
      "For accept/drop decisions use create_ipv6_filter_rule; for address translation use create_ipv6_nat_rule; " +
      "for pre-connection-tracking drops use create_ipv6_raw_rule. " +
      "chain: prerouting/input/forward/output/postrouting. " +
      "action: mark-connection/mark-packet/mark-routing/change-dscp/change-hop-limit/change-mss/accept/etc. " +
      "Set the matching new-*-mark field for mark-* actions; keep passthrough=true so later rules can also match the same packet. " +
      "place_before accepts a rule number or ID (*N) to control insertion position. " +
      "Returns the created rule's detail including its `.id`.",
    inputSchema: {
      chain: z.enum(["prerouting", "input", "forward", "output", "postrouting"]),
      action: z.enum([
        "accept",
        "drop",
        "mark-connection",
        "mark-packet",
        "mark-routing",
        "change-dscp",
        "change-hop-limit",
        "change-mss",
        "jump",
        "log",
        "passthrough",
        "return",
        "set-priority",
        "sniff-tzsp",
      ]),
      src_address: z.string().optional(),
      dst_address: z.string().optional(),
      src_port: z.string().optional(),
      dst_port: z.string().optional(),
      protocol: z.string().optional(),
      in_interface: z.string().optional(),
      out_interface: z.string().optional(),
      connection_mark: z.string().optional(),
      packet_mark: z.string().optional(),
      routing_mark: z.string().optional(),
      new_connection_mark: z.string().optional(),
      new_packet_mark: z.string().optional(),
      new_routing_mark: z.string().optional(),
      new_dscp: z.string().optional(),
      new_hop_limit: z.string().optional().describe('e.g. "decrement", "increment", or "set:64"'),
      passthrough: z.boolean().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
      log: z.boolean().default(false),
      log_prefix: z.string().optional(),
      place_before: z.string().optional().describe("Rule number or ID (*N) to insert before"),
    },
    async handler(a, ctx) {
      ctx.info(`Creating IPv6 firewall mangle rule: chain=${a.chain}, action=${a.action}`);

      const cmd = new Cmd("/ipv6 firewall mangle add")
        .set("chain", a.chain)
        .set("action", a.action)
        .opt("src-address", a.src_address)
        .opt("dst-address", a.dst_address)
        .opt("src-port", a.src_port)
        .opt("dst-port", a.dst_port)
        .opt("protocol", a.protocol)
        .opt("in-interface", a.in_interface)
        .opt("out-interface", a.out_interface)
        .opt("connection-mark", a.connection_mark)
        .opt("packet-mark", a.packet_mark)
        .opt("routing-mark", a.routing_mark)
        .opt("new-connection-mark", a.new_connection_mark)
        .opt("new-packet-mark", a.new_packet_mark)
        .opt("new-routing-mark", a.new_routing_mark)
        .opt("new-dscp", a.new_dscp)
        .opt("new-hop-limit", a.new_hop_limit)
        .bool("passthrough", a.passthrough)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .flag("log", a.log)
        .opt("log-prefix", a.log ? a.log_prefix : undefined)
        .opt("place-before", a.place_before)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);

      const trimmed = result.trim();

      if (looksLikeError(trimmed)) {
        return `Failed to create IPv6 firewall mangle rule: ${trimmed}`;
      }

      // RouterOS echoes the new rule's .id on success. Read it back by that id
      // (extracted as a clean token); if the read-back can't return the record,
      // still report success — the rule was created.
      const createdId = extractCreatedId(trimmed);
      if (createdId) {
        const details = await executeMikrotikCommand(
          `/ipv6 firewall mangle print detail where .id=${createdId}`,
          ctx,
        );
        return readBackUnavailable(details)
          ? `IPv6 firewall mangle rule created (id ${createdId}).`
          : `IPv6 firewall mangle rule created successfully:\n\n${details}`;
      }

      const count = await executeMikrotikCommand(
        "/ipv6 firewall mangle print detail count-only",
        ctx,
      );
      const c = count.trim();
      if (isDigits(c) && Number.parseInt(c, 10) > 0) {
        const details = await executeMikrotikCommand(
          `/ipv6 firewall mangle print detail from=${Number.parseInt(c, 10) - 1}`,
          ctx,
        );
        return `IPv6 firewall mangle rule created successfully:\n\n${details}`;
      }
      return "IPv6 firewall mangle rule creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ipv6_mangle_rules",
    title: "List IPv6 Firewall Mangle Rules",
    annotations: READ,
    description:
      "Lists IPv6 mangle rules (`/ipv6 firewall mangle print`) — returns all rules in the mangle table with their IDs, chains, actions, and match criteria. " +
      "For IPv6 filter use list_ipv6_filter_rules; for IPv6 NAT use list_ipv6_nat_rules; for IPv6 raw use list_ipv6_raw_rules. " +
      "Optionally filter by chain, action, connection-mark, packet-mark, disabled, invalid, or dynamic status. " +
      "Rule `.id` values from this output are required by get_ipv6_mangle_rule, update_ipv6_mangle_rule, remove_ipv6_mangle_rule, move_ipv6_mangle_rule, enable_ipv6_mangle_rule, and disable_ipv6_mangle_rule.",
    inputSchema: {
      chain_filter: z.string().optional(),
      action_filter: z.string().optional(),
      connection_mark_filter: z.string().optional(),
      packet_mark_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      invalid_only: z.boolean().default(false),
      dynamic_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPv6 firewall mangle rules");

      const filters: string[] = [];
      if (a.chain_filter) filters.push(`chain=${a.chain_filter}`);
      if (a.action_filter) filters.push(`action=${a.action_filter}`);
      if (a.connection_mark_filter) filters.push(`connection-mark="${a.connection_mark_filter}"`);
      if (a.packet_mark_filter) filters.push(`packet-mark="${a.packet_mark_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.invalid_only) filters.push("invalid=yes");
      if (a.dynamic_only) filters.push("dynamic=yes");

      const result = await executeMikrotikCommand(
        `/ipv6 firewall mangle print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No IPv6 firewall mangle rules found matching the criteria."
        : `IPV6 FIREWALL MANGLE RULES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipv6_mangle_rule",
    title: "Get IPv6 Firewall Mangle Rule Details",
    annotations: READ,
    description:
      "Retrieves full detail for a single IPv6 mangle rule (`/ipv6 firewall mangle print detail where .id=`). " +
      "Use when you need all fields of one specific rule rather than the full table listing. " +
      "For the full list use list_ipv6_mangle_rules. " +
      'rule_id takes the `.id` value (e.g. "*1" or "0") returned by list_ipv6_mangle_rules.',
    inputSchema: {
      rule_id: z.string().describe('Rule ID from list output e.g. "*1" or "0"'),
    },
    async handler(a, ctx) {
      ctx.info(`Getting IPv6 firewall mangle rule details: rule_id=${a.rule_id}`);
      const result = await executeMikrotikCommand(
        `/ipv6 firewall mangle print detail where .id=${a.rule_id}`,
        ctx,
      );
      return isEmpty(result)
        ? `IPv6 firewall mangle rule with ID '${a.rule_id}' not found.`
        : `IPV6 FIREWALL MANGLE RULE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_ipv6_mangle_rule",
    title: "Update IPv6 Firewall Mangle Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates fields on an existing IPv6 mangle rule (`/ipv6 firewall mangle set`) — change chain, action, match criteria, mark values, DSCP, hop-limit, or flags without recreating the rule. " +
      "To toggle enabled state only use enable_ipv6_mangle_rule or disable_ipv6_mangle_rule. " +
      "rule_id takes the `.id` from list_ipv6_mangle_rules. " +
      'Pass "" (empty string) for an optional field to clear it. ' +
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
      connection_mark: z.string().optional(),
      packet_mark: z.string().optional(),
      routing_mark: z.string().optional(),
      new_connection_mark: z.string().optional(),
      new_packet_mark: z.string().optional(),
      new_routing_mark: z.string().optional(),
      new_dscp: z.string().optional(),
      new_hop_limit: z.string().optional(),
      passthrough: z.boolean().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
      log: z.boolean().optional(),
      log_prefix: z.string().optional(),
    },
    async handler(a, ctx) {
      return updateMangleRule(a, ctx);
    },
  }),

  defineTool({
    name: "remove_ipv6_mangle_rule",
    title: "Remove IPv6 Firewall Mangle Rule",
    annotations: DESTRUCTIVE,
    description:
      "Permanently deletes an IPv6 mangle rule (`/ipv6 firewall mangle remove`) — verifies the rule exists first, then removes it. " +
      "To only deactivate without deleting use disable_ipv6_mangle_rule. " +
      "rule_id takes the `.id` from list_ipv6_mangle_rules. " +
      "Returns confirmation on success or a not-found message if the ID is absent.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing IPv6 firewall mangle rule: rule_id=${a.rule_id}`);

      const count = await executeMikrotikCommand(
        `/ipv6 firewall mangle print count-only where .id=${a.rule_id}`,
        ctx,
      );
      if (count.trim() === "0")
        return `IPv6 firewall mangle rule with ID '${a.rule_id}' not found.`;

      const result = await executeMikrotikCommand(`/ipv6 firewall mangle remove ${a.rule_id}`, ctx);
      if (looksLikeError(result)) return `Failed to remove IPv6 firewall mangle rule: ${result}`;
      return `IPv6 firewall mangle rule with ID '${a.rule_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "move_ipv6_mangle_rule",
    title: "Move IPv6 Firewall Mangle Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Reorders an IPv6 mangle rule to a specific position (`/ipv6 firewall mangle move`) — mangle rules are evaluated top-down, so position controls which rules fire first. " +
      "For IPv6 filter reordering use move_ipv6_filter_rule. " +
      "rule_id takes the `.id` from list_ipv6_mangle_rules; destination is the 0-based target index. " +
      "Verifies the rule exists before moving.",
    inputSchema: {
      rule_id: z.string(),
      destination: z.number().int().describe("0-based target position index"),
    },
    async handler(a, ctx) {
      ctx.info(
        `Moving IPv6 firewall mangle rule: rule_id=${a.rule_id} to position ${a.destination}`,
      );

      const count = await executeMikrotikCommand(
        `/ipv6 firewall mangle print count-only where .id=${a.rule_id}`,
        ctx,
      );
      if (count.trim() === "0")
        return `IPv6 firewall mangle rule with ID '${a.rule_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/ipv6 firewall mangle move ${a.rule_id} destination=${a.destination}`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to move IPv6 firewall mangle rule: ${result}`;
      return `IPv6 firewall mangle rule with ID '${a.rule_id}' moved to position ${a.destination}.`;
    },
  }),

  defineTool({
    name: "enable_ipv6_mangle_rule",
    title: "Enable IPv6 Firewall Mangle Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Enables a disabled IPv6 mangle rule (`/ipv6 firewall mangle set disabled=no`) so it participates in packet processing again. " +
      "To deactivate use disable_ipv6_mangle_rule; to delete permanently use remove_ipv6_mangle_rule. " +
      "rule_id takes the `.id` from list_ipv6_mangle_rules. " +
      "Returns the updated rule's detail.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateMangleRule({ rule_id: a.rule_id, disabled: false }, ctx);
    },
  }),

  defineTool({
    name: "disable_ipv6_mangle_rule",
    title: "Disable IPv6 Firewall Mangle Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Disables an active IPv6 mangle rule (`/ipv6 firewall mangle set disabled=yes`) — the rule remains in the table but is skipped during packet processing. " +
      "To re-enable use enable_ipv6_mangle_rule; to delete permanently use remove_ipv6_mangle_rule. " +
      "rule_id takes the `.id` from list_ipv6_mangle_rules. " +
      "Returns the updated rule's detail.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateMangleRule({ rule_id: a.rule_id, disabled: true }, ctx);
    },
  }),
];
