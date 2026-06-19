/** Resolved routing next-hops — `/routing nexthop` (RouterOS v7, read-only). */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, isEmpty, commandUnsupported } from "../core/routeros";

const UNSUPPORTED =
  "Routing next-hops are not available on this device (requires RouterOS v7 with the routing package).";

export const routingNexthopTools: ToolModule = [
  defineTool({
    name: "list_routing_nexthops",
    title: "List Routing Next-hops",
    annotations: READ,
    description:
      "Lists resolved routing next-hops (`/routing nexthop`). This is the recursive next-hop resolution table: " +
      "it shows how each gateway resolves to a concrete interface + immediate gateway, which routes reference it, " +
      "and whether it is currently active. Read-only and diagnostic — useful for debugging recursive/BGP next-hops.",
    inputSchema: {
      gateway_filter: z.string().optional().describe("Substring match on the resolved gateway address"),
      active_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing routing next-hops");
      const filters: string[] = [];
      if (a.gateway_filter) filters.push(`gateway~"${a.gateway_filter}"`);
      if (a.active_only) filters.push("active=yes");
      const result = await executeMikrotikCommand(`/routing nexthop print detail${whereClause(filters)}`, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result) ? "No routing next-hops found." : `ROUTING NEXT-HOPS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_routing_nexthop_stats",
    title: "Routing Next-hop Statistics",
    annotations: READ,
    description: "Summarises the routing next-hop table: total vs active next-hop count.",
    async handler(_a, ctx) {
      ctx.info("Getting routing next-hop statistics");
      const total = await executeMikrotikCommand("/routing nexthop print count-only", ctx);
      if (commandUnsupported(total)) return UNSUPPORTED;
      const active = await executeMikrotikCommand(
        "/routing nexthop print count-only where active=yes",
        ctx,
      );
      return `ROUTING NEXT-HOP STATISTICS:\n\nTotal next-hops: ${total.trim()}\nActive next-hops: ${active.trim()}`;
    },
  }),
];
