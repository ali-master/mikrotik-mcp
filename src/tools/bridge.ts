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
    title: "Create Bridge Interface",
    annotations: WRITE,
    description:
      "Creates a bridge interface (`/interface bridge`) — combines multiple interfaces into a Layer-2 switch domain. " +
      "Set `vlan_filtering=true` to enable 802.1Q VLAN awareness; set `protocol_mode` for STP/RSTP/MSTP spanning-tree. " +
      "For adding a member interface to an existing bridge use `add_bridge_port`; " +
      "for standalone 802.1Q VLAN sub-interfaces use `create_vlan_interface`. " +
      "Returns the created bridge's full detail including its `.id`.",
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
    title: "List Bridge Interfaces",
    annotations: READ,
    description:
      "Lists bridge interfaces (`/interface bridge`). " +
      "Use to enumerate all bridge domains or confirm whether a named bridge exists. " +
      "For member ports enslaved to a bridge use `list_bridge_ports`; " +
      "for the VLAN membership table use `list_bridge_vlans`; " +
      "for learned MAC addresses use `list_bridge_hosts`. " +
      "Optional `name_filter` does a partial name match. Returns bridge name, MTU, VLAN-filtering flag, and STP state.",
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
    title: "Get Bridge Interface Detail",
    annotations: READ,
    description:
      "Fetches full detail for a single bridge interface (`/interface bridge print detail`). " +
      "Use to inspect STP/MSTP state, VLAN-filtering flag, MTU, MAC address, and operational status for one bridge. " +
      "For all bridges use `list_bridges`; for the member ports of this bridge use `list_bridge_ports`. " +
      "Requires the exact bridge `name`.",
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
    title: "Update Bridge Interface Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Modifies settings on an existing bridge interface (`/interface bridge set`). " +
      "Use to rename a bridge (`new_name`), toggle VLAN filtering, change STP/RSTP/MSTP protocol mode, adjust MTU, or enable/disable the bridge. " +
      "For adding or removing member interfaces use `add_bridge_port` / `remove_bridge_port`; " +
      "for VLAN table entries use `add_bridge_vlan`. " +
      "Identified by the current bridge `name`; supply only the fields you want to change.",
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
    title: "Remove Bridge Interface",
    annotations: DESTRUCTIVE,
    description:
      "Deletes a bridge interface (`/interface bridge remove`). " +
      "Verifies existence first and returns an error if the bridge is not found. " +
      "Removing the bridge also releases all enslaved member ports. " +
      "To detach a single member without deleting the bridge use `remove_bridge_port`. " +
      "Identified by bridge `name`.",
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
    title: "Add Bridge Port (Enslave Interface)",
    annotations: WRITE,
    description:
      "Enslaves an interface as a member port of a bridge (`/interface bridge port add`). " +
      "Use to add an Ethernet, VLAN sub-interface, or other interface type to an existing bridge domain. " +
      "Set `pvid` (1-4094) to assign the port's native/untagged VLAN; set `hw=true` to enable hardware offload. " +
      "To create the bridge itself first use `create_bridge`; " +
      "to add a VLAN entry to the bridge VLAN table use `add_bridge_vlan`; " +
      "for standalone VLAN sub-interfaces use `create_vlan_interface`. " +
      "Returns the new port entry's detail.",
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
    title: "List Bridge Port Memberships",
    annotations: READ,
    description:
      "Lists bridge port memberships (`/interface bridge port print`). " +
      "Use to see which interfaces are enslaved to a bridge, their PVID, horizon, and hardware-offload status. " +
      "For the bridge interfaces themselves use `list_bridges`; " +
      "for MAC addresses learned on the bridge use `list_bridge_hosts`; " +
      "for VLAN table entries use `list_bridge_vlans`. " +
      "Filter by exact `bridge_filter` (bridge name) or `interface_filter` (member interface name).",
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
    title: "Remove Bridge Port (Release Interface)",
    annotations: DESTRUCTIVE,
    description:
      "Detaches a member interface from its bridge (`/interface bridge port remove`). " +
      "Verifies the port exists first and returns an error if not found. " +
      "Releases the interface back to standalone mode without deleting the bridge itself. " +
      "To delete the entire bridge (and release all ports) use `remove_bridge`. " +
      "Identified by the member `interface` name.",
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
    title: "List Bridge MAC Address (Host) Table",
    annotations: READ,
    description:
      "Lists the learned MAC forwarding table of a bridge (`/interface bridge host print`). " +
      "Use to see which MAC addresses are known on each bridge port — useful for Layer-2 troubleshooting and verifying device reachability. " +
      "This is the bridge forwarding database, not the ARP table (ARP maps IP-to-MAC; use ARP tools for that). " +
      "Not the same as `list_bridge_ports` (which lists enslaved interfaces, not learned MACs). " +
      "Filter by exact `bridge_filter`; returns MAC address, port, age, and dynamic/static flag.",
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
    title: "Add Bridge VLAN Table Entry",
    annotations: WRITE,
    description:
      "Adds a VLAN membership entry to a bridge's 802.1Q VLAN table (`/interface bridge vlan add`). " +
      "Use to define which ports carry a specific VLAN as tagged (trunk) or untagged (access). " +
      "Requires `vlan-filtering` to be enabled on the bridge (set via `create_bridge` or `update_bridge`). " +
      "`vlan_ids` accepts a single ID (e.g. '100') or comma-separated list (e.g. '100,200'); " +
      "`tagged` and `untagged` accept comma-separated interface names. " +
      "For standalone 802.1Q VLAN sub-interfaces use `create_vlan_interface`; " +
      "for listing existing VLAN table entries use `list_bridge_vlans`; " +
      "for setting per-port native VLAN use the `pvid` parameter in `add_bridge_port`.",
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
    title: "List Bridge VLAN Table Entries",
    annotations: READ,
    description:
      "Lists VLAN membership entries from the bridge VLAN table (`/interface bridge vlan print`). " +
      "Use to inspect which ports are tagged or untagged for each VLAN on a bridge where `vlan-filtering` is active. " +
      "For standalone 802.1Q VLAN sub-interfaces (not bridge VLAN table) use `create_vlan_interface` and related VLAN tools; " +
      "for bridge port PVID (native VLAN) settings use `list_bridge_ports`. " +
      "Filter by exact `bridge_filter`; returns VLAN IDs with their tagged and untagged port lists.",
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
