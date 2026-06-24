/** IPv6 routing table — `/ipv6 route`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { yesno, whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";
import type { ToolContext } from "../core/context";

const RouteType = z.enum(["unicast", "blackhole", "unreachable", "prohibit"]);

interface AddIpv6RouteArgs {
  dst_address: string;
  gateway?: string;
  type?: string;
  distance?: number;
  scope?: number;
  target_scope?: number;
  routing_table?: string;
  pref_src?: string;
  check_gateway?: string;
  vrf_interface?: string;
  comment?: string;
  disabled?: boolean;
}

/** Shared `add_ipv6_route` body, reused by `add_ipv6_default_route`. */
async function addIpv6Route(a: AddIpv6RouteArgs, ctx: ToolContext): Promise<string> {
  ctx.info(`Adding IPv6 route: dst=${a.dst_address}, gateway=${a.gateway}`);
  const cmd = new Cmd("/ipv6 route add")
    .set("dst-address", a.dst_address)
    .opt("gateway", a.gateway)
    .opt("type", a.type)
    .opt("distance", a.distance)
    .opt("scope", a.scope)
    .opt("target-scope", a.target_scope)
    .opt("routing-table", a.routing_table)
    .opt("pref-src", a.pref_src)
    .opt("check-gateway", a.check_gateway)
    .opt("vrf-interface", a.vrf_interface)
    .opt("comment", a.comment)
    .flag("disabled", a.disabled)
    .build();

  const result = await executeMikrotikCommand(cmd, ctx);
  const t = result.trim();
  if (t) {
    if (t.includes("*") || /^\d+$/.test(t)) {
      const details = await executeMikrotikCommand(`/ipv6 route print detail where .id=${t}`, ctx);
      return details.trim()
        ? `IPv6 route added successfully:\n\n${details}`
        : `IPv6 route added with ID: ${result}`;
    }
    return `Failed to add IPv6 route: ${result}`;
  }
  const details = await executeMikrotikCommand(
    `/ipv6 route print detail where dst-address="${a.dst_address}"`,
    ctx,
  );
  return details.trim()
    ? `IPv6 route added successfully:\n\n${details}`
    : "IPv6 route addition completed but unable to verify.";
}

/** Shared enable/disable body for a single IPv6 route. */
async function setIpv6RouteDisabled(
  routeId: string,
  disabled: boolean,
  ctx: ToolContext,
): Promise<string> {
  ctx.info(`Updating IPv6 route: route_id=${routeId}`);
  const result = await executeMikrotikCommand(
    `/ipv6 route set ${routeId} disabled=${yesno(disabled)}`,
    ctx,
  );
  if (looksLikeError(result)) return `Failed to update IPv6 route: ${result}`;
  return `IPv6 route '${routeId}' ${disabled ? "disabled" : "enabled"}.`;
}

export const ipv6RouteTools: ToolModule = [
  defineTool({
    name: "add_ipv6_route",
    title: "Add IPv6 Route",
    annotations: WRITE,
    description:
      "Adds a static IPv6 route on the MikroTik device.\n\n" +
      "Notes:\n" +
      "    dst_address: destination prefix, e.g. '2001:db8:1::/64'.\n" +
      "    type: 'unicast' (default) routes via gateway; 'blackhole',\n" +
      "        'unreachable' and 'prohibit' discard traffic (no gateway needed).\n" +
      "    routing_table: target a named routing table/FIB.",
    inputSchema: {
      dst_address: z.string().describe("Destination prefix, e.g. '2001:db8:1::/64'"),
      gateway: z
        .string()
        .optional()
        .describe("Next-hop IPv6 address or interface (required for unicast)"),
      type: RouteType.optional(),
      distance: z.number().int().min(1).max(255).optional(),
      scope: z.number().int().min(0).max(255).optional(),
      target_scope: z.number().int().min(0).max(255).optional(),
      routing_table: z.string().optional(),
      pref_src: z.string().optional(),
      check_gateway: z.string().optional().describe("'ping', 'arp', 'bfd' or 'none'"),
      vrf_interface: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      return addIpv6Route(a, ctx);
    },
  }),

  defineTool({
    name: "add_ipv6_default_route",
    title: "Add IPv6 Default Route",
    annotations: WRITE,
    description: "Adds a default IPv6 route (::/0) via the given gateway on the MikroTik device.",
    inputSchema: {
      gateway: z.string().describe("Next-hop IPv6 address or interface"),
      distance: z.number().int().min(1).max(255).optional(),
      check_gateway: z.string().optional(),
      routing_table: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      return addIpv6Route({ ...a, dst_address: "::/0" }, ctx);
    },
  }),

  defineTool({
    name: "list_ipv6_routes",
    title: "List IPv6 Routes",
    annotations: READ,
    description: "Lists IPv6 routes on the MikroTik device.",
    inputSchema: {
      dst_filter: z.string().optional(),
      gateway_filter: z.string().optional(),
      routing_table_filter: z.string().optional(),
      active_only: z.boolean().default(false),
      disabled_only: z.boolean().default(false),
      dynamic_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPv6 routes");
      const filters: string[] = [];
      if (a.dst_filter) filters.push(`dst-address~"${a.dst_filter}"`);
      if (a.gateway_filter) filters.push(`gateway~"${a.gateway_filter}"`);
      if (a.routing_table_filter) filters.push(`routing-table="${a.routing_table_filter}"`);
      if (a.active_only) filters.push("active=yes");
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.dynamic_only) filters.push("dynamic=yes");

      const result = await executeMikrotikCommand(`/ipv6 route print${whereClause(filters)}`, ctx);
      return isEmpty(result)
        ? "No IPv6 routes found matching the criteria."
        : `IPV6 ROUTES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipv6_route",
    title: "Get IPv6 Route",
    annotations: READ,
    description: "Gets detailed information about a specific IPv6 route by ID or destination.",
    inputSchema: {
      route_id: z.string().describe("RouterOS .id (e.g. '*1') or the destination prefix"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting IPv6 route details: route_id=${a.route_id}`);
      let result = await executeMikrotikCommand(
        `/ipv6 route print detail where .id="${a.route_id}"`,
        ctx,
      );
      if (isEmpty(result)) {
        result = await executeMikrotikCommand(
          `/ipv6 route print detail where dst-address="${a.route_id}"`,
          ctx,
        );
      }
      return isEmpty(result)
        ? `IPv6 route '${a.route_id}' not found.`
        : `IPV6 ROUTE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_ipv6_route",
    title: "Remove IPv6 Route",
    annotations: DESTRUCTIVE,
    description:
      "Removes a static IPv6 route by ID from the MikroTik device. " +
      "Use the .id from list output (e.g. '*5') to avoid ambiguity when " +
      "multiple routes share a destination.",
    inputSchema: {
      route_id: z.string().describe("RouterOS .id, e.g. '*5'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing IPv6 route: route_id=${a.route_id}`);
      const count = await executeMikrotikCommand(
        `/ipv6 route print count-only where .id="${a.route_id}"`,
        ctx,
      );
      if (count.trim() === "0") return `IPv6 route '${a.route_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/ipv6 route remove [find .id="${a.route_id}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove IPv6 route: ${result}`;
      return `IPv6 route '${a.route_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_ipv6_route",
    title: "Enable IPv6 Route",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables an IPv6 route by .id.",
    inputSchema: { route_id: z.string() },
    async handler(a, ctx) {
      return setIpv6RouteDisabled(a.route_id, false, ctx);
    },
  }),

  defineTool({
    name: "disable_ipv6_route",
    title: "Disable IPv6 Route",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables an IPv6 route by .id.",
    inputSchema: { route_id: z.string() },
    async handler(a, ctx) {
      return setIpv6RouteDisabled(a.route_id, true, ctx);
    },
  }),
];
