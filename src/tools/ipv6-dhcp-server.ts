/** DHCPv6 server, bindings and options — `/ipv6 dhcp-server`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const ipv6DhcpServerTools: ToolModule = [
  // ── Server ────────────────────────────────────────────────────────────────
  defineTool({
    name: "create_ipv6_dhcp_server",
    title: "Create DHCPv6 Server",
    annotations: WRITE,
    description:
      "Creates a DHCPv6 server bound to an interface on the MikroTik device.\n\n" +
      "Notes:\n" +
      "    address_pool: IPv6 pool the server delegates prefixes from.\n" +
      "    lease_time: duration e.g. '1d', '12h', '30m'.\n" +
      "    rapid_commit: allow the 2-message (Solicit/Reply) exchange.",
    inputSchema: {
      name: z.string(),
      interface: z.string(),
      address_pool: z
        .string()
        .describe("IPv6 pool name the server delegates from"),
      lease_time: z
        .string()
        .default("3d")
        .describe("Lease duration e.g. '1d', '12h', '30m'"),
      binding_script: z.string().optional(),
      rapid_commit: z.boolean().optional(),
      preference: z.number().int().min(0).max(255).optional(),
      route_distance: z.number().int().optional(),
      dhcp_option: z
        .array(z.string())
        .optional()
        .describe("Custom DHCPv6 option names"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Creating DHCPv6 server: name=${a.name}, interface=${a.interface}`,
      );
      const cmd = new Cmd("/ipv6 dhcp-server add")
        .set("name", a.name)
        .set("interface", a.interface)
        .set("address-pool", a.address_pool)
        .set("lease-time", a.lease_time)
        .opt("binding-script", a.binding_script)
        .bool("rapid-commit", a.rapid_commit)
        .opt("preference", a.preference)
        .opt("route-distance", a.route_distance)
        .opt(
          "dhcp-option",
          a.dhcp_option?.length ? a.dhcp_option.join(",") : undefined,
        )
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to create DHCPv6 server: ${result}`;
      const details = await executeMikrotikCommand(
        `/ipv6 dhcp-server print detail where name="${a.name}"`,
        ctx,
      );
      return `DHCPv6 server created successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "list_ipv6_dhcp_servers",
    title: "List DHCPv6 Servers",
    annotations: READ,
    description: "Lists DHCPv6 servers on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      interface_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      invalid_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing DHCPv6 servers");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.invalid_only) filters.push("invalid=yes");

      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-server print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No DHCPv6 servers found matching the criteria."
        : `DHCPV6 SERVERS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipv6_dhcp_server",
    title: "Get DHCPv6 Server",
    annotations: READ,
    description: "Gets detailed information about a specific DHCPv6 server.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting DHCPv6 server details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-server print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `DHCPv6 server '${a.name}' not found.`
        : `DHCPV6 SERVER DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_ipv6_dhcp_server",
    title: "Remove DHCPv6 Server",
    annotations: DESTRUCTIVE,
    description: "Removes a DHCPv6 server from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing DHCPv6 server: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/ipv6 dhcp-server print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `DHCPv6 server '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-server remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove DHCPv6 server: ${result}`;
      return `DHCPv6 server '${a.name}' removed successfully.`;
    },
  }),

  // ── Bindings (static prefix delegation) ─────────────────────────────────────
  defineTool({
    name: "add_ipv6_dhcp_binding",
    title: "Add DHCPv6 Binding",
    annotations: WRITE,
    description:
      "Adds a DHCPv6 server binding (static prefix/address assignment) on the " +
      "MikroTik device.\n\n" +
      "Notes:\n" +
      "    duid: client DHCP Unique Identifier the binding matches.\n" +
      "    prefix: the delegated prefix, e.g. '2001:db8:1::/64'.",
    inputSchema: {
      address: z.string().optional().describe("Assigned IPv6 address, if any"),
      prefix: z
        .string()
        .optional()
        .describe("Delegated prefix, e.g. '2001:db8:1::/64'"),
      duid: z.string().describe("Client DUID the binding matches"),
      iaid: z.string().optional().describe("Identity Association ID"),
      server: z.string().optional().describe("DHCPv6 server name, or 'all'"),
      life_time: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding DHCPv6 binding: duid=${a.duid}`);
      const cmd = new Cmd("/ipv6 dhcp-server binding add")
        .opt("address", a.address)
        .opt("prefix", a.prefix)
        .set("duid", a.duid)
        .opt("iaid", a.iaid)
        .opt("server", a.server)
        .opt("life-time", a.life_time)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to add DHCPv6 binding: ${result}`;
      const details = await executeMikrotikCommand(
        `/ipv6 dhcp-server binding print detail where duid="${a.duid}"`,
        ctx,
      );
      return details.trim()
        ? `DHCPv6 binding added successfully:\n\n${details}`
        : "DHCPv6 binding addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ipv6_dhcp_bindings",
    title: "List DHCPv6 Bindings",
    annotations: READ,
    description: "Lists DHCPv6 server bindings on the MikroTik device.",
    inputSchema: {
      server_filter: z.string().optional(),
      duid_filter: z.string().optional(),
      dynamic_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing DHCPv6 bindings");
      const filters: string[] = [];
      if (a.server_filter) filters.push(`server="${a.server_filter}"`);
      if (a.duid_filter) filters.push(`duid~"${a.duid_filter}"`);
      if (a.dynamic_only) filters.push("dynamic=yes");

      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-server binding print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No DHCPv6 bindings found matching the criteria."
        : `DHCPV6 BINDINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_ipv6_dhcp_binding",
    title: "Remove DHCPv6 Binding",
    annotations: DESTRUCTIVE,
    description:
      "Removes a DHCPv6 server binding by ID or DUID from the MikroTik device.",
    inputSchema: {
      binding_id: z.string().describe("RouterOS .id (e.g. '*1') or the DUID"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing DHCPv6 binding: binding_id=${a.binding_id}`);
      let byId = true;
      let count = await executeMikrotikCommand(
        `/ipv6 dhcp-server binding print count-only where .id="${a.binding_id}"`,
        ctx,
      );
      if (count.trim() === "0") {
        byId = false;
        count = await executeMikrotikCommand(
          `/ipv6 dhcp-server binding print count-only where duid="${a.binding_id}"`,
          ctx,
        );
        if (count.trim() === "0")
          return `DHCPv6 binding '${a.binding_id}' not found.`;
      }
      const selector = byId
        ? `.id="${a.binding_id}"`
        : `duid="${a.binding_id}"`;
      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-server binding remove [find ${selector}]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove DHCPv6 binding: ${result}`;
      return `DHCPv6 binding '${a.binding_id}' removed successfully.`;
    },
  }),

  // ── Options ─────────────────────────────────────────────────────────────────
  defineTool({
    name: "add_ipv6_dhcp_option",
    title: "Add DHCPv6 Option",
    annotations: WRITE,
    description:
      "Adds a custom DHCPv6 option on the MikroTik device.\n\n" +
      "Notes:\n" +
      "    code: numeric DHCPv6 option code.\n" +
      "    value: option value (use '0x...' for raw hex).",
    inputSchema: {
      name: z.string(),
      code: z.number().int().describe("Numeric DHCPv6 option code"),
      value: z.string().describe("Option value (use '0x...' for raw hex)"),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Adding DHCPv6 option: name=${a.name}, code=${a.code}`);
      const cmd = new Cmd("/ipv6 dhcp-server option add")
        .set("name", a.name)
        .set("code", a.code)
        .set("value", a.value)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to add DHCPv6 option: ${result}`;
      const details = await executeMikrotikCommand(
        `/ipv6 dhcp-server option print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `DHCPv6 option added successfully:\n\n${details}`
        : "DHCPv6 option addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ipv6_dhcp_options",
    title: "List DHCPv6 Options",
    annotations: READ,
    description: "Lists custom DHCPv6 options on the MikroTik device.",
    inputSchema: { name_filter: z.string().optional() },
    async handler(a, ctx) {
      ctx.info("Listing DHCPv6 options");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-server option print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No DHCPv6 options found matching the criteria."
        : `DHCPV6 OPTIONS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_ipv6_dhcp_option",
    title: "Remove DHCPv6 Option",
    annotations: DESTRUCTIVE,
    description:
      "Removes a custom DHCPv6 option by name from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing DHCPv6 option: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/ipv6 dhcp-server option print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `DHCPv6 option '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-server option remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove DHCPv6 option: ${result}`;
      return `DHCPv6 option '${a.name}' removed successfully.`;
    },
  }),
];
