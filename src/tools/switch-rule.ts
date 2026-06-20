/** Switch chip ACL/redirect rules — `/interface ethernet switch rule`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import {
  WRITE_IDEMPOTENT,
  WRITE,
  READ,
  DESTRUCTIVE,
  defineTool,
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

interface SwitchRuleArgs {
  rule_id?: string;
  switch?: string;
  ports?: string;
  src_address?: string;
  dst_address?: string;
  src_mac_address?: string;
  dst_mac_address?: string;
  src_port?: string;
  dst_port?: string;
  protocol?: string;
  mac_protocol?: string;
  vlan_id?: string;
  vlan_priority?: string;
  dscp?: string;
  flow_label?: string;
  new_dst_ports?: string;
  new_vlan_id?: string;
  new_vlan_priority?: string;
  redirect_to_cpu?: boolean;
  copy_to_cpu?: boolean;
  mirror?: boolean;
  rate?: string;
  comment?: string;
  disabled?: boolean;
}

async function updateSwitchRule(
  a: SwitchRuleArgs & { rule_id: string },
  ctx: ToolContext,
): Promise<string> {
  ctx.info(`Updating switch rule: rule_id=${a.rule_id}`);

  const updates: string[] = [];
  const put = (key: string, val: string | undefined): void => {
    if (val === undefined) return;
    updates.push(val === "" ? `!${key}` : `${key}=${quoteValue(val)}`);
  };
  const putBool = (key: string, val: boolean | undefined): void => {
    if (val !== undefined) updates.push(`${key}=${val ? "yes" : "no"}`);
  };

  if (a.switch) updates.push(`switch=${quoteValue(a.switch)}`);
  put("ports", a.ports);
  put("src-address", a.src_address);
  put("dst-address", a.dst_address);
  put("src-mac-address", a.src_mac_address);
  put("dst-mac-address", a.dst_mac_address);
  put("src-port", a.src_port);
  put("dst-port", a.dst_port);
  put("protocol", a.protocol);
  put("mac-protocol", a.mac_protocol);
  put("vlan-id", a.vlan_id);
  put("vlan-priority", a.vlan_priority);
  put("dscp", a.dscp);
  put("flow-label", a.flow_label);
  put("new-dst-ports", a.new_dst_ports);
  put("new-vlan-id", a.new_vlan_id);
  put("new-vlan-priority", a.new_vlan_priority);
  putBool("redirect-to-cpu", a.redirect_to_cpu);
  putBool("copy-to-cpu", a.copy_to_cpu);
  putBool("mirror", a.mirror);
  put("rate", a.rate);
  if (a.comment !== undefined) updates.push(`comment=${quoteValue(a.comment)}`);
  putBool("disabled", a.disabled);

  if (updates.length === 0) return "No updates specified.";

  const cmd = `/interface ethernet switch rule set ${a.rule_id} ${updates.join(" ")}`;
  const result = await executeMikrotikCommand(cmd, ctx);
  if (looksLikeError(result)) return `Failed to update switch rule: ${result}`;

  const details = await executeMikrotikCommand(
    `/interface ethernet switch rule print detail where .id=${a.rule_id}`,
    ctx,
  );
  return `Switch rule updated successfully:\n\n${details}`;
}

export const switchRuleTools: ToolModule = [
  defineTool({
    name: "add_switch_rule",
    title: "Add Switch Rule",
    annotations: WRITE,
    description:
      "Adds a switch ACL/redirect rule on the MikroTik device " +
      "(`/interface ethernet switch rule`). Rules match traffic in hardware on " +
      "the listed source ports and apply an action.\n\n" +
      "Notes:\n" +
      "    switch: the switch chip the rule belongs to, e.g. 'switch1'.\n" +
      "    ports: comma-separated source ports the rule matches on.\n" +
      "    new_dst_ports: redirect matched traffic to these ports; set to an\n" +
      "        empty string to drop.\n" +
      "    redirect_to_cpu / copy_to_cpu / mirror: divert, duplicate or span\n" +
      "        matched traffic.",
    inputSchema: {
      switch: z.string().describe("Owning switch chip, e.g. 'switch1'"),
      ports: z.string().describe("Comma-separated source ports the rule matches"),
      src_address: z.string().optional().describe("Source IP/mask"),
      dst_address: z.string().optional().describe("Destination IP/mask"),
      src_mac_address: z.string().optional().describe("Source MAC/mask"),
      dst_mac_address: z.string().optional().describe("Destination MAC/mask"),
      src_port: z.string().optional().describe("Layer-4 source port(s)"),
      dst_port: z.string().optional().describe("Layer-4 destination port(s)"),
      protocol: z.string().optional().describe("IP protocol, e.g. 'tcp'"),
      mac_protocol: z
        .string()
        .optional()
        .describe("MAC protocol, e.g. 'ip', 'arp', 'vlan' or a number"),
      vlan_id: z.string().optional(),
      vlan_priority: z.string().optional(),
      dscp: z.string().optional(),
      flow_label: z.string().optional().describe("IPv6 flow label"),
      new_dst_ports: z
        .string()
        .optional()
        .describe("Redirect target ports; empty string drops the traffic"),
      new_vlan_id: z.string().optional(),
      new_vlan_priority: z.string().optional(),
      redirect_to_cpu: z.boolean().optional(),
      copy_to_cpu: z.boolean().optional(),
      mirror: z.boolean().optional(),
      rate: z.string().optional().describe("Rate limit in bits/second"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding switch rule: switch=${a.switch}, ports=${a.ports}`);
      const cmd = new Cmd("/interface ethernet switch rule add")
        .set("switch", a.switch)
        .set("ports", a.ports)
        .opt("src-address", a.src_address)
        .opt("dst-address", a.dst_address)
        .opt("src-mac-address", a.src_mac_address)
        .opt("dst-mac-address", a.dst_mac_address)
        .opt("src-port", a.src_port)
        .opt("dst-port", a.dst_port)
        .opt("protocol", a.protocol)
        .opt("mac-protocol", a.mac_protocol)
        .opt("vlan-id", a.vlan_id)
        .opt("vlan-priority", a.vlan_priority)
        .opt("dscp", a.dscp)
        .opt("flow-label", a.flow_label)
        .opt("new-dst-ports", a.new_dst_ports)
        .opt("new-vlan-id", a.new_vlan_id)
        .opt("new-vlan-priority", a.new_vlan_priority)
        .bool("redirect-to-cpu", a.redirect_to_cpu)
        .bool("copy-to-cpu", a.copy_to_cpu)
        .bool("mirror", a.mirror)
        .opt("rate", a.rate)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);

      if (result.trim()) {
        const trimmed = result.trim();
        if (trimmed.includes("*") || isDigits(trimmed)) {
          const details = await executeMikrotikCommand(
            `/interface ethernet switch rule print detail where .id=${trimmed}`,
            ctx,
          );
          return details.trim()
            ? `Switch rule added successfully:\n\n${details}`
            : `Switch rule added with ID: ${result}`;
        }
        return `Failed to add switch rule: ${result}`;
      }

      const count = await executeMikrotikCommand(
        "/interface ethernet switch rule print detail count-only",
        ctx,
      );
      const c = count.trim();
      if (isDigits(c) && Number.parseInt(c, 10) > 0) {
        const details = await executeMikrotikCommand(
          `/interface ethernet switch rule print detail from=${Number.parseInt(c, 10) - 1}`,
          ctx,
        );
        return `Switch rule added successfully:\n\n${details}`;
      }
      return "Switch rule addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_switch_rules",
    title: "List Switch Rules",
    annotations: READ,
    description: "Lists switch ACL/redirect rules on the MikroTik device.",
    inputSchema: {
      switch_filter: z.string().optional(),
      ports_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing switch rules");
      const filters: string[] = [];
      if (a.switch_filter) filters.push(`switch="${a.switch_filter}"`);
      if (a.ports_filter) filters.push(`ports~"${a.ports_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");

      const result = await executeMikrotikCommand(
        `/interface ethernet switch rule print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No switch rules found matching the criteria."
        : `SWITCH RULES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_switch_rule",
    title: "Get Switch Rule",
    annotations: READ,
    description: "Gets a specific switch rule by '.id'.",
    inputSchema: {
      rule_id: z.string().describe("RouterOS '.id', e.g. '*1' or '0'"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting switch rule: rule_id=${a.rule_id}`);
      const result = await executeMikrotikCommand(
        `/interface ethernet switch rule print detail where .id=${a.rule_id}`,
        ctx,
      );
      return isEmpty(result)
        ? `Switch rule '${a.rule_id}' not found.`
        : `SWITCH RULE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_switch_rule",
    title: "Update Switch Rule",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates an existing switch rule on the MikroTik device. " +
      'Pass "" to clear an optional matcher/action field.',
    inputSchema: {
      rule_id: z.string(),
      switch: z.string().optional(),
      ports: z.string().optional(),
      src_address: z.string().optional(),
      dst_address: z.string().optional(),
      src_mac_address: z.string().optional(),
      dst_mac_address: z.string().optional(),
      src_port: z.string().optional(),
      dst_port: z.string().optional(),
      protocol: z.string().optional(),
      mac_protocol: z.string().optional(),
      vlan_id: z.string().optional(),
      vlan_priority: z.string().optional(),
      dscp: z.string().optional(),
      flow_label: z.string().optional(),
      new_dst_ports: z.string().optional(),
      new_vlan_id: z.string().optional(),
      new_vlan_priority: z.string().optional(),
      redirect_to_cpu: z.boolean().optional(),
      copy_to_cpu: z.boolean().optional(),
      mirror: z.boolean().optional(),
      rate: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      return updateSwitchRule(a, ctx);
    },
  }),

  defineTool({
    name: "remove_switch_rule",
    title: "Remove Switch Rule",
    annotations: DESTRUCTIVE,
    description: "Removes a switch rule by '.id' from the MikroTik device.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing switch rule: rule_id=${a.rule_id}`);
      const count = await executeMikrotikCommand(
        `/interface ethernet switch rule print count-only where .id=${a.rule_id}`,
        ctx,
      );
      if (count.trim() === "0") return `Switch rule '${a.rule_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface ethernet switch rule remove ${a.rule_id}`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove switch rule: ${result}`;
      return `Switch rule '${a.rule_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_switch_rule",
    title: "Enable Switch Rule",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a switch rule by '.id'.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateSwitchRule({ rule_id: a.rule_id, disabled: false }, ctx);
    },
  }),

  defineTool({
    name: "disable_switch_rule",
    title: "Disable Switch Rule",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a switch rule by '.id'.",
    inputSchema: { rule_id: z.string() },
    async handler(a, ctx) {
      return updateSwitchRule({ rule_id: a.rule_id, disabled: true }, ctx);
    },
  }),
];
