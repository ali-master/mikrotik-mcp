/**
 * Neighbor discovery — `/ip neighbor` (MNDP / CDP / LLDP).
 *
 * RouterOS continuously discovers directly-attached devices via MikroTik
 * Neighbor Discovery Protocol (and CDP/LLDP) and caches them here. This is the
 * data the dashboard's live Layer-2 topology map is built from: each entry is a
 * device physically reachable on a local interface — often before it has any
 * routable IP, which is exactly when MAC-Telnet onboarding is useful.
 *
 * The neighbour cache itself is read-only (populated by the protocols); the
 * configurable part is the discovery *settings* (which interfaces participate
 * and which protocols are spoken).
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { READ, WRITE_IDEMPOTENT, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, isEmpty, looksLikeError, Cmd } from "../core/routeros";

export const neighborTools: ToolModule = [
  defineTool({
    name: "list_neighbors",
    title: "List Neighbors (MNDP)",
    annotations: READ,
    description:
      "Lists directly-attached devices discovered via MNDP/CDP/LLDP (`/ip neighbor`) — identity, " +
      "MAC, IP, the local interface they were seen on, platform, board and version. This is the " +
      "Layer-2 view of what is physically connected, including devices with no routable IP.",
    inputSchema: {
      interface_filter: z.string().optional().describe("Match the local discovery interface."),
      identity_filter: z
        .string()
        .optional()
        .describe("Match the neighbour's identity (substring)."),
      address_filter: z
        .string()
        .optional()
        .describe("Match the neighbour's IP address (substring)."),
      mac_filter: z.string().optional().describe("Match the neighbour's MAC address (substring)."),
    },
    async handler(a, ctx) {
      ctx.info("Listing discovered neighbours (/ip neighbor)");
      const filters: string[] = [];
      if (a.interface_filter) filters.push(`interface~"${a.interface_filter}"`);
      if (a.identity_filter) filters.push(`identity~"${a.identity_filter}"`);
      if (a.address_filter) filters.push(`address~"${a.address_filter}"`);
      if (a.mac_filter) filters.push(`mac-address~"${a.mac_filter}"`);

      const result = await executeMikrotikCommand(
        `/ip neighbor print detail${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No neighbours discovered matching the criteria."
        : `NEIGHBORS (MNDP/CDP/LLDP):\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_neighbor_discovery_settings",
    title: "Get Neighbor Discovery Settings",
    annotations: READ,
    description:
      "Shows neighbor-discovery settings (`/ip neighbor discovery-settings`): which interface-list " +
      "participates in discovery and which protocols (MNDP/CDP/LLDP) are enabled.",
    inputSchema: {},
    async handler(_a, ctx) {
      ctx.info("Getting neighbor discovery settings");
      const result = await executeMikrotikCommand("/ip neighbor discovery-settings print", ctx);
      return isEmpty(result)
        ? "No discovery settings returned."
        : `NEIGHBOR DISCOVERY SETTINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_neighbor_discovery_settings",
    title: "Set Neighbor Discovery Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Configures neighbor discovery (`/ip neighbor discovery-settings set`): the interface-list to " +
      "discover on, the discovery mode (tx/rx), and which protocols to speak. Controls which devices " +
      "appear in the topology map.",
    inputSchema: {
      discover_interface_list: z
        .string()
        .optional()
        .describe('Interface-list to run discovery on, e.g. "all", "LAN", "none".'),
      mode: z
        .enum(["tx-only", "rx-only", "tx-and-rx"])
        .optional()
        .describe("Whether the router transmits and/or receives discovery frames."),
      protocol: z.string().optional().describe('Comma-separated protocols, e.g. "mndp,cdp,lldp".'),
      lldp_med_net_policy_vlan: z
        .string()
        .optional()
        .describe('LLDP-MED network-policy VLAN, e.g. "auto" or a VLAN id.'),
    },
    async handler(a, ctx) {
      ctx.info("Updating neighbor discovery settings");
      const cmd = new Cmd("/ip neighbor discovery-settings set")
        .opt("discover-interface-list", a.discover_interface_list)
        .opt("mode", a.mode)
        .opt("protocol", a.protocol)
        .opt("lldp-med-net-policy-vlan", a.lldp_med_net_policy_vlan)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update discovery settings: ${result}`;
      const after = await executeMikrotikCommand("/ip neighbor discovery-settings print", ctx);
      return `Discovery settings updated.\n\n${after}`;
    },
  }),
];
