/** PPP profiles, secrets, and active sessions — `/ppp`. The shared backend for L2TP/PPTP/SSTP/OpenVPN. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE,  READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type {ToolModule} from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

/** Mask password values in printed output (mirrors the users.ts redaction pattern). */
function redact(text: string): string {
  return text.replace(/password="[^"]*"/g, 'password="***"');
}

const UseEncryption = z.enum(["default", "yes", "no", "required"]);
const ChangeTcpMss = z.enum(["default", "yes", "no"]);
const OnlyOne = z.enum(["default", "yes", "no"]);
const Service = z.enum(["any", "l2tp", "pptp", "sstp", "ovpn", "pppoe"]);

export const pppTools: ToolModule = [
  // ── PROFILE `/ppp profile` ────────────────────────────────────────────────
  defineTool({
    name: "create_ppp_profile",
    title: "Create PPP Profile",
    annotations: WRITE,
    description:
      "Creates a PPP profile on the MikroTik device. Profiles define address assignment, DNS, encryption, and rate limits shared by L2TP/PPTP/SSTP/OpenVPN sessions.",
    inputSchema: {
      name: z.string().describe("Name for the new PPP profile"),
      local_address: z.string().optional().describe("Server-side tunnel IP or pool name"),
      remote_address: z.string().optional().describe("Client IP or address pool name"),
      dns_server: z.string().optional(),
      rate_limit: z.string().optional().describe("Rate limit, e.g. '10M/10M'"),
      use_encryption: UseEncryption.optional(),
      change_tcp_mss: ChangeTcpMss.optional(),
      only_one: OnlyOne.optional().describe("Allow only one session per user"),
      bridge: z.string().optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Creating PPP profile: name=${a.name}`);
      const cmd = new Cmd("/ppp profile add")
        .set("name", a.name)
        .opt("local-address", a.local_address)
        .opt("remote-address", a.remote_address)
        .opt("dns-server", a.dns_server)
        .opt("rate-limit", a.rate_limit)
        .opt("use-encryption", a.use_encryption)
        .opt("change-tcp-mss", a.change_tcp_mss)
        .opt("only-one", a.only_one)
        .opt("bridge", a.bridge)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create PPP profile: ${result}`;

      const details = await executeMikrotikCommand(
        `/ppp profile print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `PPP profile created successfully:\n\n${details}`
        : "PPP profile creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ppp_profiles",
    title: "List PPP Profiles",
    annotations: READ,
    description: "Lists PPP profiles on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing PPP profiles");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(`/ppp profile print${whereClause(filters)}`, ctx);
      return isEmpty(result) ? "No PPP profiles found matching the criteria." : `PPP PROFILES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ppp_profile",
    title: "Get PPP Profile",
    annotations: READ,
    description: "Gets detailed information about a specific PPP profile.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting PPP profile details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ppp profile print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result) ? `PPP profile '${a.name}' not found.` : `PPP PROFILE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_ppp_profile",
    title: "Update PPP Profile",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates an existing PPP profile's settings.",
    inputSchema: {
      name: z.string().describe("Current name of the PPP profile to update"),
      new_name: z.string().optional(),
      local_address: z.string().optional(),
      remote_address: z.string().optional(),
      dns_server: z.string().optional(),
      rate_limit: z.string().optional(),
      use_encryption: UseEncryption.optional(),
      change_tcp_mss: ChangeTcpMss.optional(),
      only_one: OnlyOne.optional(),
      bridge: z.string().optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating PPP profile: name=${a.name}`);
      const cmd = new Cmd(`/ppp profile set [find name="${a.name}"]`)
        .opt("name", a.new_name)
        .opt("local-address", a.local_address)
        .opt("remote-address", a.remote_address)
        .opt("dns-server", a.dns_server)
        .opt("rate-limit", a.rate_limit)
        .opt("use-encryption", a.use_encryption)
        .opt("change-tcp-mss", a.change_tcp_mss)
        .opt("only-one", a.only_one)
        .opt("bridge", a.bridge)
        .opt("comment", a.comment)
        .build();

      if (!cmd.includes("=", cmd.indexOf("]"))) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update PPP profile: ${result}`;

      const target = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(
        `/ppp profile print detail where name="${target}"`,
        ctx,
      );
      return `PPP profile updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_ppp_profile",
    title: "Remove PPP Profile",
    annotations: DESTRUCTIVE,
    description: "Removes a PPP profile from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing PPP profile: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/ppp profile print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `PPP profile '${a.name}' not found.`;

      const result = await executeMikrotikCommand(`/ppp profile remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to remove PPP profile: ${result}`;
      return `PPP profile '${a.name}' removed successfully.`;
    },
  }),

  // ── SECRET `/ppp secret` ──────────────────────────────────────────────────
  defineTool({
    name: "create_ppp_secret",
    title: "Create PPP Secret",
    annotations: WRITE,
    description:
      "Creates a PPP secret (VPN user account) on the MikroTik device. Used by L2TP/PPTP/SSTP/OpenVPN/PPPoE servers for client authentication.",
    inputSchema: {
      name: z.string().describe("Username for the secret"),
      password: z.string().describe("Password for the secret"),
      service: Service.default("any").describe("Service this secret applies to"),
      profile: z.string().optional(),
      local_address: z.string().optional(),
      remote_address: z.string().optional(),
      caller_id: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Creating PPP secret: name=${a.name}, service=${a.service}`);
      const cmd = new Cmd("/ppp secret add")
        .set("name", a.name)
        .set("password", a.password)
        .opt("service", a.service)
        .opt("profile", a.profile)
        .opt("local-address", a.local_address)
        .opt("remote-address", a.remote_address)
        .opt("caller-id", a.caller_id)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create PPP secret: ${redact(result)}`;

      const details = await executeMikrotikCommand(
        `/ppp secret print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `PPP secret created successfully:\n\n${redact(details)}`
        : "PPP secret creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ppp_secrets",
    title: "List PPP Secrets",
    annotations: READ,
    description: "Lists PPP secrets (VPN user accounts) on the MikroTik device. Passwords are redacted.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
      service_filter: Service.optional().describe("Exact service match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing PPP secrets");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.service_filter) filters.push(`service="${a.service_filter}"`);

      const result = await executeMikrotikCommand(`/ppp secret print${whereClause(filters)}`, ctx);
      return isEmpty(result) ? "No PPP secrets found matching the criteria." : `PPP SECRETS:\n\n${redact(result)}`;
    },
  }),

  defineTool({
    name: "get_ppp_secret",
    title: "Get PPP Secret",
    annotations: READ,
    description: "Gets detailed information about a specific PPP secret. The password is redacted.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting PPP secret details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ppp secret print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result) ? `PPP secret '${a.name}' not found.` : `PPP SECRET DETAILS:\n\n${redact(result)}`;
    },
  }),

  defineTool({
    name: "update_ppp_secret",
    title: "Update PPP Secret",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates an existing PPP secret's settings. The password is redacted in output.",
    inputSchema: {
      name: z.string().describe("Current username of the secret to update"),
      new_name: z.string().optional(),
      password: z.string().optional(),
      service: Service.optional(),
      profile: z.string().optional(),
      local_address: z.string().optional(),
      remote_address: z.string().optional(),
      caller_id: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating PPP secret: name=${a.name}`);
      const cmd = new Cmd(`/ppp secret set [find name="${a.name}"]`)
        .opt("name", a.new_name)
        .opt("password", a.password)
        .opt("service", a.service)
        .opt("profile", a.profile)
        .opt("local-address", a.local_address)
        .opt("remote-address", a.remote_address)
        .opt("caller-id", a.caller_id)
        .opt("comment", a.comment)
        .bool("disabled", a.disabled)
        .build();

      if (!cmd.includes("=", cmd.indexOf("]"))) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update PPP secret: ${redact(result)}`;

      const target = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(
        `/ppp secret print detail where name="${target}"`,
        ctx,
      );
      return `PPP secret updated successfully:\n\n${redact(details)}`;
    },
  }),

  defineTool({
    name: "remove_ppp_secret",
    title: "Remove PPP Secret",
    annotations: DESTRUCTIVE,
    description: "Removes a PPP secret (VPN user account) from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing PPP secret: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/ppp secret print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `PPP secret '${a.name}' not found.`;

      const result = await executeMikrotikCommand(`/ppp secret remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to remove PPP secret: ${result}`;
      return `PPP secret '${a.name}' removed successfully.`;
    },
  }),

  // ── ACTIVE `/ppp active` ──────────────────────────────────────────────────
  defineTool({
    name: "get_ppp_active",
    title: "Active PPP Sessions",
    annotations: READ,
    description: "Lists currently active PPP sessions (connected VPN clients).",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial username match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing active PPP sessions");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(`/ppp active print${whereClause(filters)}`, ctx);
      return isEmpty(result) ? "No active PPP sessions found." : `ACTIVE PPP SESSIONS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "disconnect_ppp_active",
    title: "Disconnect PPP Session",
    annotations: DESTRUCTIVE,
    description: "Disconnects an active PPP session by username.",
    inputSchema: { name: z.string().describe("Username of the active session to disconnect") },
    async handler(a, ctx) {
      ctx.info(`Disconnecting PPP session: name=${a.name}`);
      const result = await executeMikrotikCommand(`/ppp active remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to disconnect PPP session: ${result}`;
      return `PPP session '${a.name}' disconnected.`;
    },
  }),
];
