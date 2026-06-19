/**
 * WireGuard interfaces and peers — `/interface wireguard` and `/interface wireguard peers`.
 *
 * Covers interface CRUD plus enable/disable, peer CRUD plus enable/disable, and a
 * pure config-text generator (`generate_wireguard_client_config`) that never
 * touches the device.
 */
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
  whereClause,
  quoteValue,
  looksLikeError,
  isEmpty,
  Cmd,
} from "../core/routeros";

export const wireguardTools: ToolModule = [
  // ── WireGuard Interface Management ────────────────────────────────────────
  defineTool({
    name: "create_wireguard_interface",
    title: "Create WireGuard Interface",
    annotations: WRITE,
    description: "Creates a WireGuard interface on the MikroTik device.",
    inputSchema: {
      name: z.string(),
      listen_port: z.number().int().optional(),
      private_key: z.string().optional(),
      mtu: z.number().int().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Creating WireGuard interface: name=${a.name}`);
      const cmd = new Cmd("/interface wireguard add")
        .set("name", a.name)
        .opt("listen-port", a.listen_port)
        .opt("private-key", a.private_key)
        .opt("mtu", a.mtu)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to create WireGuard interface: ${result}`;

      const details = await executeMikrotikCommand(
        `/interface wireguard print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `WireGuard interface created successfully:\n\n${details}`
        : "WireGuard interface created successfully.";
    },
  }),

  defineTool({
    name: "list_wireguard_interfaces",
    title: "List WireGuard Interfaces",
    annotations: READ,
    description: "Lists WireGuard interfaces on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      running_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing WireGuard interfaces");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.running_only) filters.push("running=yes");

      const result = await executeMikrotikCommand(
        `/interface wireguard print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No WireGuard interfaces found."
        : `WIREGUARD INTERFACES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_wireguard_interface",
    title: "Get WireGuard Interface",
    annotations: READ,
    description:
      "Gets detailed information about a specific WireGuard interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting WireGuard interface details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface wireguard print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `WireGuard interface '${a.name}' not found.`
        : `WIREGUARD INTERFACE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_wireguard_interface",
    title: "Update WireGuard Interface",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates an existing WireGuard interface's settings on the MikroTik device.",
    inputSchema: {
      name: z.string(),
      new_name: z.string().optional(),
      listen_port: z.number().int().optional(),
      private_key: z.string().optional(),
      mtu: z.number().int().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating WireGuard interface: name=${a.name}`);
      const base = `/interface wireguard set [find name="${a.name}"]`;
      const cmd = new Cmd(base)
        .opt("name", a.new_name)
        .opt("listen-port", a.listen_port)
        .opt("private-key", a.private_key)
        .opt("mtu", a.mtu)
        .raw(
          a.comment !== undefined ? `comment=${quoteValue(a.comment)}` : null,
        )
        .bool("disabled", a.disabled)
        .build();

      if (cmd === base) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to update WireGuard interface: ${result}`;

      const lookupName = a.new_name ? a.new_name : a.name;
      const details = await executeMikrotikCommand(
        `/interface wireguard print detail where name="${lookupName}"`,
        ctx,
      );
      return `WireGuard interface updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_wireguard_interface",
    title: "Remove WireGuard Interface",
    annotations: DESTRUCTIVE,
    description: "Removes a WireGuard interface from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing WireGuard interface: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/interface wireguard print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0")
        return `WireGuard interface '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface wireguard remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove WireGuard interface: ${result}`;
      return `WireGuard interface '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_wireguard_interface",
    title: "Enable WireGuard Interface",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a WireGuard interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Enabling WireGuard interface: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface wireguard enable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to enable WireGuard interface: ${result}`;
      return `WireGuard interface '${a.name}' enabled successfully.`;
    },
  }),

  defineTool({
    name: "disable_wireguard_interface",
    title: "Disable WireGuard Interface",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a WireGuard interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Disabling WireGuard interface: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface wireguard disable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to disable WireGuard interface: ${result}`;
      return `WireGuard interface '${a.name}' disabled successfully.`;
    },
  }),

  // ── WireGuard Peer Management ─────────────────────────────────────────────
  defineTool({
    name: "add_wireguard_peer",
    title: "Add WireGuard Peer",
    annotations: WRITE,
    description:
      "Adds a WireGuard peer (with public key and allowed addresses) to an interface on the MikroTik device.\n\n" +
      "Notes:\n" +
      '  allowed_address: CIDR, comma-separated for multiple e.g. "10.0.0.2/32" or "10.0.0.0/24,192.168.0.0/24"\n' +
      '  endpoint_address: remote host IP or hostname e.g. "203.0.113.1"\n' +
      '  persistent_keepalive: seconds as string e.g. "25"',
    inputSchema: {
      interface: z.string(),
      public_key: z.string(),
      allowed_address: z
        .string()
        .describe(
          'CIDR, comma-separated for multiple e.g. "10.0.0.2/32" or "10.0.0.0/24,192.168.0.0/24"',
        ),
      endpoint_address: z
        .string()
        .optional()
        .describe('remote host IP or hostname e.g. "203.0.113.1"'),
      endpoint_port: z.number().int().optional(),
      preshared_key: z.string().optional(),
      persistent_keepalive: z
        .string()
        .optional()
        .describe('seconds as string e.g. "25"'),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Adding WireGuard peer: interface=${a.interface}, public_key=${a.public_key.slice(0, 12)}...`,
      );
      const cmd = new Cmd("/interface wireguard peers add")
        .set("interface", a.interface)
        .set("public-key", a.public_key)
        .set("allowed-address", a.allowed_address)
        .opt("endpoint-address", a.endpoint_address)
        .opt("endpoint-port", a.endpoint_port)
        .opt("preshared-key", a.preshared_key)
        .opt("persistent-keepalive", a.persistent_keepalive)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to add WireGuard peer: ${result}`;

      const details = await executeMikrotikCommand(
        `/interface wireguard peers print detail where interface="${a.interface}" public-key="${a.public_key}"`,
        ctx,
      );
      return details.trim()
        ? `WireGuard peer added successfully:\n\n${details}`
        : "WireGuard peer added successfully.";
    },
  }),

  defineTool({
    name: "list_wireguard_peers",
    title: "List WireGuard Peers",
    annotations: READ,
    description: "Lists WireGuard peers on the MikroTik device.",
    inputSchema: {
      interface_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing WireGuard peers");
      const filters: string[] = [];
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");

      const result = await executeMikrotikCommand(
        `/interface wireguard peers print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No WireGuard peers found."
        : `WIREGUARD PEERS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_wireguard_peer",
    title: "Get WireGuard Peer",
    annotations: READ,
    description:
      "Gets detailed information about a specific WireGuard peer by ID.\n\n" +
      "Notes:\n" +
      '  peer_id: "*N" or "N" from list output e.g. "*2"',
    inputSchema: {
      peer_id: z.string().describe('"*N" or "N" from list output e.g. "*2"'),
    },
    async handler(a, ctx) {
      ctx.info(`Getting WireGuard peer details: peer_id=${a.peer_id}`);
      const result = await executeMikrotikCommand(
        `/interface wireguard peers print detail where .id=${a.peer_id}`,
        ctx,
      );
      return isEmpty(result)
        ? `WireGuard peer with ID '${a.peer_id}' not found.`
        : `WIREGUARD PEER DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_wireguard_peer",
    title: "Update WireGuard Peer",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates an existing WireGuard peer's allowed addresses, endpoint, keepalive, or enabled state.\n\n" +
      "Notes:\n" +
      '  peer_id: "*N" or "N" from list output e.g. "*2"\n' +
      '  allowed_address: CIDR, comma-separated e.g. "10.0.0.2/32" or "10.0.0.0/24,192.168.0.0/24"\n' +
      '  persistent_keepalive: seconds as string e.g. "25"\n' +
      '  Pass "" for endpoint_address or preshared_key to clear them.',
    inputSchema: {
      peer_id: z.string().describe('"*N" or "N" from list output e.g. "*2"'),
      allowed_address: z.string().optional(),
      endpoint_address: z.string().optional(),
      endpoint_port: z.number().int().optional(),
      preshared_key: z.string().optional(),
      persistent_keepalive: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating WireGuard peer: peer_id=${a.peer_id}`);
      const base = `/interface wireguard peers set ${a.peer_id}`;
      const cmd = new Cmd(base)
        .raw(
          a.allowed_address !== undefined
            ? `allowed-address=${quoteValue(a.allowed_address)}`
            : null,
        )
        .raw(
          a.endpoint_address !== undefined
            ? a.endpoint_address === ""
              ? "!endpoint-address"
              : `endpoint-address=${quoteValue(a.endpoint_address)}`
            : null,
        )
        .opt("endpoint-port", a.endpoint_port)
        .raw(
          a.preshared_key !== undefined
            ? a.preshared_key === ""
              ? "!preshared-key"
              : `preshared-key=${quoteValue(a.preshared_key)}`
            : null,
        )
        .raw(
          a.persistent_keepalive !== undefined
            ? `persistent-keepalive=${a.persistent_keepalive}`
            : null,
        )
        .raw(
          a.comment !== undefined ? `comment=${quoteValue(a.comment)}` : null,
        )
        .bool("disabled", a.disabled)
        .build();

      if (cmd === base) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to update WireGuard peer: ${result}`;

      const details = await executeMikrotikCommand(
        `/interface wireguard peers print detail where .id=${a.peer_id}`,
        ctx,
      );
      return `WireGuard peer updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_wireguard_peer",
    title: "Remove WireGuard Peer",
    annotations: DESTRUCTIVE,
    description:
      "Removes a WireGuard peer from the MikroTik device.\n\n" +
      "Notes:\n" +
      '  peer_id: "*N" or "N" from list output e.g. "*2"',
    inputSchema: {
      peer_id: z.string().describe('"*N" or "N" from list output e.g. "*2"'),
    },
    async handler(a, ctx) {
      ctx.info(`Removing WireGuard peer: peer_id=${a.peer_id}`);
      const count = await executeMikrotikCommand(
        `/interface wireguard peers print count-only where .id=${a.peer_id}`,
        ctx,
      );
      if (count.trim() === "0")
        return `WireGuard peer with ID '${a.peer_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface wireguard peers remove ${a.peer_id}`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove WireGuard peer: ${result}`;
      return `WireGuard peer '${a.peer_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_wireguard_peer",
    title: "Enable WireGuard Peer",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Enables a WireGuard peer.\n\n" +
      "Notes:\n" +
      '  peer_id: "*N" or "N" from list output e.g. "*2"',
    inputSchema: {
      peer_id: z.string().describe('"*N" or "N" from list output e.g. "*2"'),
    },
    async handler(a, ctx) {
      ctx.info(`Enabling WireGuard peer: peer_id=${a.peer_id}`);
      const result = await executeMikrotikCommand(
        `/interface wireguard peers enable ${a.peer_id}`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to enable WireGuard peer: ${result}`;
      return `WireGuard peer '${a.peer_id}' enabled successfully.`;
    },
  }),

  defineTool({
    name: "disable_wireguard_peer",
    title: "Disable WireGuard Peer",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Disables a WireGuard peer.\n\n" +
      "Notes:\n" +
      '  peer_id: "*N" or "N" from list output e.g. "*2"',
    inputSchema: {
      peer_id: z.string().describe('"*N" or "N" from list output e.g. "*2"'),
    },
    async handler(a, ctx) {
      ctx.info(`Disabling WireGuard peer: peer_id=${a.peer_id}`);
      const result = await executeMikrotikCommand(
        `/interface wireguard peers disable ${a.peer_id}`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to disable WireGuard peer: ${result}`;
      return `WireGuard peer '${a.peer_id}' disabled successfully.`;
    },
  }),

  defineTool({
    name: "generate_wireguard_client_config",
    title: "Generate WireGuard Client Config",
    annotations: READ,
    description:
      "Generates a wg0.conf client config string from the given keys and server endpoint. Does not communicate with the router.",
    inputSchema: {
      client_private_key: z.string(),
      client_address: z.string(),
      server_public_key: z.string(),
      server_endpoint: z.string(),
      server_port: z.number().int().default(51820),
      allowed_ips: z.string().default("0.0.0.0/0"),
      dns: z.string().optional(),
      persistent_keepalive: z.number().int().default(25),
    },
    async handler(a, ctx) {
      ctx.info("Generating WireGuard client configuration");

      const lines = [
        "[Interface]",
        `PrivateKey = ${a.client_private_key}`,
        `Address = ${a.client_address}`,
      ];

      if (a.dns) lines.push(`DNS = ${a.dns}`);

      lines.push(
        "",
        "[Peer]",
        `PublicKey = ${a.server_public_key}`,
        `Endpoint = ${a.server_endpoint}:${a.server_port}`,
        `AllowedIPs = ${a.allowed_ips}`,
      );

      if (a.persistent_keepalive > 0)
        lines.push(`PersistentKeepalive = ${a.persistent_keepalive}`);

      const configText = lines.join("\n");

      return (
        "WIREGUARD CLIENT CONFIGURATION\n" +
        "Save as /etc/wireguard/wg0.conf (Linux) or import into your WireGuard app:\n\n" +
        `${configText}\n\n` +
        "NEXT STEPS:\n" +
        "1. Generate the client key-pair on the client device:\n" +
        "     wg genkey | tee private.key | wg pubkey > public.key\n" +
        "2. Replace 'PrivateKey' above with the content of private.key.\n" +
        "3. Register the client's public key on the server with add_wireguard_peer,\n" +
        `   setting allowed_address to ${a.client_address.split("/")[0]}/32.\n` +
        "4. Bring the tunnel up:\n" +
        "     wg-quick up wg0"
      );
    },
  }),
];
