/** IPv6 addresses — `/ipv6 address`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const ipv6AddressTools: ToolModule = [
  defineTool({
    name: "add_ipv6_address",
    title: "Add IPv6 Address",
    annotations: WRITE,
    description:
      "Adds an IPv6 address to an interface on the MikroTik device.\n\n" +
      "Notes:\n" +
      "    address: IPv6 with prefix length, e.g. '2001:db8::1/64'. When from_pool\n" +
      "        is set the host part may be omitted and is taken from the pool.\n" +
      "    eui_64: derive the host part from the interface MAC (modified EUI-64).\n" +
      "    advertise: include this prefix in Router Advertisements (ND).",
    inputSchema: {
      address: z.string().describe("IPv6 address with prefix, e.g. '2001:db8::1/64'"),
      interface: z.string(),
      advertise: z.boolean().optional().describe("Advertise the prefix via Router Advertisements"),
      eui_64: z
        .boolean()
        .optional()
        .describe("Derive the host part from the interface MAC (EUI-64)"),
      from_pool: z.string().optional().describe("IPv6 pool name to take the prefix from"),
      no_dad: z.boolean().optional().describe("Skip Duplicate Address Detection for this address"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding IPv6 address: address=${a.address}, interface=${a.interface}`);
      const cmd = new Cmd("/ipv6 address add")
        .set("address", a.address)
        .set("interface", a.interface)
        .bool("advertise", a.advertise)
        .bool("eui-64", a.eui_64)
        .opt("from-pool", a.from_pool)
        .bool("no-dad", a.no_dad)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add IPv6 address: ${result}`;
      const details = await executeMikrotikCommand(
        `/ipv6 address print detail where address="${a.address}"`,
        ctx,
      );
      return details.trim()
        ? `IPv6 address added successfully:\n\n${details}`
        : "IPv6 address addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ipv6_addresses",
    title: "List IPv6 Addresses",
    annotations: READ,
    description: "Lists IPv6 addresses on the MikroTik device.",
    inputSchema: {
      interface_filter: z.string().optional(),
      address_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      dynamic_only: z.boolean().default(false),
      link_local_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPv6 addresses");
      const filters: string[] = [];
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);
      if (a.address_filter) filters.push(`address~"${a.address_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.dynamic_only) filters.push("dynamic=yes");
      if (a.link_local_only) filters.push("link-local=yes");

      const result = await executeMikrotikCommand(
        `/ipv6 address print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No IPv6 addresses found matching the criteria."
        : `IPV6 ADDRESSES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipv6_address",
    title: "Get IPv6 Address",
    annotations: READ,
    description: "Gets detailed information about a specific IPv6 address by ID or address value.",
    inputSchema: {
      address_id: z.string().describe("RouterOS .id (e.g. '*1') or the address value"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting IPv6 address details: address_id=${a.address_id}`);
      let result = await executeMikrotikCommand(
        `/ipv6 address print detail where .id="${a.address_id}"`,
        ctx,
      );
      if (isEmpty(result)) {
        result = await executeMikrotikCommand(
          `/ipv6 address print detail where address="${a.address_id}"`,
          ctx,
        );
      }
      return isEmpty(result)
        ? `IPv6 address '${a.address_id}' not found.`
        : `IPV6 ADDRESS DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_ipv6_address",
    title: "Remove IPv6 Address",
    annotations: DESTRUCTIVE,
    description: "Removes an IPv6 address from the MikroTik device by ID or address value.",
    inputSchema: { address_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing IPv6 address: address_id=${a.address_id}`);
      let byId = true;
      let count = await executeMikrotikCommand(
        `/ipv6 address print count-only where .id="${a.address_id}"`,
        ctx,
      );
      if (count.trim() === "0") {
        byId = false;
        count = await executeMikrotikCommand(
          `/ipv6 address print count-only where address="${a.address_id}"`,
          ctx,
        );
        if (count.trim() === "0") return `IPv6 address '${a.address_id}' not found.`;
      }
      const selector = byId ? `.id="${a.address_id}"` : `address="${a.address_id}"`;
      const result = await executeMikrotikCommand(`/ipv6 address remove [find ${selector}]`, ctx);
      if (looksLikeError(result)) return `Failed to remove IPv6 address: ${result}`;
      return `IPv6 address '${a.address_id}' removed successfully.`;
    },
  }),
];
