/** Firewall NAT rules — `/ip firewall nat`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import {
  whereClause,
  quoteValue,
  looksLikeError,
  isEmpty,
  placeBeforeError,
  extractCreatedId,
  readBackUnavailable,
  Cmd,
} from "../core/routeros";
import type { ToolContext } from "../core/context";

const isDigits = (s: string): boolean => /^\d+$/.test(s);

/** Shared update routine — used by update/enable/disable. */
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
    to_addresses?: string;
    to_ports?: string;
    comment?: string;
    disabled?: boolean;
    log?: boolean;
    log_prefix?: string;
  },
  ctx: ToolContext,
): Promise<string> {
  ctx.info(`Updating NAT rule: rule_id=${a.rule_id}`);

  const updates: string[] = [];
  // Clearable string fields: undefined -> skip, "" -> `!field`, else `field=value`.
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
  put("to-addresses", a.to_addresses);
  put("to-ports", a.to_ports);
  if (a.comment !== undefined) updates.push(`comment=${quoteValue(a.comment)}`);
  if (a.disabled !== undefined) updates.push(`disabled=${a.disabled ? "yes" : "no"}`);
  if (a.log !== undefined) {
    updates.push(`log=${a.log ? "yes" : "no"}`);
    if (a.log && a.log_prefix) updates.push(`log-prefix=${quoteValue(a.log_prefix)}`);
  }

  if (updates.length === 0) return "No updates specified.";

  const cmd = `/ip firewall nat set ${a.rule_id} ${updates.join(" ")}`;
  const result = await executeMikrotikCommand(cmd, ctx);
  if (looksLikeError(result)) return `Failed to update NAT rule: ${result}`;

  const details = await executeMikrotikCommand(
    `/ip firewall nat print detail where .id=${a.rule_id}`,
    ctx,
  );
  return `NAT rule updated successfully:\n\n${details}`;
}

export const firewallNatTools: ToolModule = [
  defineTool({
    name: "create_nat_rule",
    title: "Create IPv4 Firewall NAT Rule",
    annotations: WRITE,
    description:
      "Creates an IPv4 NAT rule (`/ip firewall nat add`) — the address-translation table for outbound masquerade or source NAT (chain=srcnat: actions masquerade, src-nat, netmap, same) and for port-forwarding or destination NAT (chain=dstnat: actions dst-nat, redirect, netmap, same). " +
      "For accept/drop/reject packet filtering use create_filter_rule; for IPv6 NAT use create_ipv6_nat_rule. " +
      "Returns the created rule's detail including its `.id`. " +
      'to_addresses: single IP or range e.g. "10.0.0.1" or "10.0.0.1-10.0.0.10". ' +
      'to_ports: single port or range e.g. "8080" or "8080-8090". ' +
      'place_before: rule number or ID (*N) to insert before e.g. "0" or "*3".',
    inputSchema: {
      chain: z.enum(["srcnat", "dstnat"]),
      action: z.string(),
      src_address: z.string().optional(),
      dst_address: z.string().optional(),
      src_port: z.string().optional(),
      dst_port: z.string().optional(),
      protocol: z.string().optional(),
      in_interface: z.string().optional(),
      out_interface: z.string().optional(),
      to_addresses: z
        .string()
        .optional()
        .describe('Single IP or range e.g. "10.0.0.1" or "10.0.0.1-10.0.0.10"'),
      to_ports: z.string().optional().describe('Single port or range e.g. "8080" or "8080-8090"'),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
      log: z.boolean().default(false),
      log_prefix: z.string().optional(),
      place_before: z
        .string()
        .optional()
        .describe('Rule number or ID (*N) to insert before e.g. "0" or "*3"'),
    },
    async handler(a, ctx) {
      ctx.info(`Creating NAT rule: chain=${a.chain}, action=${a.action}`);

      // Validate action based on chain
      const srcnatActions = [
        "accept",
        "drop",
        "masquerade",
        "src-nat",
        "same",
        "netmap",
        "jump",
        "return",
        "log",
        "passthrough",
      ];
      const dstnatActions = [
        "accept",
        "drop",
        "dst-nat",
        "jump",
        "return",
        "log",
        "passthrough",
        "redirect",
        "netmap",
        "same",
      ];

      if (a.chain === "srcnat" && !srcnatActions.includes(a.action)) {
        return `Error: Invalid action '${a.action}' for srcnat. Must be one of: ${srcnatActions.join(", ")}`;
      } else if (a.chain === "dstnat" && !dstnatActions.includes(a.action)) {
        return `Error: Invalid action '${a.action}' for dstnat. Must be one of: ${dstnatActions.join(", ")}`;
      }

      const cmd = new Cmd("/ip firewall nat add")
        .set("chain", a.chain)
        .set("action", a.action)
        .opt("src-address", a.src_address)
        .opt("dst-address", a.dst_address)
        .opt("src-port", a.src_port)
        .opt("dst-port", a.dst_port)
        .opt("protocol", a.protocol)
        .opt("in-interface", a.in_interface)
        .opt("out-interface", a.out_interface)
        .opt("to-addresses", a.to_addresses)
        .opt("to-ports", a.to_ports)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .flag("log", a.log)
        .opt("log-prefix", a.log ? a.log_prefix : undefined)
        .opt("place-before", a.place_before)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);

      const trimmed = result.trim();

      // A device error (e.g. a bad place-before) — surface it, never "created".
      if (looksLikeError(trimmed)) {
        const hint = placeBeforeError(trimmed, a.place_before);
        return `Failed to create NAT rule: ${hint ?? trimmed}`;
      }

      // RouterOS echoes the new rule's .id on success. Read it back by that id
      // (extracted as a clean token); if the read-back can't return the record,
      // still report success — the rule was created.
      const createdId = extractCreatedId(trimmed);
      if (createdId) {
        const details = await executeMikrotikCommand(
          `/ip firewall nat print detail where .id=${createdId}`,
          ctx,
        );
        return readBackUnavailable(details)
          ? `NAT rule created (id ${createdId}).`
          : `NAT rule created successfully:\n\n${details}`;
      }

      // No id echoed — verify by fetching the last rule.
      const count = await executeMikrotikCommand("/ip firewall nat print detail count-only", ctx);
      const c = count.trim();
      if (isDigits(c) && Number.parseInt(c, 10) > 0) {
        const details = await executeMikrotikCommand(
          `/ip firewall nat print detail from=${Number.parseInt(c, 10) - 1}`,
          ctx,
        );
        return `NAT rule created successfully:\n\n${details}`;
      }
      return "NAT rule creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_nat_rules",
    title: "List IPv4 Firewall NAT Rules",
    annotations: READ,
    description:
      "Lists IPv4 NAT rules (`/ip firewall nat print`) — returns all srcnat and dstnat rules, optionally filtered by chain, action, address, protocol, or interface. " +
      "Use the returned `.id` values with get_nat_rule, update_nat_rule, move_nat_rule, enable_nat_rule, disable_nat_rule, and remove_nat_rule. " +
      "For IPv6 NAT rules use list_ipv6_nat_rules; for IPv4 filter rules use list_filter_rules.",
    inputSchema: {
      chain_filter: z.string().optional(),
      action_filter: z.string().optional(),
      src_address_filter: z.string().optional(),
      dst_address_filter: z.string().optional(),
      protocol_filter: z.string().optional(),
      interface_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      invalid_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Listing NAT rules with filters: chain=${a.chain_filter}, action=${a.action_filter}`,
      );

      const filters: string[] = [];
      if (a.chain_filter) filters.push(`chain=${a.chain_filter}`);
      if (a.action_filter) filters.push(`action=${a.action_filter}`);
      if (a.src_address_filter) filters.push(`src-address~"${a.src_address_filter}"`);
      if (a.dst_address_filter) filters.push(`dst-address~"${a.dst_address_filter}"`);
      if (a.protocol_filter) filters.push(`protocol=${a.protocol_filter}`);
      if (a.interface_filter) {
        filters.push(
          `(in-interface~"${a.interface_filter}" or out-interface~"${a.interface_filter}")`,
        );
      }
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.invalid_only) filters.push("invalid=yes");

      const result = await executeMikrotikCommand(
        `/ip firewall nat print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No NAT rules found matching the criteria."
        : `NAT RULES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_nat_rule",
    title: "Get IPv4 Firewall NAT Rule Details",
    annotations: READ,
    description:
      "Fetches full detail for a single IPv4 NAT rule (`/ip firewall nat print detail where .id=<rule_id>`). " +
      "Returns chain, action, address matchers, port matchers, to-addresses, to-ports, and rule flags for that rule. " +
      'rule_id takes the `.id` from list_nat_rules e.g. "*1" or "0". ' +
      "To list all rules use list_nat_rules; for IPv6 NAT use get_ipv6_nat_rule.",
    inputSchema: {
      rule_id: z.string().describe('Rule ID from list output e.g. "*1" or "0"'),
    },
    async handler(a, ctx) {
      ctx.info(`Getting NAT rule details: rule_id=${a.rule_id}`);
      const result = await executeMikrotikCommand(
        `/ip firewall nat print detail where .id=${a.rule_id}`,
        ctx,
      );
      return isEmpty(result)
        ? `NAT rule with ID '${a.rule_id}' not found.`
        : `NAT RULE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_nat_rule",
    title: "Update IPv4 Firewall NAT Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Modifies fields of an existing IPv4 NAT rule (`/ip firewall nat set`) without recreating it. " +
      'rule_id takes the `.id` from list_nat_rules e.g. "*1" or "0"; returns the updated rule\'s full detail. ' +
      "For IPv6 NAT use update_ipv6_nat_rule; to toggle enabled state only use enable_nat_rule or disable_nat_rule. " +
      'to_addresses: single IP or range e.g. "10.0.0.1" or "10.0.0.1-10.0.0.10". ' +
      'to_ports: single port or range e.g. "8080" or "8080-8090". ' +
      'Pass "" to clear an optional field.',
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
      to_addresses: z.string().optional(),
      to_ports: z.string().optional(),
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
    name: "remove_nat_rule",
    title: "Remove IPv4 Firewall NAT Rule",
    annotations: DESTRUCTIVE,
    description:
      "Permanently deletes an IPv4 NAT rule (`/ip firewall nat remove`). " +
      "Verifies existence with a count-only check before deleting; returns an error if the rule is not found. " +
      'rule_id takes the `.id` from list_nat_rules e.g. "*1" or "0". ' +
      "To disable without deleting use disable_nat_rule; for IPv6 NAT use remove_ipv6_nat_rule.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing NAT rule: rule_id=${a.rule_id}`);

      const count = await executeMikrotikCommand(
        `/ip firewall nat print count-only where .id=${a.rule_id}`,
        ctx,
      );
      if (count.trim() === "0") return `NAT rule with ID '${a.rule_id}' not found.`;

      const result = await executeMikrotikCommand(`/ip firewall nat remove ${a.rule_id}`, ctx);
      if (looksLikeError(result)) return `Failed to remove NAT rule: ${result}`;
      return `NAT rule with ID '${a.rule_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "move_nat_rule",
    title: "Move IPv4 Firewall NAT Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Reorders an IPv4 NAT rule within the NAT chain (`/ip firewall nat move`). " +
      "NAT rules are evaluated top to bottom and the first match wins, so position matters. " +
      'rule_id takes the `.id` from list_nat_rules e.g. "*1" or "0"; destination is the 0-based target position index. ' +
      "For filter rule reordering use move_filter_rule; for IPv6 NAT reordering use move_ipv6_nat_rule.",
    inputSchema: {
      rule_id: z.string(),
      destination: z.number().int().describe("0-based target position index"),
    },
    async handler(a, ctx) {
      ctx.info(`Moving NAT rule: rule_id=${a.rule_id} to position ${a.destination}`);

      const count = await executeMikrotikCommand(
        `/ip firewall nat print count-only where .id=${a.rule_id}`,
        ctx,
      );
      if (count.trim() === "0") return `NAT rule with ID '${a.rule_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/ip firewall nat move ${a.rule_id} destination=${a.destination}`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to move NAT rule: ${result}`;
      return `NAT rule with ID '${a.rule_id}' moved to position ${a.destination}.`;
    },
  }),

  defineTool({
    name: "enable_nat_rule",
    title: "Enable IPv4 Firewall NAT Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Re-enables a disabled IPv4 NAT rule (`/ip firewall nat set disabled=no`). " +
      'rule_id takes the `.id` from list_nat_rules e.g. "*1" or "0"; returns the updated rule detail. ' +
      "To disable use disable_nat_rule; to edit other fields use update_nat_rule; for IPv6 NAT use enable_ipv6_nat_rule.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateNatRule({ rule_id: a.rule_id, disabled: false }, ctx);
    },
  }),

  defineTool({
    name: "disable_nat_rule",
    title: "Disable IPv4 Firewall NAT Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Disables an active IPv4 NAT rule without removing it (`/ip firewall nat set disabled=yes`). " +
      'rule_id takes the `.id` from list_nat_rules e.g. "*1" or "0"; returns the updated rule detail after disabling. ' +
      "To re-enable use enable_nat_rule; to permanently delete use remove_nat_rule; for IPv6 NAT use disable_ipv6_nat_rule.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateNatRule({ rule_id: a.rule_id, disabled: true }, ctx);
    },
  }),
];
