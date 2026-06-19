/**
 * L2/L3 tunnel interfaces — GRE, IPIP, EoIP, VXLAN.
 *
 * Covers `/interface gre`, `/interface ipip`, `/interface eoip`, and
 * `/interface vxlan`. Each tunnel type exposes the same create/list/get/remove
 * lifecycle and follows the canonical tool-module pattern (see `vlan.ts`).
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

const DontFragment = z.enum(["inherit", "no"]);

export const tunnelTools: ToolModule = [
  // ── GRE — `/interface gre` ────────────────────────────────────────────────
  defineTool({
    name: "create_gre_tunnel",
    title: "Create GRE Tunnel",
    annotations: WRITE,
    description:
      "Creates a GRE (Generic Routing Encapsulation) L3 tunnel interface on the MikroTik device.",
    inputSchema: {
      name: z
        .string()
        .describe("Name for the new GRE tunnel interface, e.g. 'gre-to-hq'"),
      remote_address: z.string().describe("Remote endpoint IP address"),
      local_address: z
        .string()
        .optional()
        .describe("Local endpoint IP address"),
      keepalive: z
        .string()
        .optional()
        .describe("Keepalive interval/retries, e.g. '10s,3'"),
      dont_fragment: DontFragment.optional().describe(
        "Don't-fragment behavior",
      ),
      clamp_tcp_mss: z
        .boolean()
        .optional()
        .describe("Clamp TCP MSS to the tunnel MTU"),
      mtu: z.number().int().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Creating GRE tunnel: name=${a.name}, remote_address=${a.remote_address}`,
      );
      const cmd = new Cmd("/interface gre add")
        .set("name", a.name)
        .set("remote-address", a.remote_address)
        .opt("local-address", a.local_address)
        .opt("keepalive", a.keepalive)
        .opt("dont-fragment", a.dont_fragment)
        .bool("clamp-tcp-mss", a.clamp_tcp_mss)
        .opt("mtu", a.mtu)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to create GRE tunnel: ${result}`;

      const details = await executeMikrotikCommand(
        `/interface gre print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `GRE tunnel created successfully:\n\n${details}`
        : "GRE tunnel creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_gre_tunnels",
    title: "List GRE Tunnels",
    annotations: READ,
    description: "Lists GRE tunnel interfaces on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing GRE tunnels");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface gre print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No GRE tunnels found matching the criteria."
        : `GRE TUNNELS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_gre_tunnel",
    title: "Get GRE Tunnel",
    annotations: READ,
    description:
      "Gets detailed information about a specific GRE tunnel interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting GRE tunnel details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface gre print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `GRE tunnel '${a.name}' not found.`
        : `GRE TUNNEL DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_gre_tunnel",
    title: "Remove GRE Tunnel",
    annotations: DESTRUCTIVE,
    description: "Removes a GRE tunnel interface from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing GRE tunnel: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/interface gre print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `GRE tunnel '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface gre remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove GRE tunnel: ${result}`;
      return `GRE tunnel '${a.name}' removed successfully.`;
    },
  }),

  // ── IPIP — `/interface ipip` ──────────────────────────────────────────────
  defineTool({
    name: "create_ipip_tunnel",
    title: "Create IPIP Tunnel",
    annotations: WRITE,
    description:
      "Creates an IPIP (IP-in-IP) L3 tunnel interface on the MikroTik device.",
    inputSchema: {
      name: z
        .string()
        .describe("Name for the new IPIP tunnel interface, e.g. 'ipip-to-hq'"),
      remote_address: z.string().describe("Remote endpoint IP address"),
      local_address: z
        .string()
        .optional()
        .describe("Local endpoint IP address"),
      keepalive: z
        .string()
        .optional()
        .describe("Keepalive interval/retries, e.g. '10s,3'"),
      mtu: z.number().int().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Creating IPIP tunnel: name=${a.name}, remote_address=${a.remote_address}`,
      );
      const cmd = new Cmd("/interface ipip add")
        .set("name", a.name)
        .set("remote-address", a.remote_address)
        .opt("local-address", a.local_address)
        .opt("keepalive", a.keepalive)
        .opt("mtu", a.mtu)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to create IPIP tunnel: ${result}`;

      const details = await executeMikrotikCommand(
        `/interface ipip print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `IPIP tunnel created successfully:\n\n${details}`
        : "IPIP tunnel creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ipip_tunnels",
    title: "List IPIP Tunnels",
    annotations: READ,
    description: "Lists IPIP tunnel interfaces on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPIP tunnels");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface ipip print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No IPIP tunnels found matching the criteria."
        : `IPIP TUNNELS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipip_tunnel",
    title: "Get IPIP Tunnel",
    annotations: READ,
    description:
      "Gets detailed information about a specific IPIP tunnel interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting IPIP tunnel details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface ipip print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `IPIP tunnel '${a.name}' not found.`
        : `IPIP TUNNEL DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_ipip_tunnel",
    title: "Remove IPIP Tunnel",
    annotations: DESTRUCTIVE,
    description: "Removes an IPIP tunnel interface from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing IPIP tunnel: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/interface ipip print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `IPIP tunnel '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface ipip remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove IPIP tunnel: ${result}`;
      return `IPIP tunnel '${a.name}' removed successfully.`;
    },
  }),

  // ── EoIP — `/interface eoip` (Ethernet over IP, L2) ───────────────────────
  defineTool({
    name: "create_eoip_tunnel",
    title: "Create EoIP Tunnel",
    annotations: WRITE,
    description:
      "Creates an EoIP (Ethernet over IP) L2 tunnel interface on the MikroTik device. Bridgeable; each tunnel needs a unique tunnel-id matching the remote peer.",
    inputSchema: {
      name: z
        .string()
        .describe("Name for the new EoIP tunnel interface, e.g. 'eoip-to-hq'"),
      remote_address: z.string().describe("Remote endpoint IP address"),
      tunnel_id: z
        .number()
        .int()
        .describe("Unique tunnel ID, must match on both peers"),
      local_address: z
        .string()
        .optional()
        .describe("Local endpoint IP address"),
      keepalive: z
        .string()
        .optional()
        .describe("Keepalive interval/retries, e.g. '10s,3'"),
      mtu: z.number().int().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Creating EoIP tunnel: name=${a.name}, remote_address=${a.remote_address}, tunnel_id=${a.tunnel_id}`,
      );
      const cmd = new Cmd("/interface eoip add")
        .set("name", a.name)
        .set("remote-address", a.remote_address)
        .set("tunnel-id", a.tunnel_id)
        .opt("local-address", a.local_address)
        .opt("keepalive", a.keepalive)
        .opt("mtu", a.mtu)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to create EoIP tunnel: ${result}`;

      const details = await executeMikrotikCommand(
        `/interface eoip print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `EoIP tunnel created successfully:\n\n${details}`
        : "EoIP tunnel creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_eoip_tunnels",
    title: "List EoIP Tunnels",
    annotations: READ,
    description: "Lists EoIP tunnel interfaces on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing EoIP tunnels");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface eoip print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No EoIP tunnels found matching the criteria."
        : `EOIP TUNNELS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_eoip_tunnel",
    title: "Get EoIP Tunnel",
    annotations: READ,
    description:
      "Gets detailed information about a specific EoIP tunnel interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting EoIP tunnel details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface eoip print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `EoIP tunnel '${a.name}' not found.`
        : `EOIP TUNNEL DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_eoip_tunnel",
    title: "Remove EoIP Tunnel",
    annotations: DESTRUCTIVE,
    description: "Removes an EoIP tunnel interface from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing EoIP tunnel: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/interface eoip print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `EoIP tunnel '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface eoip remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove EoIP tunnel: ${result}`;
      return `EoIP tunnel '${a.name}' removed successfully.`;
    },
  }),

  // ── VXLAN — `/interface vxlan` ────────────────────────────────────────────
  defineTool({
    name: "create_vxlan_tunnel",
    title: "Create VXLAN Tunnel",
    annotations: WRITE,
    description:
      "Creates a VXLAN (Virtual Extensible LAN) L2 overlay interface on the MikroTik device.",
    inputSchema: {
      name: z
        .string()
        .describe("Name for the new VXLAN interface, e.g. 'vxlan1'"),
      vni: z.number().int().describe("VXLAN Network Identifier (VNI)"),
      port: z.number().int().default(8472).describe("UDP port (default 8472)"),
      local_address: z.string().optional().describe("Local source IP address"),
      interface: z.string().optional().describe("Source interface"),
      mtu: z.number().int().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Creating VXLAN tunnel: name=${a.name}, vni=${a.vni}`);
      const cmd = new Cmd("/interface vxlan add")
        .set("name", a.name)
        .set("vni", a.vni)
        .opt("port", a.port)
        .opt("local-address", a.local_address)
        .opt("interface", a.interface)
        .opt("mtu", a.mtu)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to create VXLAN tunnel: ${result}`;

      const details = await executeMikrotikCommand(
        `/interface vxlan print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `VXLAN tunnel created successfully:\n\n${details}`
        : "VXLAN tunnel creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_vxlan_tunnels",
    title: "List VXLAN Tunnels",
    annotations: READ,
    description: "Lists VXLAN interfaces on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing VXLAN tunnels");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface vxlan print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No VXLAN tunnels found matching the criteria."
        : `VXLAN TUNNELS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_vxlan_tunnel",
    title: "Get VXLAN Tunnel",
    annotations: READ,
    description: "Gets detailed information about a specific VXLAN interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting VXLAN tunnel details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface vxlan print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `VXLAN tunnel '${a.name}' not found.`
        : `VXLAN TUNNEL DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_vxlan_tunnel",
    title: "Remove VXLAN Tunnel",
    annotations: DESTRUCTIVE,
    description: "Removes a VXLAN interface from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing VXLAN tunnel: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/interface vxlan print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `VXLAN tunnel '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface vxlan remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove VXLAN tunnel: ${result}`;
      return `VXLAN tunnel '${a.name}' removed successfully.`;
    },
  }),
];
