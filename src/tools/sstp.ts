/** SSTP VPN (TLS) — `/interface sstp-server` + `/interface sstp-client`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE,  READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type {ToolModule} from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

/** Mask password values in printed output (mirrors the Python `re.sub`). */
function redactPassword(text: string): string {
  return text.replace(/password="[^"]*"/g, 'password="***"');
}

export const sstpTools: ToolModule = [
  defineTool({
    name: "get_sstp_server",
    title: "Get SSTP Server",
    annotations: READ,
    description: "Gets the SSTP server (TLS) configuration on the MikroTik device.",
    async handler(_a, ctx) {
      ctx.info("Getting SSTP server configuration");
      const result = await executeMikrotikCommand("/interface sstp-server server print", ctx);
      return isEmpty(result) ? "No SSTP server configuration found." : `SSTP SERVER:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_sstp_server",
    title: "Set SSTP Server",
    annotations: WRITE_IDEMPOTENT,
    description: "Configures the SSTP server (TLS-based VPN). Requires a TLS certificate.",
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
    title: "Create SSTP Client",
    annotations: WRITE,
    description: "Creates an SSTP client interface connecting to a remote SSTP server over TLS.",
    inputSchema: {
      name: z.string().describe("Name for the new SSTP client interface"),
      connect_to: z.string().describe("Remote SSTP server address (host:port or IP)"),
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
      const cmd = new Cmd("/interface sstp-client add")
        .set("name", a.name)
        .set("connect-to", a.connect_to)
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
      if (looksLikeError(result)) return `Failed to create SSTP client: ${redactPassword(result)}`;

      const details = await executeMikrotikCommand(
        `/interface sstp-client print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `SSTP client created successfully:\n\n${redactPassword(details)}`
        : "SSTP client creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_sstp_clients",
    title: "List SSTP Clients",
    annotations: READ,
    description: "Lists SSTP client interfaces on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing SSTP clients");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(`/interface sstp-client print${whereClause(filters)}`, ctx);
      return isEmpty(result) ? "No SSTP clients found matching the criteria." : `SSTP CLIENTS:\n\n${redactPassword(result)}`;
    },
  }),

  defineTool({
    name: "get_sstp_client",
    title: "Get SSTP Client",
    annotations: READ,
    description: "Gets detailed information about a specific SSTP client interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting SSTP client details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface sstp-client print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result) ? `SSTP client '${a.name}' not found.` : `SSTP CLIENT DETAILS:\n\n${redactPassword(result)}`;
    },
  }),

  defineTool({
    name: "remove_sstp_client",
    title: "Remove SSTP Client",
    annotations: DESTRUCTIVE,
    description: "Removes an SSTP client interface from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing SSTP client: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/interface sstp-client print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `SSTP client '${a.name}' not found.`;

      const result = await executeMikrotikCommand(`/interface sstp-client remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to remove SSTP client: ${result}`;
      return `SSTP client '${a.name}' removed successfully.`;
    },
  }),
];
