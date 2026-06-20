/** DHCPv6 client — `/ipv6 dhcp-client`. */
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
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

const Request = z.enum(["address", "prefix", "address,prefix"]);
const AddDefaultRoute = z.enum(["yes", "no", "special-classless"]);

export const ipv6DhcpClientTools: ToolModule = [
  defineTool({
    name: "add_ipv6_dhcp_client",
    title: "Add DHCPv6 Client",
    annotations: WRITE,
    description:
      "Adds a DHCPv6 client on an interface on the MikroTik device.\n\n" +
      "Notes:\n" +
      "    request: what to ask the server for — 'address', 'prefix', or both.\n" +
      "    pool_name: when requesting a prefix, the delegated prefix is exposed\n" +
      "        as this IPv6 pool (used by '/ipv6 address from-pool').\n" +
      "    pool_prefix_length: per-interface prefix length carved from the pool,\n" +
      "        e.g. 64.",
    inputSchema: {
      interface: z.string(),
      request: Request.default("prefix"),
      pool_name: z
        .string()
        .optional()
        .describe("Name of the IPv6 pool to expose the delegated prefix as"),
      pool_prefix_length: z
        .number()
        .int()
        .min(1)
        .max(128)
        .optional()
        .describe("Prefix length carved from the delegated pool, e.g. 64"),
      prefix_hint: z
        .string()
        .optional()
        .describe("Hint the desired delegated prefix, e.g. '::/56'"),
      add_default_route: AddDefaultRoute.optional(),
      default_route_distance: z.number().int().optional(),
      use_peer_dns: z.boolean().optional(),
      rapid_commit: z.boolean().optional(),
      dhcp_options: z
        .string()
        .optional()
        .describe("Comma-separated custom DHCP option names"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding DHCPv6 client: interface=${a.interface}`);
      const cmd = new Cmd("/ipv6 dhcp-client add")
        .set("interface", a.interface)
        .set("request", a.request)
        .opt("pool-name", a.pool_name)
        .opt("pool-prefix-length", a.pool_prefix_length)
        .opt("prefix-hint", a.prefix_hint)
        .opt("add-default-route", a.add_default_route)
        .opt("default-route-distance", a.default_route_distance)
        .bool("use-peer-dns", a.use_peer_dns)
        .bool("rapid-commit", a.rapid_commit)
        .opt("dhcp-options", a.dhcp_options)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to add DHCPv6 client: ${result}`;
      const details = await executeMikrotikCommand(
        `/ipv6 dhcp-client print detail where interface="${a.interface}"`,
        ctx,
      );
      return details.trim()
        ? `DHCPv6 client added successfully:\n\n${details}`
        : "DHCPv6 client addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ipv6_dhcp_clients",
    title: "List DHCPv6 Clients",
    annotations: READ,
    description: "Lists DHCPv6 clients on the MikroTik device.",
    inputSchema: {
      interface_filter: z.string().optional(),
      status_filter: z
        .string()
        .optional()
        .describe("Match status, e.g. 'bound', 'searching', 'stopped'"),
      disabled_only: z.boolean().default(false),
      invalid_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing DHCPv6 clients");
      const filters: string[] = [];
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);
      if (a.status_filter) filters.push(`status="${a.status_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.invalid_only) filters.push("invalid=yes");

      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-client print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No DHCPv6 clients found matching the criteria."
        : `DHCPV6 CLIENTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipv6_dhcp_client",
    title: "Get DHCPv6 Client",
    annotations: READ,
    description:
      "Gets detailed information about a specific DHCPv6 client by ID or interface.",
    inputSchema: {
      client_id: z
        .string()
        .describe("RouterOS .id (e.g. '*1') or the interface name"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting DHCPv6 client details: client_id=${a.client_id}`);
      let result = await executeMikrotikCommand(
        `/ipv6 dhcp-client print detail where .id="${a.client_id}"`,
        ctx,
      );
      if (isEmpty(result)) {
        result = await executeMikrotikCommand(
          `/ipv6 dhcp-client print detail where interface="${a.client_id}"`,
          ctx,
        );
      }
      return isEmpty(result)
        ? `DHCPv6 client '${a.client_id}' not found.`
        : `DHCPV6 CLIENT DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "release_ipv6_dhcp_client",
    title: "Release DHCPv6 Client",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Releases the current DHCPv6 lease/prefix for a client (by ID or interface).",
    inputSchema: { client_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Releasing DHCPv6 client: client_id=${a.client_id}`);
      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-client release [find interface="${a.client_id}" or .id="${a.client_id}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to release DHCPv6 client: ${result}`;
      return `DHCPv6 client '${a.client_id}' released.`;
    },
  }),

  defineTool({
    name: "renew_ipv6_dhcp_client",
    title: "Renew DHCPv6 Client",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Renews the DHCPv6 lease/prefix for a client (by ID or interface).",
    inputSchema: { client_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Renewing DHCPv6 client: client_id=${a.client_id}`);
      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-client renew [find interface="${a.client_id}" or .id="${a.client_id}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to renew DHCPv6 client: ${result}`;
      return `DHCPv6 client '${a.client_id}' renew requested.`;
    },
  }),

  defineTool({
    name: "remove_ipv6_dhcp_client",
    title: "Remove DHCPv6 Client",
    annotations: DESTRUCTIVE,
    description:
      "Removes a DHCPv6 client from the MikroTik device by ID or interface.",
    inputSchema: { client_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing DHCPv6 client: client_id=${a.client_id}`);
      let byId = true;
      let count = await executeMikrotikCommand(
        `/ipv6 dhcp-client print count-only where .id="${a.client_id}"`,
        ctx,
      );
      if (count.trim() === "0") {
        byId = false;
        count = await executeMikrotikCommand(
          `/ipv6 dhcp-client print count-only where interface="${a.client_id}"`,
          ctx,
        );
        if (count.trim() === "0")
          return `DHCPv6 client '${a.client_id}' not found.`;
      }
      const selector = byId
        ? `.id="${a.client_id}"`
        : `interface="${a.client_id}"`;
      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-client remove [find ${selector}]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove DHCPv6 client: ${result}`;
      return `DHCPv6 client '${a.client_id}' removed successfully.`;
    },
  }),
];
