/** IP routing table — `/ip route`. */
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
  yesno,
  whereClause,
  quoteValue,
  looksLikeError,
  isEmpty,
  commandUnsupported,
  Cmd,
} from "../core/routeros";

interface AddRouteArgs {
  dst_address: string;
  gateway: string;
  distance?: number;
  scope?: number;
  target_scope?: number;
  routing_mark?: string;
  comment?: string;
  disabled?: boolean;
  vrf_interface?: string;
  pref_src?: string;
  check_gateway?: string;
}

/** Shared `add_route` body, reused by `add_default_route`. */
async function addRoute(
  a: AddRouteArgs,
  ctx: Parameters<typeof executeMikrotikCommand>[1],
): Promise<string> {
  ctx.info(`Adding route: dst=${a.dst_address}, gateway=${a.gateway}`);
  const cmd = new Cmd("/ip route add")
    .set("dst-address", a.dst_address)
    .set("gateway", a.gateway)
    .opt("distance", a.distance)
    .opt("scope", a.scope)
    .opt("target-scope", a.target_scope)
    .opt("routing-mark", a.routing_mark)
    .opt("comment", a.comment)
    .flag("disabled", a.disabled)
    .opt("vrf-interface", a.vrf_interface)
    .opt("pref-src", a.pref_src)
    .opt("check-gateway", a.check_gateway)
    .build();

  const result = await executeMikrotikCommand(cmd, ctx);
  const t = result.trim();
  if (t) {
    if (t.includes("*") || /^\d+$/.test(t)) {
      const details = await executeMikrotikCommand(
        `/ip route print detail where .id=${t}`,
        ctx,
      );
      return details.trim()
        ? `Route added successfully:\n\n${details}`
        : `Route added with ID: ${result}`;
    }
    return `Failed to add route: ${result}`;
  }
  const details = await executeMikrotikCommand(
    `/ip route print detail where dst-address="${a.dst_address}" and gateway="${a.gateway}"`,
    ctx,
  );
  return details.trim()
    ? `Route added successfully:\n\n${details}`
    : "Route addition completed but unable to verify.";
}

/** Shared enable/disable body for a single route. */
async function setRouteDisabled(
  routeId: string,
  disabled: boolean,
  ctx: Parameters<typeof executeMikrotikCommand>[1],
): Promise<string> {
  ctx.info(`Updating route: route_id=${routeId}`);
  const result = await executeMikrotikCommand(
    `/ip route set ${routeId} disabled=${yesno(disabled)}`,
    ctx,
  );
  if (looksLikeError(result)) return `Failed to update route: ${result}`;
  const details = await executeMikrotikCommand(
    `/ip route print detail where .id=${routeId}`,
    ctx,
  );
  return `Route updated successfully:\n\n${details}`;
}

export const routeTools: ToolModule = [
  defineTool({
    name: "add_route",
    title: "Add Route",
    annotations: WRITE,
    description: "Adds a route to the routing table.",
    inputSchema: {
      dst_address: z
        .string()
        .describe('CIDR e.g. "0.0.0.0/0", "192.168.1.0/24"'),
      gateway: z.string(),
      distance: z
        .number()
        .int()
        .optional()
        .describe("1-255 (lower = higher priority)"),
      scope: z.number().int().optional(),
      target_scope: z.number().int().optional(),
      routing_mark: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
      vrf_interface: z.string().optional(),
      pref_src: z.string().optional(),
      check_gateway: z.string().optional().describe('"ping" or "arp"'),
    },
    async handler(a, ctx) {
      return addRoute(a, ctx);
    },
  }),

  defineTool({
    name: "list_routes",
    title: "List Routes",
    annotations: READ,
    description: "Lists routes in MikroTik routing table.",
    inputSchema: {
      dst_filter: z.string().optional(),
      gateway_filter: z.string().optional(),
      routing_mark_filter: z.string().optional(),
      distance_filter: z.number().int().optional(),
      active_only: z.boolean().default(false),
      disabled_only: z.boolean().default(false),
      dynamic_only: z.boolean().default(false),
      static_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Listing routes with filters: dst=${a.dst_filter}, gateway=${a.gateway_filter}`,
      );
      const filters: string[] = [];
      if (a.dst_filter) filters.push(`dst-address~"${a.dst_filter}"`);
      if (a.gateway_filter) filters.push(`gateway~"${a.gateway_filter}"`);
      if (a.routing_mark_filter)
        filters.push(`routing-mark="${a.routing_mark_filter}"`);
      if (a.distance_filter !== undefined)
        filters.push(`distance=${a.distance_filter}`);
      if (a.active_only) filters.push("active=yes");
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.dynamic_only) filters.push("dynamic=yes");
      if (a.static_only) filters.push("static=yes");

      const result = await executeMikrotikCommand(
        `/ip route print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No routes found matching the criteria."
        : `ROUTES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_route",
    title: "Get Route",
    annotations: READ,
    description: "Gets detailed information about a specific route.",
    inputSchema: {
      route_id: z.string().describe('"*N" or "N" from list output e.g. "*3"'),
    },
    async handler(a, ctx) {
      ctx.info(`Getting route details: route_id=${a.route_id}`);
      const result = await executeMikrotikCommand(
        `/ip route print detail where .id=${a.route_id}`,
        ctx,
      );
      return isEmpty(result)
        ? `Route with ID '${a.route_id}' not found.`
        : `ROUTE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_route",
    title: "Update Route",
    annotations: WRITE_IDEMPOTENT,
    description:
      'Updates a route. Pass "" to routing_mark, vrf_interface, or pref_src to clear them.',
    inputSchema: {
      route_id: z.string().describe('"*N" or "N" from list output e.g. "*3"'),
      dst_address: z.string().optional().describe('CIDR e.g. "192.168.1.0/24"'),
      gateway: z.string().optional(),
      distance: z.number().int().optional().describe("1-255"),
      scope: z.number().int().optional(),
      target_scope: z.number().int().optional(),
      routing_mark: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
      vrf_interface: z.string().optional(),
      pref_src: z.string().optional(),
      check_gateway: z.string().optional().describe('"ping" or "arp"'),
    },
    async handler(a, ctx) {
      ctx.info(`Updating route: route_id=${a.route_id}`);
      const base = `/ip route set ${a.route_id}`;
      const cmd = new Cmd(base);
      if (a.dst_address) cmd.set("dst-address", a.dst_address);
      if (a.gateway) cmd.set("gateway", a.gateway);
      if (a.distance !== undefined) cmd.set("distance", a.distance);
      if (a.scope !== undefined) cmd.set("scope", a.scope);
      if (a.target_scope !== undefined) cmd.set("target-scope", a.target_scope);
      if (a.routing_mark !== undefined) {
        cmd.raw(
          a.routing_mark === ""
            ? "!routing-mark"
            : `routing-mark=${quoteValue(a.routing_mark)}`,
        );
      }
      if (a.comment !== undefined) cmd.raw(`comment=${quoteValue(a.comment)}`);
      if (a.disabled !== undefined) cmd.bool("disabled", a.disabled);
      if (a.vrf_interface !== undefined) {
        cmd.raw(
          a.vrf_interface === ""
            ? "!vrf-interface"
            : `vrf-interface=${quoteValue(a.vrf_interface)}`,
        );
      }
      if (a.pref_src !== undefined) {
        cmd.raw(
          a.pref_src === ""
            ? "!pref-src"
            : `pref-src=${quoteValue(a.pref_src)}`,
        );
      }
      if (a.check_gateway !== undefined)
        cmd.raw(`check-gateway=${quoteValue(a.check_gateway)}`);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result)) return `Failed to update route: ${result}`;

      const details = await executeMikrotikCommand(
        `/ip route print detail where .id=${a.route_id}`,
        ctx,
      );
      return `Route updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_route",
    title: "Remove Route",
    annotations: DESTRUCTIVE,
    description: "Removes a route.",
    inputSchema: {
      route_id: z.string().describe('"*N" or "N" from list output e.g. "*3"'),
    },
    async handler(a, ctx) {
      ctx.info(`Removing route: route_id=${a.route_id}`);
      const count = await executeMikrotikCommand(
        `/ip route print count-only where .id=${a.route_id}`,
        ctx,
      );
      if (count.trim() === "0")
        return `Route with ID '${a.route_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/ip route remove ${a.route_id}`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove route: ${result}`;
      return `Route with ID '${a.route_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_route",
    title: "Enable Route",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a route.",
    inputSchema: {
      route_id: z.string().describe('"*N" or "N" from list output e.g. "*3"'),
    },
    async handler(a, ctx) {
      return setRouteDisabled(a.route_id, false, ctx);
    },
  }),

  defineTool({
    name: "disable_route",
    title: "Disable Route",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a route.",
    inputSchema: {
      route_id: z.string().describe('"*N" or "N" from list output e.g. "*3"'),
    },
    async handler(a, ctx) {
      return setRouteDisabled(a.route_id, true, ctx);
    },
  }),

  defineTool({
    name: "get_routing_table",
    title: "Routing Table",
    annotations: READ,
    description: "Gets a specific routing table.",
    inputSchema: {
      table_name: z.string().default("main"),
      protocol_filter: z.string().optional(),
      active_only: z.boolean().default(true),
    },
    async handler(a, ctx) {
      ctx.info(`Getting routing table: table=${a.table_name}`);
      const filters: string[] = [];
      if (a.table_name && a.table_name !== "main")
        filters.push(`routing-table="${a.table_name}"`);
      if (a.protocol_filter) filters.push(`protocol="${a.protocol_filter}"`);
      if (a.active_only) filters.push("active=yes");

      const result = await executeMikrotikCommand(
        `/ip route print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? `No routes found in table '${a.table_name}'.`
        : `ROUTING TABLE (${a.table_name}):\n\n${result}`;
    },
  }),

  defineTool({
    name: "check_route_path",
    title: "Check Route Path",
    annotations: READ,
    description: "Checks the route path to a destination.",
    inputSchema: {
      destination: z.string(),
      source: z.string().optional(),
      routing_mark: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Checking route path to: ${a.destination}`);
      const cmd = new Cmd(`/ip route check ${a.destination}`)
        .opt("src-address", a.source)
        .opt("routing-mark", a.routing_mark)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (!result) return `Unable to check route to ${a.destination}`;
      return `ROUTE PATH TO ${a.destination}:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_route_cache",
    title: "Get Route Cache",
    annotations: READ,
    description:
      "Shows the route/forwarding cache. Version-aware: on RouterOS v6 it reads the real route cache " +
      "(`/ip route cache`); on v7+ — which removed the separate cache — it returns the active forwarding " +
      "table (FIB), i.e. `/ip route` entries with active=yes, the closest equivalent.",
    async handler(_a, ctx) {
      ctx.info("Getting route cache");
      // v6: a real per-flow route cache exists.
      const cache = await executeMikrotikCommand("/ip route cache print", ctx);
      if (!commandUnsupported(cache)) {
        if (looksLikeError(cache)) return `Failed to get route cache: ${cache}`;
        return isEmpty(cache)
          ? "Route cache is empty."
          : `ROUTE CACHE:\n\n${cache}`;
      }
      // v7+: the cache was removed — the forwarding table is the active routes (FIB).
      const fib = await executeMikrotikCommand(
        "/ip route print where active=yes",
        ctx,
      );
      if (looksLikeError(fib)) return `Failed to read forwarding table: ${fib}`;
      return isEmpty(fib)
        ? "No active routes in the forwarding table."
        : `ACTIVE FORWARDING TABLE (RouterOS v7+ has no separate route cache; showing active /ip route entries):\n\n${fib}`;
    },
  }),

  defineTool({
    name: "flush_route_cache",
    title: "Flush Route Cache",
    annotations: DESTRUCTIVE,
    description:
      "Flushes the route cache (`/ip route cache flush`). Version-aware: on RouterOS v6 it flushes the cache; " +
      "on v7+ there is no separate cache, so it reports a no-op (the FIB is rebuilt from /ip route directly).",
    async handler(_a, ctx) {
      ctx.info("Flushing route cache");
      const result = await executeMikrotikCommand("/ip route cache flush", ctx);
      if (commandUnsupported(result)) {
        return "No route cache to flush — RouterOS v7+ has no separate route cache (the forwarding table is rebuilt from /ip route directly), so this is a no-op.";
      }
      if (looksLikeError(result))
        return `Failed to flush route cache: ${result}`;
      return result.trim()
        ? `Flush result: ${result}`
        : "Route cache flushed successfully.";
    },
  }),

  defineTool({
    name: "add_default_route",
    title: "Add Default Route",
    annotations: WRITE,
    description: "Adds a default route.",
    inputSchema: {
      gateway: z.string(),
      distance: z.number().int().default(1),
      comment: z.string().optional(),
      check_gateway: z.string().default("ping"),
    },
    async handler(a, ctx) {
      return addRoute(
        {
          dst_address: "0.0.0.0/0",
          gateway: a.gateway,
          distance: a.distance,
          comment: a.comment || "Default route",
          check_gateway: a.check_gateway,
        },
        ctx,
      );
    },
  }),

  defineTool({
    name: "add_blackhole_route",
    title: "Add Blackhole Route",
    annotations: WRITE,
    description: "Adds a blackhole route.",
    inputSchema: {
      dst_address: z.string().describe('CIDR e.g. "10.0.0.0/8"'),
      distance: z.number().int().default(1).describe("1-255"),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Adding blackhole route: dst=${a.dst_address}`);
      const cmd = new Cmd("/ip route add")
        .set("dst-address", a.dst_address)
        .set("type", "blackhole")
        .set("distance", a.distance)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      const t = result.trim();
      if (t) {
        if (t.includes("*") || /^\d+$/.test(t))
          return `Blackhole route added successfully. ID: ${result}`;
        return `Failed to add blackhole route: ${result}`;
      }
      return "Blackhole route added successfully.";
    },
  }),

  defineTool({
    name: "get_route_statistics",
    title: "Route Statistics",
    annotations: READ,
    description: "Gets routing table statistics.",
    async handler(_a, ctx) {
      ctx.info("Getting route statistics");
      const total = await executeMikrotikCommand(
        "/ip route print count-only",
        ctx,
      );
      const active = await executeMikrotikCommand(
        "/ip route print count-only where active=yes",
        ctx,
      );
      const dynamic = await executeMikrotikCommand(
        "/ip route print count-only where dynamic=yes",
        ctx,
      );
      const staticCount = await executeMikrotikCommand(
        "/ip route print count-only where static=yes",
        ctx,
      );
      const disabled = await executeMikrotikCommand(
        "/ip route print count-only where disabled=yes",
        ctx,
      );

      const stats = [
        `Total routes: ${total.trim()}`,
        `Active routes: ${active.trim()}`,
        `Dynamic routes: ${dynamic.trim()}`,
        `Static routes: ${staticCount.trim()}`,
        `Disabled routes: ${disabled.trim()}`,
      ];

      return `ROUTE STATISTICS:\n\n${stats.join("\n")}`;
    },
  }),
];
