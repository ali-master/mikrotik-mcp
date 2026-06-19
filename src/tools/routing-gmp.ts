/** GMP (Group Management Protocol: IGMP/MLD) — `/routing gmp` (RouterOS v7). */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, isEmpty, commandUnsupported } from "../core/routeros";

const UNSUPPORTED =
  "GMP is not available on this device (requires RouterOS v7 with the routing/multicast package).";

export const routingGmpTools: ToolModule = [
  defineTool({
    name: "list_gmp_interfaces",
    title: "List GMP Interfaces",
    annotations: READ,
    description:
      "Lists GMP interfaces (`/routing gmp interface`). GMP is RouterOS's shared Group Management Protocol layer " +
      "(IGMP for IPv4, MLD for IPv6) used by PIM-SM and IGMP-proxy to learn receiver group memberships. " +
      "Read-only — shows the querier role, version and timers per interface.",
    async handler(_a, ctx) {
      ctx.info("Listing GMP interfaces");
      const result = await executeMikrotikCommand("/routing gmp interface print detail", ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result) ? "No GMP interfaces found." : `GMP INTERFACES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "list_gmp_group_memberships",
    title: "List GMP Group Memberships",
    annotations: READ,
    description:
      "Lists GMP group memberships (`/routing gmp group`): the multicast groups currently joined per interface, " +
      "as learned from IGMP/MLD reports. Read-only — the source of truth for which downstream segments want which groups.",
    inputSchema: {
      interface_filter: z.string().optional().describe("Show only memberships on this interface"),
      group_filter: z.string().optional().describe("Substring match on the multicast group address"),
    },
    async handler(a, ctx) {
      ctx.info("Listing GMP group memberships");
      const filters: string[] = [];
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);
      if (a.group_filter) filters.push(`group~"${a.group_filter}"`);
      const result = await executeMikrotikCommand(`/routing gmp group print detail${whereClause(filters)}`, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result) ? "No GMP group memberships found." : `GMP GROUP MEMBERSHIPS:\n\n${result}`;
    },
  }),
];
