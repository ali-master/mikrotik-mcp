/** Firewall filter rules — `/ip firewall filter`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import {
  WRITE_IDEMPOTENT,
  WRITE,
  READ,
  DESTRUCTIVE,
  defineTool,
  DANGEROUS,
} from "../core/registry";
import type { ToolModule } from "../core/registry";
import {
  whereClause,
  quoteValue,
  looksLikeError,
  isEmpty,
  Cmd,
} from "../core/routeros";
import type { ToolContext } from "../core/context";

const isDigits = (s: string): boolean => /^\d+$/.test(s);

/** Shared update routine — used by update/enable/disable (mirrors the Python delegation). */
async function updateFilterRule(
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
    connection_state?: string;
    connection_nat_state?: string;
    src_address_list?: string;
    dst_address_list?: string;
    limit?: string;
    tcp_flags?: string;
    comment?: string;
    disabled?: boolean;
    log?: boolean;
    log_prefix?: string;
  },
  ctx: ToolContext,
): Promise<string> {
  ctx.info(`Updating firewall filter rule: rule_id=${a.rule_id}`);

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
  put("connection-state", a.connection_state);
  put("connection-nat-state", a.connection_nat_state);
  put("src-address-list", a.src_address_list);
  put("dst-address-list", a.dst_address_list);
  put("limit", a.limit);
  put("tcp-flags", a.tcp_flags);
  if (a.comment !== undefined) updates.push(`comment=${quoteValue(a.comment)}`);
  if (a.disabled !== undefined)
    updates.push(`disabled=${a.disabled ? "yes" : "no"}`);
  if (a.log !== undefined) {
    updates.push(`log=${a.log ? "yes" : "no"}`);
    if (a.log && a.log_prefix)
      updates.push(`log-prefix=${quoteValue(a.log_prefix)}`);
  }

  if (updates.length === 0) return "No updates specified.";

  const cmd = `/ip firewall filter set ${a.rule_id} ${updates.join(" ")}`;
  const result = await executeMikrotikCommand(cmd, ctx);
  if (looksLikeError(result))
    return `Failed to update firewall filter rule: ${result}`;

  const details = await executeMikrotikCommand(
    `/ip firewall filter print detail where .id=${a.rule_id}`,
    ctx,
  );
  return `Firewall filter rule updated successfully:\n\n${details}`;
}

export const firewallFilterTools: ToolModule = [
  defineTool({
    name: "create_filter_rule",
    title: "Create Firewall Filter Rule",
    annotations: WRITE,
    description:
      "Creates a firewall filter rule in the specified chain on the MikroTik device. " +
      'connection_state: comma-separated e.g. "established,related,new,invalid". ' +
      'limit: RouterOS rate/burst string e.g. "10,5:packet" or "10/1s:packet". ' +
      'tcp_flags: RouterOS flag expression e.g. "syn,!ack". ' +
      'place_before: rule number or ID (*N) to insert before e.g. "0" or "*3".',
    inputSchema: {
      chain: z.enum(["input", "forward", "output"]),
      action: z.enum([
        "accept",
        "drop",
        "reject",
        "jump",
        "log",
        "passthrough",
        "return",
        "tarpit",
        "fasttrack-connection",
      ]),
      src_address: z.string().optional(),
      dst_address: z.string().optional(),
      src_port: z.string().optional(),
      dst_port: z.string().optional(),
      protocol: z.string().optional(),
      in_interface: z.string().optional(),
      out_interface: z.string().optional(),
      connection_state: z
        .string()
        .optional()
        .describe('Comma-separated e.g. "established,related,new,invalid"'),
      connection_nat_state: z.string().optional(),
      src_address_list: z.string().optional(),
      dst_address_list: z.string().optional(),
      limit: z
        .string()
        .optional()
        .describe('RouterOS rate/burst string e.g. "10,5:packet"'),
      tcp_flags: z
        .string()
        .optional()
        .describe('RouterOS flag expression e.g. "syn,!ack"'),
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
      ctx.info(
        `Creating firewall filter rule: chain=${a.chain}, action=${a.action}`,
      );

      const cmd = new Cmd("/ip firewall filter add")
        .set("chain", a.chain)
        .set("action", a.action)
        .opt("src-address", a.src_address)
        .opt("dst-address", a.dst_address)
        .opt("src-port", a.src_port)
        .opt("dst-port", a.dst_port)
        .opt("protocol", a.protocol)
        .opt("in-interface", a.in_interface)
        .opt("out-interface", a.out_interface)
        .opt("connection-state", a.connection_state)
        .opt("connection-nat-state", a.connection_nat_state)
        .opt("src-address-list", a.src_address_list)
        .opt("dst-address-list", a.dst_address_list)
        .opt("limit", a.limit)
        .opt("tcp-flags", a.tcp_flags)
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
            `/ip firewall filter print detail where .id=${trimmed}`,
            ctx,
          );
          return details.trim()
            ? `Firewall filter rule created successfully:\n\n${details}`
            : `Firewall filter rule created with ID: ${result}`;
        }
        return `Failed to create firewall filter rule: ${result}`;
      }

      // No output might mean success — verify by fetching the last rule.
      const count = await executeMikrotikCommand(
        "/ip firewall filter print detail count-only",
        ctx,
      );
      const c = count.trim();
      if (isDigits(c) && Number.parseInt(c, 10) > 0) {
        const details = await executeMikrotikCommand(
          `/ip firewall filter print detail from=${Number.parseInt(c, 10) - 1}`,
          ctx,
        );
        return `Firewall filter rule created successfully:\n\n${details}`;
      }
      return "Firewall filter rule creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_filter_rules",
    title: "List Firewall Filter Rules",
    annotations: READ,
    description: "Lists firewall filter rules on the MikroTik device.",
    inputSchema: {
      chain_filter: z.string().optional(),
      action_filter: z.string().optional(),
      src_address_filter: z.string().optional(),
      dst_address_filter: z.string().optional(),
      protocol_filter: z.string().optional(),
      interface_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      invalid_only: z.boolean().default(false),
      dynamic_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Listing firewall filter rules with filters: chain=${a.chain_filter}, action=${a.action_filter}`,
      );

      const filters: string[] = [];
      if (a.chain_filter) filters.push(`chain=${a.chain_filter}`);
      if (a.action_filter) filters.push(`action=${a.action_filter}`);
      if (a.src_address_filter)
        filters.push(`src-address~"${a.src_address_filter}"`);
      if (a.dst_address_filter)
        filters.push(`dst-address~"${a.dst_address_filter}"`);
      if (a.protocol_filter) filters.push(`protocol=${a.protocol_filter}`);
      if (a.interface_filter) {
        filters.push(
          `(in-interface~"${a.interface_filter}" or out-interface~"${a.interface_filter}")`,
        );
      }
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.invalid_only) filters.push("invalid=yes");
      if (a.dynamic_only) filters.push("dynamic=yes");

      const result = await executeMikrotikCommand(
        `/ip firewall filter print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No firewall filter rules found matching the criteria."
        : `FIREWALL FILTER RULES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_filter_rule",
    title: "Get Firewall Filter Rule",
    annotations: READ,
    description:
      "Gets detailed information about a specific firewall filter rule. " +
      'rule_id: use the ID from list output e.g. "*1" or "0".',
    inputSchema: {
      rule_id: z.string().describe('Rule ID from list output e.g. "*1" or "0"'),
    },
    async handler(a, ctx) {
      ctx.info(`Getting firewall filter rule details: rule_id=${a.rule_id}`);
      const result = await executeMikrotikCommand(
        `/ip firewall filter print detail where .id=${a.rule_id}`,
        ctx,
      );
      return isEmpty(result)
        ? `Firewall filter rule with ID '${a.rule_id}' not found.`
        : `FIREWALL FILTER RULE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_filter_rule",
    title: "Update Firewall Filter Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates an existing firewall filter rule on the MikroTik device. " +
      'rule_id: use the ID from list output e.g. "*1" or "0". ' +
      'connection_state: comma-separated e.g. "established,related". ' +
      'limit: RouterOS rate string e.g. "10,5:packet". ' +
      'tcp_flags: RouterOS flag expression e.g. "syn,!ack". ' +
      'Pass "" to clear an optional field (e.g. src_address="").',
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
      connection_state: z.string().optional(),
      connection_nat_state: z.string().optional(),
      src_address_list: z.string().optional(),
      dst_address_list: z.string().optional(),
      limit: z.string().optional(),
      tcp_flags: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
      log: z.boolean().optional(),
      log_prefix: z.string().optional(),
    },
    async handler(a, ctx) {
      return updateFilterRule(a, ctx);
    },
  }),

  defineTool({
    name: "remove_filter_rule",
    title: "Remove Firewall Filter Rule",
    annotations: DESTRUCTIVE,
    description:
      "Removes a firewall filter rule from the MikroTik device. " +
      'rule_id: use the ID from list output e.g. "*1" or "0".',
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing firewall filter rule: rule_id=${a.rule_id}`);

      const count = await executeMikrotikCommand(
        `/ip firewall filter print count-only where .id=${a.rule_id}`,
        ctx,
      );
      if (count.trim() === "0")
        return `Firewall filter rule with ID '${a.rule_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/ip firewall filter remove ${a.rule_id}`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove firewall filter rule: ${result}`;
      return `Firewall filter rule with ID '${a.rule_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "move_filter_rule",
    title: "Move Filter Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Moves a firewall filter rule to a different position in the chain. " +
      'rule_id: use the ID from list output e.g. "*1" or "0". ' +
      "destination: 0-based target position index.",
    inputSchema: {
      rule_id: z.string(),
      destination: z.number().int().describe("0-based target position index"),
    },
    async handler(a, ctx) {
      ctx.info(
        `Moving firewall filter rule: rule_id=${a.rule_id} to position ${a.destination}`,
      );

      const count = await executeMikrotikCommand(
        `/ip firewall filter print count-only where .id=${a.rule_id}`,
        ctx,
      );
      if (count.trim() === "0")
        return `Firewall filter rule with ID '${a.rule_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/ip firewall filter move ${a.rule_id} destination=${a.destination}`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to move firewall filter rule: ${result}`;
      return `Firewall filter rule with ID '${a.rule_id}' moved to position ${a.destination}.`;
    },
  }),

  defineTool({
    name: "enable_filter_rule",
    title: "Enable Filter Rule",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a firewall filter rule.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateFilterRule({ rule_id: a.rule_id, disabled: false }, ctx);
    },
  }),

  defineTool({
    name: "disable_filter_rule",
    title: "Disable Filter Rule",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a firewall filter rule.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateFilterRule({ rule_id: a.rule_id, disabled: true }, ctx);
    },
  }),

  defineTool({
    name: "create_basic_firewall_setup",
    title: "Create Basic Firewall Setup",
    annotations: DANGEROUS,
    description:
      "Creates a basic firewall setup with common security rules on the MikroTik device.",
    async handler(_a, ctx) {
      ctx.info("Creating basic firewall setup");

      const results: string[] = [];

      // Allow established and related connections
      const r1 = await executeMikrotikCommand(
        '/ip firewall filter add chain=input action=accept connection-state=established,related comment="Accept established,related"',
        ctx,
      );
      results.push(
        `Rule 1 (established/related): ${!r1 || r1.includes("*") ? "Created" : r1}`,
      );

      // Drop invalid connections
      const r2 = await executeMikrotikCommand(
        '/ip firewall filter add chain=input action=drop connection-state=invalid comment="Drop invalid"',
        ctx,
      );
      results.push(
        `Rule 2 (drop invalid): ${!r2 || r2.includes("*") ? "Created" : r2}`,
      );

      // Allow ICMP
      const r3 = await executeMikrotikCommand(
        '/ip firewall filter add chain=input action=accept protocol=icmp comment="Accept ICMP"',
        ctx,
      );
      results.push(
        `Rule 3 (ICMP): ${!r3 || r3.includes("*") ? "Created" : r3}`,
      );

      // Allow management from specific network
      const r4 = await executeMikrotikCommand(
        '/ip firewall filter add chain=input action=accept src-address=192.168.88.0/24 comment="Accept management network"',
        ctx,
      );
      results.push(
        `Rule 4 (management network): ${!r4 || r4.includes("*") ? "Created" : r4}`,
      );

      // Drop everything else
      const r5 = await executeMikrotikCommand(
        '/ip firewall filter add chain=input action=drop comment="Drop everything else"',
        ctx,
      );
      results.push(
        `Rule 5 (drop all): ${!r5 || r5.includes("*") ? "Created" : r5}`,
      );

      return `BASIC FIREWALL SETUP RESULTS:\n\n${results.join("\n")}`;
    },
  }),
];
