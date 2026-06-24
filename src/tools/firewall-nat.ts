/** Firewall NAT rules — `/ip firewall nat`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, quoteValue, looksLikeError, isEmpty, Cmd } from "../core/routeros";
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
    title: "Create NAT Rule",
    annotations: WRITE,
    description:
      "Creates a NAT rule (srcnat or dstnat) on the MikroTik device. " +
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

      if (result.trim()) {
        const trimmed = result.trim();
        // MikroTik returns the ID of the created item on success.
        if (trimmed.includes("*") || isDigits(trimmed)) {
          const details = await executeMikrotikCommand(
            `/ip firewall nat print detail where .id=${trimmed}`,
            ctx,
          );
          return details.trim()
            ? `NAT rule created successfully:\n\n${details}`
            : `NAT rule created with ID: ${result}`;
        }
        return `Failed to create NAT rule: ${result}`;
      }

      // No output might mean success — verify by fetching the last rule.
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
    title: "List NAT Rules",
    annotations: READ,
    description: "Lists NAT rules on the MikroTik device.",
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
    title: "Get NAT Rule",
    annotations: READ,
    description:
      "Gets detailed information about a specific NAT rule. " +
      'rule_id: use the ID from list output e.g. "*1" or "0".',
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
    title: "Update NAT Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates an existing NAT rule on the MikroTik device. " +
      'rule_id: use the ID from list output e.g. "*1" or "0". ' +
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
    title: "Remove NAT Rule",
    annotations: DESTRUCTIVE,
    description:
      "Removes a NAT rule from the MikroTik device. " +
      'rule_id: use the ID from list output e.g. "*1" or "0".',
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
    title: "Move NAT Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Moves a NAT rule to a different position in the chain. " +
      'rule_id: use the ID from list output e.g. "*1" or "0". ' +
      "destination: 0-based target position index.",
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
    title: "Enable NAT Rule",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a NAT rule.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateNatRule({ rule_id: a.rule_id, disabled: false }, ctx);
    },
  }),

  defineTool({
    name: "disable_nat_rule",
    title: "Disable NAT Rule",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a NAT rule.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateNatRule({ rule_id: a.rule_id, disabled: true }, ctx);
    },
  }),
];
