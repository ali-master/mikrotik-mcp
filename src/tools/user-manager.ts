/**
 * RouterOS v7 User Manager — `/user-manager`.
 *
 * The built-in RADIUS server (settings, users, profiles, user-profile
 * assignments, RADIUS clients/routers, limitations and sessions). The
 * `user-manager` package may not be installed; read tools detect that via
 * `commandUnsupported` and return a friendly message instead of a raw error.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, commandUnsupported, Cmd } from "../core/routeros";

/** Mask password / shared-secret values in printed output. */
function redact(text: string): string {
  return text
    .replace(/password="[^"]*"/g, 'password="***"')
    .replace(/shared-secret="[^"]*"/g, 'shared-secret="***"');
}

const NOT_AVAILABLE = "User Manager is not available on this device (package not installed).";

export const userManagerTools: ToolModule = [
  // ── SETTINGS `/user-manager` ──────────────────────────────────────────────
  defineTool({
    name: "get_user_manager_settings",
    title: "Get User Manager Settings",
    annotations: READ,
    description: "Gets the User Manager settings (enabled, certificate, use-profiles).",
    async handler(_a, ctx) {
      ctx.info("Getting User Manager settings");
      const result = await executeMikrotikCommand("/user-manager print", ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      return isEmpty(result) ? "No User Manager settings found." : `USER MANAGER SETTINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "set_user_manager_settings",
    title: "Set User Manager Settings",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates the User Manager settings.",
    inputSchema: {
      enabled: z.boolean().optional().describe("Enable or disable the User Manager server"),
      certificate: z.string().optional().describe("TLS certificate name for RADIUS over TLS"),
      use_profiles: z.boolean().optional().describe("Enable the profile/payment subsystem"),
    },
    async handler(a, ctx) {
      ctx.info("Updating User Manager settings");
      const cmd = new Cmd("/user-manager set")
        .bool("enabled", a.enabled)
        .opt("certificate", a.certificate)
        .bool("use-profiles", a.use_profiles)
        .build();
      if (cmd === "/user-manager set") return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      if (looksLikeError(result)) return `Failed to update User Manager settings: ${result}`;

      const details = await executeMikrotikCommand("/user-manager print", ctx);
      return `User Manager settings updated successfully:\n\n${details}`;
    },
  }),

  // ── USERS `/user-manager user` ────────────────────────────────────────────
  defineTool({
    name: "add_user_manager_user",
    title: "Add User Manager User",
    annotations: WRITE,
    description: "Adds a user to the User Manager RADIUS database.",
    inputSchema: {
      name: z.string().describe("Login name for the user"),
      password: z.string().describe("Login password for the user"),
      group: z.string().optional(),
      shared_users: z.number().int().optional().describe("Max simultaneous sessions"),
      attributes: z.string().optional().describe("Custom RADIUS attributes"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding User Manager user: name=${a.name}`);
      const cmd = new Cmd("/user-manager user add")
        .set("name", a.name)
        .set("password", a.password)
        .opt("group", a.group)
        .opt("shared-users", a.shared_users)
        .opt("attributes", a.attributes)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      if (looksLikeError(result)) return `Failed to add User Manager user: ${result}`;

      const details = await executeMikrotikCommand(
        `/user-manager user print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `User Manager user created successfully:\n\n${redact(details)}`
        : "User Manager user creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_user_manager_users",
    title: "List User Manager Users",
    annotations: READ,
    description: "Lists users in the User Manager RADIUS database.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing User Manager users");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(`/user-manager user print${whereClause(filters)}`, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      return isEmpty(result) ? "No User Manager users found matching the criteria." : `USER MANAGER USERS:\n\n${redact(result)}`;
    },
  }),

  defineTool({
    name: "get_user_manager_user",
    title: "Get User Manager User",
    annotations: READ,
    description: "Gets detailed information about a specific User Manager user.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting User Manager user details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/user-manager user print detail where name="${a.name}"`,
        ctx,
      );
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      return isEmpty(result) ? `User Manager user '${a.name}' not found.` : `USER MANAGER USER DETAILS:\n\n${redact(result)}`;
    },
  }),

  defineTool({
    name: "update_user_manager_user",
    title: "Update User Manager User",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates an existing User Manager user.",
    inputSchema: {
      name: z.string().describe("Current name of the user to update"),
      new_name: z.string().optional(),
      password: z.string().optional(),
      group: z.string().optional(),
      shared_users: z.number().int().optional(),
      attributes: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating User Manager user: name=${a.name}`);
      const cmd = new Cmd(`/user-manager user set [find name="${a.name}"]`)
        .opt("name", a.new_name)
        .opt("password", a.password)
        .opt("group", a.group)
        .opt("shared-users", a.shared_users)
        .opt("attributes", a.attributes)
        .opt("comment", a.comment)
        .bool("disabled", a.disabled)
        .build();
      if (!cmd.includes("=", cmd.indexOf("]"))) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      if (looksLikeError(result)) return `Failed to update User Manager user: ${result}`;

      const target = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(
        `/user-manager user print detail where name="${target}"`,
        ctx,
      );
      return `User Manager user updated successfully:\n\n${redact(details)}`;
    },
  }),

  defineTool({
    name: "remove_user_manager_user",
    title: "Remove User Manager User",
    annotations: DESTRUCTIVE,
    description: "Removes a user from the User Manager RADIUS database.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing User Manager user: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/user-manager user print count-only where name="${a.name}"`,
        ctx,
      );
      if (commandUnsupported(count)) return NOT_AVAILABLE;
      if (count.trim() === "0") return `User Manager user '${a.name}' not found.`;

      const result = await executeMikrotikCommand(`/user-manager user remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to remove User Manager user: ${result}`;
      return `User Manager user '${a.name}' removed successfully.`;
    },
  }),

  // ── PROFILES `/user-manager profile` ──────────────────────────────────────
  defineTool({
    name: "add_user_manager_profile",
    title: "Add User Manager Profile",
    annotations: WRITE,
    description: "Adds a User Manager profile (a billing/service plan).",
    inputSchema: {
      name: z.string().describe("Profile name"),
      name_for_users: z.string().optional().describe("Display name shown to users"),
      validity: z.string().optional().describe("Validity period, e.g. '30d'"),
      price: z.number().optional(),
      starts_when: z.enum(["assigned", "first-auth"]).optional(),
      override_shared_users: z.string().optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Adding User Manager profile: name=${a.name}`);
      const cmd = new Cmd("/user-manager profile add")
        .set("name", a.name)
        .opt("name-for-users", a.name_for_users)
        .opt("validity", a.validity)
        .opt("price", a.price)
        .opt("starts-when", a.starts_when)
        .opt("override-shared-users", a.override_shared_users)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      if (looksLikeError(result)) return `Failed to add User Manager profile: ${result}`;

      const details = await executeMikrotikCommand(
        `/user-manager profile print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `User Manager profile created successfully:\n\n${details}`
        : "User Manager profile creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_user_manager_profiles",
    title: "List User Manager Profiles",
    annotations: READ,
    description: "Lists User Manager profiles.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing User Manager profiles");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(`/user-manager profile print${whereClause(filters)}`, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      return isEmpty(result) ? "No User Manager profiles found matching the criteria." : `USER MANAGER PROFILES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_user_manager_profile",
    title: "Remove User Manager Profile",
    annotations: DESTRUCTIVE,
    description: "Removes a User Manager profile.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing User Manager profile: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/user-manager profile print count-only where name="${a.name}"`,
        ctx,
      );
      if (commandUnsupported(count)) return NOT_AVAILABLE;
      if (count.trim() === "0") return `User Manager profile '${a.name}' not found.`;

      const result = await executeMikrotikCommand(`/user-manager profile remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to remove User Manager profile: ${result}`;
      return `User Manager profile '${a.name}' removed successfully.`;
    },
  }),

  // ── USER-PROFILE ASSIGNMENT `/user-manager user-profile` ──────────────────
  defineTool({
    name: "assign_user_manager_profile",
    title: "Assign User Manager Profile",
    annotations: WRITE,
    description: "Assigns a profile to a User Manager user.",
    inputSchema: {
      user: z.string().describe("User to assign the profile to"),
      profile: z.string().describe("Profile to assign"),
    },
    async handler(a, ctx) {
      ctx.info(`Assigning profile '${a.profile}' to user '${a.user}'`);
      const cmd = new Cmd("/user-manager user-profile add")
        .set("user", a.user)
        .set("profile", a.profile)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      if (looksLikeError(result)) return `Failed to assign profile: ${result}`;
      return `Assigned profile '${a.profile}' to user '${a.user}'.\n\n${result}`;
    },
  }),

  defineTool({
    name: "list_user_manager_user_profiles",
    title: "List User Manager User-Profiles",
    annotations: READ,
    description: "Lists User Manager user-profile assignments.",
    inputSchema: {
      user_filter: z.string().optional().describe("Partial user match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing User Manager user-profiles");
      const filters: string[] = [];
      if (a.user_filter) filters.push(`user~"${a.user_filter}"`);

      const result = await executeMikrotikCommand(`/user-manager user-profile print${whereClause(filters)}`, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      return isEmpty(result) ? "No User Manager user-profiles found matching the criteria." : `USER MANAGER USER-PROFILES:\n\n${result}`;
    },
  }),

  // ── ROUTERS (RADIUS clients / NAS) `/user-manager router` ─────────────────
  defineTool({
    name: "add_user_manager_router",
    title: "Add User Manager Router",
    annotations: WRITE,
    description: "Adds a RADIUS client (router/NAS) that authenticates against User Manager.",
    inputSchema: {
      name: z.string().describe("Friendly name for the RADIUS client"),
      address: z.string().describe("IP address of the RADIUS client"),
      shared_secret: z.string().describe("Shared secret for the RADIUS client"),
      coa_port: z.number().int().optional().describe("Change-of-Authorization port"),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding User Manager router: name=${a.name}, address=${a.address}`);
      const cmd = new Cmd("/user-manager router add")
        .set("name", a.name)
        .set("address", a.address)
        .set("shared-secret", a.shared_secret)
        .opt("coa-port", a.coa_port)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      if (looksLikeError(result)) return `Failed to add User Manager router: ${result}`;

      const details = await executeMikrotikCommand(
        `/user-manager router print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `User Manager router created successfully:\n\n${redact(details)}`
        : "User Manager router creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_user_manager_routers",
    title: "List User Manager Routers",
    annotations: READ,
    description: "Lists RADIUS clients (routers/NAS) configured in User Manager.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing User Manager routers");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(`/user-manager router print${whereClause(filters)}`, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      return isEmpty(result) ? "No User Manager routers found matching the criteria." : `USER MANAGER ROUTERS:\n\n${redact(result)}`;
    },
  }),

  defineTool({
    name: "remove_user_manager_router",
    title: "Remove User Manager Router",
    annotations: DESTRUCTIVE,
    description: "Removes a RADIUS client (router/NAS) from User Manager.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing User Manager router: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/user-manager router print count-only where name="${a.name}"`,
        ctx,
      );
      if (commandUnsupported(count)) return NOT_AVAILABLE;
      if (count.trim() === "0") return `User Manager router '${a.name}' not found.`;

      const result = await executeMikrotikCommand(`/user-manager router remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to remove User Manager router: ${result}`;
      return `User Manager router '${a.name}' removed successfully.`;
    },
  }),

  // ── LIMITATIONS `/user-manager limitation` ────────────────────────────────
  defineTool({
    name: "add_user_manager_limitation",
    title: "Add User Manager Limitation",
    annotations: WRITE,
    description: "Adds a User Manager limitation (rate/transfer/uptime limits).",
    inputSchema: {
      name: z.string().describe("Limitation name"),
      rate_limit_rx: z.string().optional().describe("Download rate limit, e.g. '10M'"),
      rate_limit_tx: z.string().optional().describe("Upload rate limit, e.g. '10M'"),
      transfer_limit: z.string().optional().describe("Total transfer cap, e.g. '10G'"),
      uptime_limit: z.string().optional().describe("Uptime cap, e.g. '1d'"),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Adding User Manager limitation: name=${a.name}`);
      const cmd = new Cmd("/user-manager limitation add")
        .set("name", a.name)
        .opt("rate-limit-rx", a.rate_limit_rx)
        .opt("rate-limit-tx", a.rate_limit_tx)
        .opt("transfer-limit", a.transfer_limit)
        .opt("uptime-limit", a.uptime_limit)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      if (looksLikeError(result)) return `Failed to add User Manager limitation: ${result}`;

      const details = await executeMikrotikCommand(
        `/user-manager limitation print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `User Manager limitation created successfully:\n\n${details}`
        : "User Manager limitation creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_user_manager_limitations",
    title: "List User Manager Limitations",
    annotations: READ,
    description: "Lists User Manager limitations.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing User Manager limitations");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(`/user-manager limitation print${whereClause(filters)}`, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      return isEmpty(result) ? "No User Manager limitations found matching the criteria." : `USER MANAGER LIMITATIONS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_user_manager_limitation",
    title: "Remove User Manager Limitation",
    annotations: DESTRUCTIVE,
    description: "Removes a User Manager limitation.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing User Manager limitation: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/user-manager limitation print count-only where name="${a.name}"`,
        ctx,
      );
      if (commandUnsupported(count)) return NOT_AVAILABLE;
      if (count.trim() === "0") return `User Manager limitation '${a.name}' not found.`;

      const result = await executeMikrotikCommand(`/user-manager limitation remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to remove User Manager limitation: ${result}`;
      return `User Manager limitation '${a.name}' removed successfully.`;
    },
  }),

  // ── SESSIONS `/user-manager session` ──────────────────────────────────────
  defineTool({
    name: "list_user_manager_sessions",
    title: "List User Manager Sessions",
    annotations: READ,
    description: "Lists User Manager accounting sessions.",
    inputSchema: {
      user_filter: z.string().optional().describe("Partial user match"),
      active_only: z.boolean().default(false).describe("Only show currently active sessions"),
    },
    async handler(a, ctx) {
      ctx.info("Listing User Manager sessions");
      const filters: string[] = [];
      if (a.user_filter) filters.push(`user~"${a.user_filter}"`);
      if (a.active_only) filters.push("active=yes");

      const result = await executeMikrotikCommand(`/user-manager session print${whereClause(filters)}`, ctx);
      if (commandUnsupported(result)) return NOT_AVAILABLE;
      return isEmpty(result) ? "No User Manager sessions found matching the criteria." : `USER MANAGER SESSIONS:\n\n${result}`;
    },
  }),
];
