/** OpenVPN (OVPN) — `/interface ovpn-server` + `/interface ovpn-client`. RouterOS 7 supports UDP + TCP. */
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

/** Mask password values in printed output (mirrors the Python `re.sub`). */
function redactPassword(text: string): string {
  return text.replace(/password="[^"]*"/g, 'password="***"');
}

export const openvpnTools: ToolModule = [
  defineTool({
    name: "get_ovpn_server",
    title: "Get OpenVPN Server",
    annotations: READ,
    description:
      "Gets the OpenVPN (OVPN) server configuration on the MikroTik device.",
    async handler(_a, ctx) {
      ctx.info("Getting OpenVPN server configuration");
      const result = await executeMikrotikCommand(
        "/interface ovpn-server server print",
        ctx,
      );
      return isEmpty(result)
        ? "No OpenVPN server configuration found."
        : `OPENVPN SERVER:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_ovpn_server",
    title: "Set OpenVPN Server",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Configures the OpenVPN (OVPN) server. RouterOS 7 supports both UDP and TCP.",
    inputSchema: {
      enabled: z.boolean().optional(),
      certificate: z.string().optional(),
      auth: z
        .string()
        .optional()
        .describe("Comma-separated, e.g. 'sha256,sha1'"),
      cipher: z
        .string()
        .optional()
        .describe("Comma-separated, e.g. 'aes256-cbc,aes256-gcm'"),
      netmask: z.number().int().optional(),
      mode: z.enum(["ip", "ethernet"]).optional(),
      port: z.number().int().optional(),
      protocol: z.enum(["tcp", "udp"]).optional(),
      default_profile: z.string().optional(),
      require_client_certificate: z.boolean().optional(),
      max_mtu: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Configuring OpenVPN server");
      const cmd = new Cmd("/interface ovpn-server server set")
        .bool("enabled", a.enabled)
        .opt("certificate", a.certificate)
        .opt("auth", a.auth)
        .opt("cipher", a.cipher)
        .opt("netmask", a.netmask)
        .opt("mode", a.mode)
        .opt("port", a.port)
        .opt("protocol", a.protocol)
        .opt("default-profile", a.default_profile)
        .bool("require-client-certificate", a.require_client_certificate)
        .opt("max-mtu", a.max_mtu)
        .build();

      if (cmd === "/interface ovpn-server server set")
        return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to configure OpenVPN server: ${result}`;

      const details = await executeMikrotikCommand(
        "/interface ovpn-server server print",
        ctx,
      );
      return `OpenVPN server configured successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "create_ovpn_client",
    title: "Create OpenVPN Client",
    annotations: WRITE,
    description:
      "Creates an OpenVPN (OVPN) client interface connecting to a remote OpenVPN server.",
    inputSchema: {
      name: z.string().describe("Name for the new OpenVPN client interface"),
      connect_to: z.string().describe("Remote OpenVPN server address"),
      port: z.number().int().default(1194),
      user: z.string().optional(),
      password: z.string().optional(),
      certificate: z.string().optional(),
      cipher: z.string().optional(),
      auth: z.string().optional(),
      mode: z.enum(["ip", "ethernet"]).optional(),
      protocol: z.enum(["tcp", "udp"]).optional(),
      profile: z.string().optional(),
      add_default_route: z.boolean().optional(),
      verify_server_certificate: z.boolean().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Creating OpenVPN client: name=${a.name}, connect_to=${a.connect_to}`,
      );
      const cmd = new Cmd("/interface ovpn-client add")
        .set("name", a.name)
        .set("connect-to", a.connect_to)
        .opt("port", a.port)
        .opt("user", a.user)
        .opt("password", a.password)
        .opt("certificate", a.certificate)
        .opt("cipher", a.cipher)
        .opt("auth", a.auth)
        .opt("mode", a.mode)
        .opt("protocol", a.protocol)
        .opt("profile", a.profile)
        .bool("add-default-route", a.add_default_route)
        .bool("verify-server-certificate", a.verify_server_certificate)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to create OpenVPN client: ${redactPassword(result)}`;

      const details = await executeMikrotikCommand(
        `/interface ovpn-client print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `OpenVPN client created successfully:\n\n${redactPassword(details)}`
        : "OpenVPN client creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ovpn_clients",
    title: "List OpenVPN Clients",
    annotations: READ,
    description:
      "Lists OpenVPN (OVPN) client interfaces on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing OpenVPN clients");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface ovpn-client print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No OpenVPN clients found matching the criteria."
        : `OPENVPN CLIENTS:\n\n${redactPassword(result)}`;
    },
  }),

  defineTool({
    name: "get_ovpn_client",
    title: "Get OpenVPN Client",
    annotations: READ,
    description:
      "Gets detailed information about a specific OpenVPN client interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting OpenVPN client details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface ovpn-client print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `OpenVPN client '${a.name}' not found.`
        : `OPENVPN CLIENT DETAILS:\n\n${redactPassword(result)}`;
    },
  }),

  defineTool({
    name: "remove_ovpn_client",
    title: "Remove OpenVPN Client",
    annotations: DESTRUCTIVE,
    description:
      "Removes an OpenVPN client interface from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing OpenVPN client: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/interface ovpn-client print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `OpenVPN client '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface ovpn-client remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove OpenVPN client: ${result}`;
      return `OpenVPN client '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_ovpn_client",
    title: "Enable OpenVPN Client",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables an OpenVPN client interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Enabling OpenVPN client: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface ovpn-client enable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to enable OpenVPN client: ${result}`;
      return `OpenVPN client '${a.name}' enabled successfully.`;
    },
  }),

  defineTool({
    name: "disable_ovpn_client",
    title: "Disable OpenVPN Client",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables an OpenVPN client interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Disabling OpenVPN client: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface ovpn-client disable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to disable OpenVPN client: ${result}`;
      return `OpenVPN client '${a.name}' disabled successfully.`;
    },
  }),
];
