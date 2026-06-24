/**
 * Bridges — `/interface bridge`.
 *
 * Bridge CRUD plus the three child tables RouterOS hangs off a bridge: ports
 * (`/interface bridge port`), the learned MAC table (`/interface bridge host`),
 * and the VLAN table (`/interface bridge vlan`). Follows the canonical
 * tool-module pattern from `vlan.ts`.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

const ProtocolMode = z.enum(["none", "rstp", "stp", "mstp"]);

export const bridgeTools: ToolModule = [
  defineTool({
    name: "create_bridge",
    title: "Create Bridge",
    annotations: WRITE,
    description: "Creates a bridge interface on the MikroTik device.",
    inputSchema: {
      name: z.string().describe("Name for the new bridge, e.g. 'bridge1'"),
      comment: z.string().optional(),
      vlan_filtering: z
        .boolean()
        .default(false)
        .describe("Enable 802.1Q VLAN filtering on the bridge"),
      protocol_mode: ProtocolMode.optional().describe("Spanning-tree protocol mode"),
      disabled: z.boolean().default(false),
      mtu: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Creating bridge: name=${a.name}, vlan_filtering=${a.vlan_filtering}`);
      const cmd = new Cmd("/interface bridge add")
        .set("name", a.name)
        .opt("comment", a.comment)
        .flag("vlan-filtering", a.vlan_filtering)
        .opt("protocol-mode", a.protocol_mode)
        .opt("mtu", a.mtu)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create bridge: ${result}`;

      const details = await executeMikrotikCommand(
        `/interface bridge print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `Bridge created successfully:\n\n${details}`
        : "Bridge creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_bridges",
    title: "List Bridges",
    annotations: READ,
    description: "Lists bridge interfaces on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing bridges");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface bridge print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result) ? "No bridges found matching the criteria." : `BRIDGES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_bridge",
    title: "Get Bridge",
    annotations: READ,
    description: "Gets detailed information about a specific bridge.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting bridge details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface bridge print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result) ? `Bridge '${a.name}' not found.` : `BRIDGE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_bridge",
    title: "Update Bridge",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates an existing bridge's settings on the MikroTik device.",
    inputSchema: {
      name: z.string().describe("Current name of the bridge to update"),
      new_name: z.string().optional(),
      comment: z.string().optional(),
      vlan_filtering: z.boolean().optional(),
      protocol_mode: ProtocolMode.optional(),
      disabled: z.boolean().optional(),
      mtu: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating bridge: name=${a.name}`);
      const cmd = new Cmd(`/interface bridge set [find name="${a.name}"]`)
        .opt("name", a.new_name)
        .opt("comment", a.comment)
        .bool("vlan-filtering", a.vlan_filtering)
        .opt("protocol-mode", a.protocol_mode)
        .bool("disabled", a.disabled)
        .opt("mtu", a.mtu)
        .build();

      // No updates were supplied -> the command would just be the `set [find ...]` stem.
      if (!cmd.includes("=", cmd.indexOf("]"))) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update bridge: ${result}`;

      const target = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(
        `/interface bridge print detail where name="${target}"`,
        ctx,
      );
      return `Bridge updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_bridge",
    title: "Remove Bridge",
    annotations: DESTRUCTIVE,
    description: "Removes a bridge interface from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing bridge: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/interface bridge print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `Bridge '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface bridge remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove bridge: ${result}`;
      return `Bridge '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "add_bridge_port",
    title: "Add Bridge Port",
    annotations: WRITE,
    description: "Adds an interface as a port to a bridge on the MikroTik device.",
    inputSchema: {
      bridge: z.string().describe("Bridge to add the port to"),
      interface: z.string().describe("Interface to enslave to the bridge"),
      pvid: z
        .number()
        .int()
        .min(1)
        .max(4094)
        .optional()
        .describe("Port VLAN ID for untagged ingress"),
      comment: z.string().optional(),
      hw: z.boolean().optional().describe("Use hardware offload for this port"),
    },
    async handler(a, ctx) {
      ctx.info(`Adding bridge port: bridge=${a.bridge}, interface=${a.interface}`);
      const cmd = new Cmd("/interface bridge port add")
        .set("bridge", a.bridge)
        .set("interface", a.interface)
        .opt("pvid", a.pvid)
        .opt("comment", a.comment)
        .bool("hw", a.hw)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add bridge port: ${result}`;

      const details = await executeMikrotikCommand(
        `/interface bridge port print detail where interface="${a.interface}"`,
        ctx,
      );
      return details.trim()
        ? `Bridge port added successfully:\n\n${details}`
        : "Bridge port addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_bridge_ports",
    title: "List Bridge Ports",
    annotations: READ,
    description: "Lists bridge ports on the MikroTik device.",
    inputSchema: {
      bridge_filter: z.string().optional().describe("Exact bridge name"),
      interface_filter: z.string().optional().describe("Exact interface name"),
    },
    async handler(a, ctx) {
      ctx.info("Listing bridge ports");
      const filters: string[] = [];
      if (a.bridge_filter) filters.push(`bridge="${a.bridge_filter}"`);
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface bridge port print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No bridge ports found matching the criteria."
        : `BRIDGE PORTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_bridge_port",
    title: "Remove Bridge Port",
    annotations: DESTRUCTIVE,
    description: "Removes a port (interface) from its bridge on the MikroTik device.",
    inputSchema: {
      interface: z.string().describe("Interface to remove from the bridge"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing bridge port: interface=${a.interface}`);
      const count = await executeMikrotikCommand(
        `/interface bridge port print count-only where interface="${a.interface}"`,
        ctx,
      );
      if (count.trim() === "0") return `Bridge port for interface '${a.interface}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface bridge port remove [find interface="${a.interface}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove bridge port: ${result}`;
      return `Bridge port for interface '${a.interface}' removed successfully.`;
    },
  }),

  defineTool({
    name: "list_bridge_hosts",
    title: "List Bridge Hosts",
    annotations: READ,
    description: "Lists the bridge host (MAC address) table on the MikroTik device.",
    inputSchema: {
      bridge_filter: z.string().optional().describe("Exact bridge name"),
    },
    async handler(a, ctx) {
      ctx.info("Listing bridge hosts");
      const filters: string[] = [];
      if (a.bridge_filter) filters.push(`bridge="${a.bridge_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface bridge host print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No bridge hosts found matching the criteria."
        : `BRIDGE HOSTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_bridge_vlan",
    title: "Add Bridge VLAN",
    annotations: WRITE,
    description:
      "Adds a VLAN entry to a bridge's VLAN table (requires vlan-filtering on the bridge).",
    inputSchema: {
      bridge: z.string().describe("Bridge to add the VLAN entry to"),
      vlan_ids: z.string().describe("VLAN ID(s), e.g. '100' or '100,200'"),
      tagged: z.string().optional().describe("Comma-separated tagged interfaces"),
      untagged: z.string().optional().describe("Comma-separated untagged interfaces"),
    },
    async handler(a, ctx) {
      ctx.info(`Adding bridge VLAN: bridge=${a.bridge}, vlan_ids=${a.vlan_ids}`);
      const cmd = new Cmd("/interface bridge vlan add")
        .set("bridge", a.bridge)
        .set("vlan-ids", a.vlan_ids)
        .opt("tagged", a.tagged)
        .opt("untagged", a.untagged)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add bridge VLAN: ${result}`;
      return `Bridge VLAN '${a.vlan_ids}' added to '${a.bridge}' successfully.`;
    },
  }),

  defineTool({
    name: "list_bridge_vlans",
    title: "List Bridge VLANs",
    annotations: READ,
    description: "Lists the bridge VLAN table on the MikroTik device.",
    inputSchema: {
      bridge_filter: z.string().optional().describe("Exact bridge name"),
    },
    async handler(a, ctx) {
      ctx.info("Listing bridge VLANs");
      const filters: string[] = [];
      if (a.bridge_filter) filters.push(`bridge="${a.bridge_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface bridge vlan print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No bridge VLANs found matching the criteria."
        : `BRIDGE VLANS:\n\n${result}`;
    },
  }),
];
