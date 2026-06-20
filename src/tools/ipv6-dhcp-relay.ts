/** DHCPv6 relay — `/ipv6 dhcp-relay`. */
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

export const ipv6DhcpRelayTools: ToolModule = [
  defineTool({
    name: "add_ipv6_dhcp_relay",
    title: "Add DHCPv6 Relay",
    annotations: WRITE,
    description:
      "Adds a DHCPv6 relay on the MikroTik device, forwarding client requests " +
      "from a local interface to upstream DHCPv6 server(s).\n\n" +
      "Notes:\n" +
      "    dhcp_server: comma-separated IPv6 address(es) of upstream servers.\n" +
      "    interface: the interface facing the DHCPv6 clients.",
    inputSchema: {
      name: z.string(),
      interface: z.string().describe("Interface facing the DHCPv6 clients"),
      dhcp_server: z
        .string()
        .describe("Comma-separated upstream DHCPv6 server IPv6 address(es)"),
      delay_time: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding DHCPv6 relay: name=${a.name}`);
      const cmd = new Cmd("/ipv6 dhcp-relay add")
        .set("name", a.name)
        .set("interface", a.interface)
        .set("dhcp-server", a.dhcp_server)
        .opt("delay-time", a.delay_time)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to add DHCPv6 relay: ${result}`;
      const details = await executeMikrotikCommand(
        `/ipv6 dhcp-relay print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `DHCPv6 relay added successfully:\n\n${details}`
        : "DHCPv6 relay addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ipv6_dhcp_relays",
    title: "List DHCPv6 Relays",
    annotations: READ,
    description: "Lists DHCPv6 relays on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      interface_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing DHCPv6 relays");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");

      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-relay print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No DHCPv6 relays found matching the criteria."
        : `DHCPV6 RELAYS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipv6_dhcp_relay",
    title: "Get DHCPv6 Relay",
    annotations: READ,
    description: "Gets detailed information about a specific DHCPv6 relay.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting DHCPv6 relay details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-relay print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `DHCPv6 relay '${a.name}' not found.`
        : `DHCPV6 RELAY DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "enable_ipv6_dhcp_relay",
    title: "Enable DHCPv6 Relay",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a DHCPv6 relay on the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Enabling DHCPv6 relay: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-relay enable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to enable DHCPv6 relay: ${result}`;
      return `DHCPv6 relay '${a.name}' enabled successfully.`;
    },
  }),

  defineTool({
    name: "disable_ipv6_dhcp_relay",
    title: "Disable DHCPv6 Relay",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a DHCPv6 relay on the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Disabling DHCPv6 relay: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-relay disable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to disable DHCPv6 relay: ${result}`;
      return `DHCPv6 relay '${a.name}' disabled successfully.`;
    },
  }),

  defineTool({
    name: "remove_ipv6_dhcp_relay",
    title: "Remove DHCPv6 Relay",
    annotations: DESTRUCTIVE,
    description: "Removes a DHCPv6 relay from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing DHCPv6 relay: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/ipv6 dhcp-relay print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `DHCPv6 relay '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/ipv6 dhcp-relay remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove DHCPv6 relay: ${result}`;
      return `DHCPv6 relay '${a.name}' removed successfully.`;
    },
  }),
];
