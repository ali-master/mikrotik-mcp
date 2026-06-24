/** L2TP VPN server and clients — `/interface l2tp-server` and `/interface l2tp-client`. Users come from `/ppp secret`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";
import { redactSecrets } from "../utils";

const UseIpsecServer = z.enum(["yes", "no", "required"]);
const UseIpsecClient = z.enum(["yes", "no"]);

export const l2tpTools: ToolModule = [
  // ── SERVER `/interface l2tp-server server` ────────────────────────────────
  defineTool({
    name: "get_l2tp_server",
    title: "Get L2TP Server",
    annotations: READ,
    description: "Gets the L2TP server configuration on the MikroTik device.",
    async handler(_a, ctx) {
      ctx.info("Getting L2TP server configuration");
      const result = await executeMikrotikCommand("/interface l2tp-server server print", ctx);
      return isEmpty(result)
        ? "L2TP server configuration not available."
        : `L2TP SERVER:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_l2tp_server",
    title: "Set L2TP Server",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Configures the L2TP server. For L2TP/IPsec road-warrior setups, set use_ipsec='required' and supply ipsec_secret.",
    inputSchema: {
      enabled: z.boolean().optional().describe("Enable or disable the L2TP server"),
      default_profile: z.string().optional(),
      authentication: z.string().optional().describe("Comma-separated, e.g. 'mschap2,mschap1'"),
      use_ipsec: UseIpsecServer.optional(),
      ipsec_secret: z.string().optional().describe("Pre-shared key for L2TP/IPsec"),
      max_mtu: z.number().int().optional(),
      max_mru: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Configuring L2TP server");
      const cmd = new Cmd("/interface l2tp-server server set")
        .bool("enabled", a.enabled)
        .opt("default-profile", a.default_profile)
        .opt("authentication", a.authentication)
        .opt("use-ipsec", a.use_ipsec)
        .opt("ipsec-secret", a.ipsec_secret)
        .opt("max-mtu", a.max_mtu)
        .opt("max-mru", a.max_mru)
        .build();

      if (cmd.trim() === "/interface l2tp-server server set") return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to configure L2TP server: ${result}`;

      const details = await executeMikrotikCommand("/interface l2tp-server server print", ctx);
      return `L2TP server configured successfully:\n\n${details}`;
    },
  }),

  // ── CLIENT `/interface l2tp-client` ───────────────────────────────────────
  defineTool({
    name: "create_l2tp_client",
    title: "Create L2TP Client",
    annotations: WRITE,
    description: "Creates an L2TP client interface that dials out to a remote L2TP server.",
    inputSchema: {
      name: z.string().describe("Name for the new L2TP client interface"),
      connect_to: z.string().describe("Remote L2TP server address"),
      user: z.string().describe("Username for authentication"),
      password: z.string().describe("Password for authentication"),
      profile: z.string().default("default-encryption"),
      add_default_route: z.boolean().optional(),
      use_ipsec: UseIpsecClient.optional(),
      ipsec_secret: z.string().optional().describe("Pre-shared key for L2TP/IPsec"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Creating L2TP client: name=${a.name}, connect_to=${a.connect_to}`);
      const cmd = new Cmd("/interface l2tp-client add")
        .set("name", a.name)
        .set("connect-to", a.connect_to)
        .set("user", a.user)
        .set("password", a.password)
        .opt("profile", a.profile)
        .bool("add-default-route", a.add_default_route)
        .opt("use-ipsec", a.use_ipsec)
        .opt("ipsec-secret", a.ipsec_secret)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create L2TP client: ${redactSecrets(result)}`;

      const details = await executeMikrotikCommand(
        `/interface l2tp-client print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `L2TP client created successfully:\n\n${redactSecrets(details)}`
        : "L2TP client creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_l2tp_clients",
    title: "List L2TP Clients",
    annotations: READ,
    description: "Lists L2TP client interfaces on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing L2TP clients");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface l2tp-client print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No L2TP clients found matching the criteria."
        : `L2TP CLIENTS:\n\n${redactSecrets(result)}`;
    },
  }),

  defineTool({
    name: "get_l2tp_client",
    title: "Get L2TP Client",
    annotations: READ,
    description:
      "Gets detailed information about a specific L2TP client. The password is redacted.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting L2TP client details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface l2tp-client print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `L2TP client '${a.name}' not found.`
        : `L2TP CLIENT DETAILS:\n\n${redactSecrets(result)}`;
    },
  }),

  defineTool({
    name: "remove_l2tp_client",
    title: "Remove L2TP Client",
    annotations: DESTRUCTIVE,
    description: "Removes an L2TP client interface from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing L2TP client: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/interface l2tp-client print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `L2TP client '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface l2tp-client remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove L2TP client: ${result}`;
      return `L2TP client '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_l2tp_client",
    title: "Enable L2TP Client",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables an L2TP client interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Enabling L2TP client: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface l2tp-client enable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to enable L2TP client: ${result}`;
      return `L2TP client '${a.name}' enabled successfully.`;
    },
  }),

  defineTool({
    name: "disable_l2tp_client",
    title: "Disable L2TP Client",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables an L2TP client interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Disabling L2TP client: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface l2tp-client disable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to disable L2TP client: ${result}`;
      return `L2TP client '${a.name}' disabled successfully.`;
    },
  }),
];
