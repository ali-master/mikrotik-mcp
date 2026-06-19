/** DHCP servers, networks, and address pools — `/ip dhcp-server` and `/ip pool`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE,  READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type {ToolModule} from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

const Authoritative = z.enum(["yes", "no", "after-2sec-delay"]);

export const dhcpTools: ToolModule = [
  defineTool({
    name: "create_dhcp_server",
    title: "Create DHCP Server",
    annotations: WRITE,
    description:
      "Creates a DHCP server bound to the specified interface on the MikroTik device.\n\n" +
      'Notes:\n    lease_time: duration e.g. "1d", "12h", "30m", "1h30m"',
    inputSchema: {
      name: z.string(),
      interface: z.string(),
      lease_time: z.string().default("1d").describe('Lease duration e.g. "1d", "12h", "30m", "1h30m"'),
      address_pool: z.string().optional(),
      disabled: z.boolean().default(false),
      authoritative: Authoritative.default("yes"),
      delay_threshold: z.string().optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Creating DHCP server: name=${a.name}, interface=${a.interface}`);

      const cmd = new Cmd("/ip dhcp-server add")
        .set("name", a.name)
        .set("interface", a.interface)
        .set("lease-time", a.lease_time)
        .opt("address-pool", a.address_pool)
        .flag("disabled", a.disabled)
        .raw(a.authoritative !== "yes" ? `authoritative=${a.authoritative}` : null)
        .opt("delay-threshold", a.delay_threshold)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create DHCP server: ${result}`;

      const details = await executeMikrotikCommand(
        `/ip dhcp-server print detail where name="${a.name}"`,
        ctx,
      );
      return `DHCP server created successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "list_dhcp_servers",
    title: "List DHCP Servers",
    annotations: READ,
    description: "Lists DHCP servers on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      interface_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      invalid_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Listing DHCP servers with filters: name=${a.name_filter}, interface=${a.interface_filter}`);

      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.invalid_only) filters.push("invalid=yes");

      const result = await executeMikrotikCommand(`/ip dhcp-server print${whereClause(filters)}`, ctx);
      return isEmpty(result) ? "No DHCP servers found matching the criteria." : `DHCP SERVERS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_dhcp_server",
    title: "Get DHCP Server",
    annotations: READ,
    description: "Gets detailed information about a specific DHCP server.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting DHCP server details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ip dhcp-server print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result) ? `DHCP server '${a.name}' not found.` : `DHCP SERVER DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "create_dhcp_network",
    title: "Create DHCP Network",
    annotations: WRITE,
    description:
      "Creates a DHCP network configuration (gateway, DNS, domain, etc.) on the MikroTik device.",
    inputSchema: {
      network: z.string(),
      gateway: z.string(),
      netmask: z.string().optional(),
      dns_servers: z.array(z.string()).optional(),
      domain: z.string().optional(),
      wins_servers: z.array(z.string()).optional(),
      ntp_servers: z.array(z.string()).optional(),
      dhcp_option: z.array(z.string()).optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Creating DHCP network: network=${a.network}, gateway=${a.gateway}`);

      const cmd = new Cmd("/ip dhcp-server network add")
        .set("address", a.network)
        .set("gateway", a.gateway)
        .opt("netmask", a.netmask)
        .opt("dns-server", a.dns_servers?.length ? a.dns_servers.join(",") : undefined)
        .opt("domain", a.domain)
        .opt("wins-server", a.wins_servers?.length ? a.wins_servers.join(",") : undefined)
        .opt("ntp-server", a.ntp_servers?.length ? a.ntp_servers.join(",") : undefined)
        .opt("dhcp-option", a.dhcp_option?.length ? a.dhcp_option.join(",") : undefined)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create DHCP network: ${result}`;

      const details = await executeMikrotikCommand(
        `/ip dhcp-server network print detail where address="${a.network}"`,
        ctx,
      );
      return `DHCP network created successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "create_dhcp_pool",
    title: "Create DHCP Pool",
    annotations: WRITE,
    description:
      "Creates a DHCP address pool with the given IP ranges on the MikroTik device.\n\n" +
      'Notes:\n    ranges: hyphen-separated range(s) e.g. "192.168.1.1-192.168.1.100"\n' +
      '        Multiple ranges comma-separated: "10.0.0.1-10.0.0.50,10.0.0.100-10.0.0.120"',
    inputSchema: {
      name: z.string(),
      ranges: z.string().describe('IP range(s) e.g. "192.168.1.1-192.168.1.100"'),
      next_pool: z.string().optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Creating DHCP pool: name=${a.name}, ranges=${a.ranges}`);

      const cmd = new Cmd("/ip pool add")
        .set("name", a.name)
        .set("ranges", a.ranges)
        .opt("next-pool", a.next_pool)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create DHCP pool: ${result}`;

      const details = await executeMikrotikCommand(
        `/ip pool print detail where name="${a.name}"`,
        ctx,
      );
      return `DHCP pool created successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_dhcp_server",
    title: "Remove DHCP Server",
    annotations: DESTRUCTIVE,
    description: "Removes a DHCP server from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing DHCP server: name=${a.name}`);

      const count = await executeMikrotikCommand(
        `/ip dhcp-server print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `DHCP server '${a.name}' not found.`;

      const result = await executeMikrotikCommand(`/ip dhcp-server remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to remove DHCP server: ${result}`;

      return `DHCP server '${a.name}' removed successfully.`;
    },
  }),
];
