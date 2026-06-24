/**
 * IPv6 neighbor cache — `/ipv6 neighbor`.
 *
 * The IPv6 equivalent of the ARP table: addresses discovered via Neighbor
 * Discovery. Entries are dynamic (populated by ND) so this scope is read-only
 * apart from flushing stale/incorrect entries.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty } from "../core/routeros";

export const ipv6NeighborTools: ToolModule = [
  defineTool({
    name: "list_ipv6_neighbors",
    title: "List IPv6 Neighbors",
    annotations: READ,
    description:
      "Lists IPv6 neighbor cache entries (discovered via Neighbor Discovery) " +
      "on the MikroTik device.",
    inputSchema: {
      interface_filter: z.string().optional(),
      address_filter: z.string().optional(),
      mac_filter: z.string().optional(),
      status_filter: z
        .string()
        .optional()
        .describe("Match status, e.g. 'reachable', 'stale', 'delay', 'probe'"),
      router_only: z.boolean().default(false).describe("Only entries flagged as routers"),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPv6 neighbors");
      const filters: string[] = [];
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);
      if (a.address_filter) filters.push(`address~"${a.address_filter}"`);
      if (a.mac_filter) filters.push(`mac-address~"${a.mac_filter}"`);
      if (a.status_filter) filters.push(`status="${a.status_filter}"`);
      if (a.router_only) filters.push("router=yes");

      const result = await executeMikrotikCommand(
        `/ipv6 neighbor print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No IPv6 neighbors found matching the criteria."
        : `IPV6 NEIGHBORS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipv6_neighbor",
    title: "Get IPv6 Neighbor",
    annotations: READ,
    description: "Gets detailed information about a specific IPv6 neighbor by ID or address.",
    inputSchema: {
      neighbor_id: z.string().describe("RouterOS .id (e.g. '*1') or the IPv6 address"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting IPv6 neighbor: neighbor_id=${a.neighbor_id}`);
      let result = await executeMikrotikCommand(
        `/ipv6 neighbor print detail where .id="${a.neighbor_id}"`,
        ctx,
      );
      if (isEmpty(result)) {
        result = await executeMikrotikCommand(
          `/ipv6 neighbor print detail where address="${a.neighbor_id}"`,
          ctx,
        );
      }
      return isEmpty(result)
        ? `IPv6 neighbor '${a.neighbor_id}' not found.`
        : `IPV6 NEIGHBOR DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_ipv6_neighbor",
    title: "Remove IPv6 Neighbor",
    annotations: DESTRUCTIVE,
    description:
      "Flushes an IPv6 neighbor cache entry by ID or address. The entry may be " +
      "re-learned automatically via Neighbor Discovery.",
    inputSchema: {
      neighbor_id: z.string().describe("RouterOS .id (e.g. '*1') or the IPv6 address"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing IPv6 neighbor: neighbor_id=${a.neighbor_id}`);
      let byId = true;
      let count = await executeMikrotikCommand(
        `/ipv6 neighbor print count-only where .id="${a.neighbor_id}"`,
        ctx,
      );
      if (count.trim() === "0") {
        byId = false;
        count = await executeMikrotikCommand(
          `/ipv6 neighbor print count-only where address="${a.neighbor_id}"`,
          ctx,
        );
        if (count.trim() === "0") return `IPv6 neighbor '${a.neighbor_id}' not found.`;
      }
      const selector = byId ? `.id="${a.neighbor_id}"` : `address="${a.neighbor_id}"`;
      const result = await executeMikrotikCommand(`/ipv6 neighbor remove [find ${selector}]`, ctx);
      if (looksLikeError(result)) return `Failed to remove IPv6 neighbor: ${result}`;
      return `IPv6 neighbor '${a.neighbor_id}' removed successfully.`;
    },
  }),
];
