/** SSTP VPN (TLS) — `/interface sstp-server` + `/interface sstp-client`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, splitHostPort, Cmd } from "../core/routeros";
import { redactSecrets } from "../utils";

export const sstpTools: ToolModule = [
  defineTool({
    name: "get_sstp_server",
    title: "Get SSTP Server Configuration",
    annotations: READ,
    description:
      "Read the global SSTP server listener settings (`/interface sstp-server server print`) — enabled state, TLS certificate, TCP port, authentication methods, default PPP profile, TLS version, and client-certificate verification flag. " +
      "Use this to inspect the server-side VPN endpoint before making changes. " +
      "To modify these settings use `set_sstp_server`. " +
      "For outbound SSTP client tunnel interfaces use `list_sstp_clients`. " +
      "Returns the full singleton server block.",
    async handler(_a, ctx) {
      ctx.info("Getting SSTP server configuration");
      const result = await executeMikrotikCommand("/interface sstp-server server print", ctx);
      return isEmpty(result) ? "No SSTP server configuration found." : `SSTP SERVER:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_sstp_server",
    title: "Set SSTP Server Configuration",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Configure the global SSTP server listener (`/interface sstp-server server set`) — accepts/rejects incoming TLS VPN connections on this router. " +
      "Use to enable the server, bind a TLS certificate, change the TCP port, restrict authentication methods (comma-separated, e.g. `'mschap2,mschap1'`), set the default PPP profile, pin TLS version (`any` or `only-1.2`), or enforce client certificate verification. " +
      "This is a singleton write that modifies the server block, not a client interface. " +
      "To read the current server config use `get_sstp_server`. " +
      "To create outbound SSTP tunnels (this router dials out) use `create_sstp_client`; for L2TP outbound use `create_l2tp_client`, for OpenVPN use `create_ovpn_client`, for PPTP use `create_pptp_client`. " +
      "Returns the updated server block on success.",
    inputSchema: {
      enabled: z.boolean().optional(),
      default_profile: z.string().optional(),
      authentication: z.string().optional().describe("Comma-separated, e.g. 'mschap2,mschap1'"),
      certificate: z.string().optional().describe("TLS certificate name"),
      port: z.number().int().optional(),
      tls_version: z.enum(["any", "only-1.2"]).optional(),
      verify_client_certificate: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Configuring SSTP server");
      const cmd = new Cmd("/interface sstp-server server set")
        .bool("enabled", a.enabled)
        .opt("default-profile", a.default_profile)
        .opt("authentication", a.authentication)
        .opt("certificate", a.certificate)
        .opt("port", a.port)
        .opt("tls-version", a.tls_version)
        .bool("verify-client-certificate", a.verify_client_certificate)
        .build();

      if (cmd === "/interface sstp-server server set") return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to configure SSTP server: ${result}`;

      const details = await executeMikrotikCommand("/interface sstp-server server print", ctx);
      return `SSTP server configured successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "create_sstp_client",
    title: "Create SSTP Client Interface",
    annotations: WRITE,
    description:
      "Create an outbound SSTP client tunnel interface (`/interface sstp-client add`) so this router dials out to a remote SSTP server over TLS. " +
      "Use when this device must act as a VPN client, not the VPN server — for server-side settings use `set_sstp_server`. " +
      "`connect_to` is the remote server address (IP or DNS name); the TCP port is separate. " +
      "You may pass the port in `port` or inline as `host:port` in `connect_to` (it is split out " +
      "automatically — RouterOS rejects a port embedded in connect-to). SSTP defaults to 443. " +
      "For L2TP outbound tunnels use `create_l2tp_client`, for OpenVPN use `create_ovpn_client`, for PPTP use `create_pptp_client`. " +
      "Credentials are accepted but redacted from return values. " +
      "Returns the created interface detail (name, status, remote address); use the interface `name` with `get_sstp_client` or `remove_sstp_client`.",
    inputSchema: {
      name: z.string().describe("Name for the new SSTP client interface"),
      connect_to: z
        .string()
        .describe("Remote SSTP server address (IP or DNS name; host:port also accepted)"),
      port: z.number().int().optional().describe("TCP port (default 443 if omitted)"),
      user: z.string(),
      password: z.string(),
      profile: z.string().optional(),
      certificate: z.string().optional().describe("Client TLS certificate name"),
      verify_server_certificate: z.boolean().optional(),
      add_default_route: z.boolean().optional(),
      http_proxy: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Creating SSTP client: name=${a.name}, connect_to=${a.connect_to}`);
      // RouterOS sstp-client takes the address and port as separate parameters;
      // an inline `host:port` in connect-to is rejected, so split it out. An
      // explicit `port` argument takes precedence over an inline one.
      const { host, port } = splitHostPort(a.connect_to);
      const cmd = new Cmd("/interface sstp-client add")
        .set("name", a.name)
        .set("connect-to", host)
        .opt("port", a.port ?? port)
        .set("user", a.user)
        .set("password", a.password)
        .opt("profile", a.profile)
        .opt("certificate", a.certificate)
        .bool("verify-server-certificate", a.verify_server_certificate)
        .bool("add-default-route", a.add_default_route)
        .opt("http-proxy", a.http_proxy)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create SSTP client: ${redactSecrets(result)}`;

      const details = await executeMikrotikCommand(
        `/interface sstp-client print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `SSTP client created successfully:\n\n${redactSecrets(details)}`
        : "SSTP client creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_sstp_clients",
    title: "List SSTP Client Interfaces",
    annotations: READ,
    description:
      "List all outbound SSTP client tunnel interfaces (`/interface sstp-client print`), optionally narrowed by partial name match via `name_filter`. " +
      "Use to discover existing SSTP tunnels and their connection status before creating or removing one. " +
      "Passwords are redacted in the output. " +
      "For full detail on a single client use `get_sstp_client` with the interface name. " +
      "To inspect the inbound SSTP server config use `get_sstp_server`. " +
      "Returns a summary list of all matching SSTP client entries.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing SSTP clients");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface sstp-client print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No SSTP clients found matching the criteria."
        : `SSTP CLIENTS:\n\n${redactSecrets(result)}`;
    },
  }),

  defineTool({
    name: "get_sstp_client",
    title: "Get SSTP Client Interface Detail",
    annotations: READ,
    description:
      "Return full detail for one SSTP client interface (`/interface sstp-client print detail where name=...`) by interface name — includes status, remote server address, TLS certificate, PPP profile, and connection options; passwords are redacted. " +
      "Use when you need the complete property set for a single tunnel rather than the summary list. " +
      "Use `list_sstp_clients` first to discover valid interface names. " +
      "For the inbound server configuration use `get_sstp_server`. " +
      "Returns the full detail block for the named interface, or a not-found message.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting SSTP client details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface sstp-client print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `SSTP client '${a.name}' not found.`
        : `SSTP CLIENT DETAILS:\n\n${redactSecrets(result)}`;
    },
  }),

  defineTool({
    name: "remove_sstp_client",
    title: "Remove SSTP Client Interface",
    annotations: DESTRUCTIVE,
    description:
      "Permanently delete an SSTP client tunnel interface (`/interface sstp-client remove [find name=...]`) by interface name. " +
      "First verifies the interface exists (count-only check), then removes it; the tunnel is torn down immediately and the action is irreversible. " +
      "Use `list_sstp_clients` to confirm the interface name before calling this tool. " +
      "For L2TP, OpenVPN, or PPTP client interfaces see their respective tool scopes (`create_l2tp_client`, `create_ovpn_client`, `create_pptp_client`). " +
      "To disable the interface without deleting it, no dedicated enable/disable tool exists in this scope — set `disabled=yes` via RouterOS directly. " +
      "Returns a confirmation message on success or a not-found message if the name does not exist.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing SSTP client: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/interface sstp-client print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `SSTP client '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface sstp-client remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove SSTP client: ${result}`;
      return `SSTP client '${a.name}' removed successfully.`;
    },
  }),
];
