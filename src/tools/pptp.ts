/**
 * PPTP VPN server and clients — `/interface pptp-server` and `/interface pptp-client`.
 *
 * NOTE: PPTP is legacy and cryptographically weak (MS-CHAPv2/MPPE). Prefer
 * L2TP/IPsec, SSTP, or WireGuard for new deployments.
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
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";
import { redactSecrets } from "../utils";


export const pptpTools: ToolModule = [
  // ── SERVER `/interface pptp-server server` ────────────────────────────────
  defineTool({
    name: "get_pptp_server",
    title: "Get PPTP Server",
    annotations: READ,
    description:
      "Gets the PPTP server configuration. NOTE: PPTP is legacy/weak — prefer L2TP/IPsec, SSTP, or WireGuard.",
    async handler(_a, ctx) {
      ctx.info("Getting PPTP server configuration");
      const result = await executeMikrotikCommand(
        "/interface pptp-server server print",
        ctx,
      );
      return isEmpty(result)
        ? "PPTP server configuration not available."
        : `PPTP SERVER:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_pptp_server",
    title: "Set PPTP Server",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Configures the PPTP server. NOTE: PPTP is legacy/weak — prefer L2TP/IPsec, SSTP, or WireGuard for new deployments.",
    inputSchema: {
      enabled: z
        .boolean()
        .optional()
        .describe("Enable or disable the PPTP server"),
      default_profile: z.string().optional(),
      authentication: z
        .string()
        .optional()
        .describe("Comma-separated, e.g. 'mschap2,mschap1'"),
      max_mtu: z.number().int().optional(),
      max_mru: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Configuring PPTP server");
      const cmd = new Cmd("/interface pptp-server server set")
        .bool("enabled", a.enabled)
        .opt("default-profile", a.default_profile)
        .opt("authentication", a.authentication)
        .opt("max-mtu", a.max_mtu)
        .opt("max-mru", a.max_mru)
        .build();

      if (cmd.trim() === "/interface pptp-server server set")
        return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to configure PPTP server: ${result}`;

      const details = await executeMikrotikCommand(
        "/interface pptp-server server print",
        ctx,
      );
      return `PPTP server configured successfully:\n\n${details}`;
    },
  }),

  // ── CLIENT `/interface pptp-client` ───────────────────────────────────────
  defineTool({
    name: "create_pptp_client",
    title: "Create PPTP Client",
    annotations: WRITE,
    description:
      "Creates a PPTP client interface that dials out to a remote PPTP server. NOTE: PPTP is legacy/weak — prefer L2TP/IPsec, SSTP, or WireGuard.",
    inputSchema: {
      name: z.string().describe("Name for the new PPTP client interface"),
      connect_to: z.string().describe("Remote PPTP server address"),
      user: z.string().describe("Username for authentication"),
      password: z.string().describe("Password for authentication"),
      profile: z.string().optional(),
      add_default_route: z.boolean().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Creating PPTP client: name=${a.name}, connect_to=${a.connect_to}`,
      );
      const cmd = new Cmd("/interface pptp-client add")
        .set("name", a.name)
        .set("connect-to", a.connect_to)
        .set("user", a.user)
        .set("password", a.password)
        .opt("profile", a.profile)
        .bool("add-default-route", a.add_default_route)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to create PPTP client: ${redactSecrets(result)}`;

      const details = await executeMikrotikCommand(
        `/interface pptp-client print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `PPTP client created successfully:\n\n${redactSecrets(details)}`
        : "PPTP client creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_pptp_clients",
    title: "List PPTP Clients",
    annotations: READ,
    description: "Lists PPTP client interfaces on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing PPTP clients");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface pptp-client print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No PPTP clients found matching the criteria."
        : `PPTP CLIENTS:\n\n${redactSecrets(result)}`;
    },
  }),

  defineTool({
    name: "get_pptp_client",
    title: "Get PPTP Client",
    annotations: READ,
    description:
      "Gets detailed information about a specific PPTP client. The password is redacted.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting PPTP client details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface pptp-client print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `PPTP client '${a.name}' not found.`
        : `PPTP CLIENT DETAILS:\n\n${redactSecrets(result)}`;
    },
  }),

  defineTool({
    name: "remove_pptp_client",
    title: "Remove PPTP Client",
    annotations: DESTRUCTIVE,
    description: "Removes a PPTP client interface from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing PPTP client: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/interface pptp-client print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `PPTP client '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface pptp-client remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove PPTP client: ${result}`;
      return `PPTP client '${a.name}' removed successfully.`;
    },
  }),
];
