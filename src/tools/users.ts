/** Users, user groups, active sessions, and SSH keys — `/user`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE,  READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type {ToolModule} from "../core/registry";
import { whereClause, quoteValue, looksLikeError, isEmpty, Cmd } from "../core/routeros";

/** Mask password values in printed output (mirrors the Python `re.sub`). */
function redactPassword(text: string): string {
  return text.replace(/password="[^"]*"/g, 'password="***"');
}

const VALID_POLICIES = [
  "local", "telnet", "ssh", "ftp", "reboot", "read", "write",
  "policy", "test", "winbox", "password", "web", "sniff",
  "sensitive", "api", "romon", "dude", "tikapp", "rest-api",
];

const BUILTIN_GROUPS = ["read", "write", "full"];

interface UpdateUserArgs {
  name: string;
  new_name?: string;
  password?: string;
  group?: string;
  address?: string;
  comment?: string;
  disabled?: boolean;
}

/** Shared by update_user / enable_user / disable_user. */
async function runUpdateUser(a: UpdateUserArgs, ctx: Parameters<typeof executeMikrotikCommand>[1]): Promise<string> {
  ctx.info(`Updating user: name=${a.name}`);

  const updates: string[] = [];
  if (a.new_name) updates.push(`name=${quoteValue(a.new_name)}`);
  if (a.password) updates.push(`password=${quoteValue(a.password)}`);
  if (a.group) updates.push(`group=${a.group}`);
  if (a.address !== undefined) updates.push(a.address === "" ? "!address" : `address=${a.address}`);
  if (a.comment !== undefined) updates.push(`comment=${quoteValue(a.comment)}`);
  if (a.disabled !== undefined) updates.push(`disabled=${a.disabled ? "yes" : "no"}`);

  if (updates.length === 0) return "No updates specified.";

  const cmd = `/user set [find name="${a.name}"] ${updates.join(" ")}`;
  const result = await executeMikrotikCommand(cmd, ctx);
  if (looksLikeError(result)) return `Failed to update user: ${result}`;

  const detailsName = a.new_name ?? a.name;
  const details = await executeMikrotikCommand(`/user print detail where name="${detailsName}"`, ctx);
  return `User updated successfully:\n\n${redactPassword(details)}`;
}

export const userTools: ToolModule = [
  defineTool({
    name: "add_user",
    title: "Add User",
    annotations: WRITE,
    description: "Adds a user to MikroTik device.",
    inputSchema: {
      name: z.string(),
      password: z.string(),
      group: z.string().default("read"),
      address: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding user: name=${a.name}, group=${a.group}`);
      const cmd = new Cmd("/user add")
        .set("name", a.name)
        .set("password", a.password)
        .set("group", a.group)
        .opt("address", a.address)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);

      if (result.trim()) {
        if (result.includes("*") || /^\d+$/.test(result.trim())) {
          const userId = result.trim();
          const details = await executeMikrotikCommand(`/user print detail where .id=${userId}`, ctx);
          if (details.trim()) return `User created successfully:\n\n${redactPassword(details)}`;
          return `User created with ID: ${result}`;
        }
        return `Failed to create user: ${result}`;
      }

      const details = await executeMikrotikCommand(`/user print detail where name="${a.name}"`, ctx);
      if (details.trim()) return `User created successfully:\n\n${redactPassword(details)}`;
      return "User creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_users",
    title: "List Users",
    annotations: READ,
    description: "Lists users on MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      group_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      active_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Listing users with filters: name=${a.name_filter}, group=${a.group_filter}`);
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.group_filter) filters.push(`group="${a.group_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");

      const result = await executeMikrotikCommand(`/user print${whereClause(filters)}`, ctx);
      if (isEmpty(result)) return "No users found matching the criteria.";
      return `USERS:\n\n${redactPassword(result)}`;
    },
  }),

  defineTool({
    name: "get_user",
    title: "Get User",
    annotations: READ,
    description: "Gets detailed information about a specific user.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting user details: name=${a.name}`);
      const result = await executeMikrotikCommand(`/user print detail where name="${a.name}"`, ctx);
      if (isEmpty(result)) return `User '${a.name}' not found.`;
      return `USER DETAILS:\n\n${redactPassword(result)}`;
    },
  }),

  defineTool({
    name: "update_user",
    title: "Update User",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates a user.",
    inputSchema: {
      name: z.string(),
      new_name: z.string().optional(),
      password: z.string().optional(),
      group: z.string().optional(),
      address: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      return runUpdateUser(a, ctx);
    },
  }),

  defineTool({
    name: "remove_user",
    title: "Remove User",
    annotations: DESTRUCTIVE,
    description: "Removes a user.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing user: name=${a.name}`);

      // Don't allow removal of admin user
      if (a.name.toLowerCase() === "admin") return "Cannot remove the admin user.";

      const count = await executeMikrotikCommand(`/user print count-only where name="${a.name}"`, ctx);
      if (count.trim() === "0") return `User '${a.name}' not found.`;

      const result = await executeMikrotikCommand(`/user remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to remove user: ${result}`;
      return `User '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "disable_user",
    title: "Disable User",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a user.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      return runUpdateUser({ name: a.name, disabled: true }, ctx);
    },
  }),

  defineTool({
    name: "enable_user",
    title: "Enable User",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a user.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      return runUpdateUser({ name: a.name, disabled: false }, ctx);
    },
  }),

  defineTool({
    name: "add_user_group",
    title: "Add User Group",
    annotations: WRITE,
    description: "Adds a user group.",
    inputSchema: {
      name: z.string(),
      policy: z.array(z.string()),
      skin: z.string().optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Adding user group: name=${a.name}`);

      // Validate policies
      for (const p of a.policy) {
        if (!VALID_POLICIES.includes(p)) {
          return `Invalid policy: ${p}. Valid policies: ${VALID_POLICIES.join(", ")}`;
        }
      }

      const cmd = new Cmd("/user group add")
        .set("name", a.name)
        .set("policy", a.policy.join(","))
        .opt("skin", a.skin)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);

      if (result.trim()) {
        if (result.includes("*") || /^\d+$/.test(result.trim())) {
          const groupId = result.trim();
          const details = await executeMikrotikCommand(`/user group print detail where .id=${groupId}`, ctx);
          if (details.trim()) return `User group created successfully:\n\n${details}`;
          return `User group created with ID: ${result}`;
        }
        return `Failed to create user group: ${result}`;
      }

      const details = await executeMikrotikCommand(`/user group print detail where name="${a.name}"`, ctx);
      if (details.trim()) return `User group created successfully:\n\n${details}`;
      return "User group creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_user_groups",
    title: "List User Groups",
    annotations: READ,
    description: "Lists user groups on MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      policy_filter: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Listing user groups with filters: name=${a.name_filter}`);
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.policy_filter) filters.push(`policy~"${a.policy_filter}"`);

      const result = await executeMikrotikCommand(`/user group print${whereClause(filters)}`, ctx);
      if (isEmpty(result)) return "No user groups found matching the criteria.";
      return `USER GROUPS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_user_group",
    title: "Get User Group",
    annotations: READ,
    description: "Gets detailed information about a specific user group.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting user group details: name=${a.name}`);
      const result = await executeMikrotikCommand(`/user group print detail where name="${a.name}"`, ctx);
      if (isEmpty(result)) return `User group '${a.name}' not found.`;
      return `USER GROUP DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_user_group",
    title: "Update User Group",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates a user group.",
    inputSchema: {
      name: z.string(),
      new_name: z.string().optional(),
      policy: z.array(z.string()).optional(),
      skin: z.string().optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating user group: name=${a.name}`);

      // Don't allow modification of built-in groups
      if (BUILTIN_GROUPS.includes(a.name)) return `Cannot modify built-in group '${a.name}'.`;

      const updates: string[] = [];
      if (a.new_name) updates.push(`name=${quoteValue(a.new_name)}`);
      if (a.policy && a.policy.length) updates.push(`policy=${a.policy.join(",")}`);
      if (a.skin !== undefined) updates.push(a.skin === "" ? "!skin" : `skin=${quoteValue(a.skin)}`);
      if (a.comment !== undefined) updates.push(`comment=${quoteValue(a.comment)}`);

      if (updates.length === 0) return "No updates specified.";

      const cmd = `/user group set [find name="${a.name}"] ${updates.join(" ")}`;
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update user group: ${result}`;

      const detailsName = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(`/user group print detail where name="${detailsName}"`, ctx);
      return `User group updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_user_group",
    title: "Remove User Group",
    annotations: DESTRUCTIVE,
    description: "Removes a user group.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing user group: name=${a.name}`);

      // Don't allow removal of built-in groups
      if (BUILTIN_GROUPS.includes(a.name)) return `Cannot remove built-in group '${a.name}'.`;

      const count = await executeMikrotikCommand(`/user group print count-only where name="${a.name}"`, ctx);
      if (count.trim() === "0") return `User group '${a.name}' not found.`;

      // Check if group is in use
      const usersCount = await executeMikrotikCommand(`/user print count-only where group="${a.name}"`, ctx);
      if (usersCount.trim() !== "0") {
        return `Cannot remove group '${a.name}': ${usersCount.trim()} users are using this group.`;
      }

      const result = await executeMikrotikCommand(`/user group remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to remove user group: ${result}`;
      return `User group '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "get_active_users",
    title: "Active Users",
    annotations: READ,
    description: "Gets currently active/logged-in users.",
    async handler(_a, ctx) {
      ctx.info("Getting active users");
      const result = await executeMikrotikCommand("/user active print", ctx);
      if (isEmpty(result)) return "No active users found.";
      return `ACTIVE USERS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "disconnect_user",
    title: "Disconnect User",
    annotations: DESTRUCTIVE,
    description: "Disconnects an active user session.",
    inputSchema: { user_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Disconnecting user: user_id=${a.user_id}`);
      const result = await executeMikrotikCommand(`/user active remove ${a.user_id}`, ctx);
      if (looksLikeError(result)) return `Failed to disconnect user: ${result}`;
      return `User session ${a.user_id} disconnected successfully.`;
    },
  }),

  defineTool({
    name: "export_user_config",
    title: "Export User Config",
    annotations: READ,
    description: "Exports user configuration to a file.",
    inputSchema: { filename: z.string().optional() },
    async handler(a, ctx) {
      ctx.info("Exporting user configuration");
      const filename = a.filename || "user_config";
      const result = await executeMikrotikCommand(`/user export file=${filename}`, ctx);
      if (!result.trim()) return `User configuration exported to ${filename}.rsc`;
      return `Export result: ${result}`;
    },
  }),

  defineTool({
    name: "set_user_ssh_keys",
    title: "Set User SSH Keys",
    annotations: WRITE,
    description: "Sets SSH keys for a specific user.",
    inputSchema: {
      username: z.string(),
      key_file: z.string(),
    },
    async handler(a, ctx) {
      ctx.info(`Setting SSH keys for user: ${a.username}`);
      const cmd = `/user ssh-keys import user="${a.username}" public-key-file="${a.key_file}"`;
      const result = await executeMikrotikCommand(cmd, ctx);
      if (!result.trim() || result.toLowerCase().includes("imported")) {
        return `SSH key imported successfully for user '${a.username}'.`;
      }
      return `Failed to import SSH key: ${result}`;
    },
  }),

  defineTool({
    name: "list_user_ssh_keys",
    title: "List User SSH Keys",
    annotations: READ,
    description: "Lists SSH keys for a specific user.",
    inputSchema: { username: z.string() },
    async handler(a, ctx) {
      ctx.info(`Listing SSH keys for user: ${a.username}`);
      const result = await executeMikrotikCommand(`/user ssh-keys print where user="${a.username}"`, ctx);
      if (isEmpty(result)) return `No SSH keys found for user '${a.username}'.`;
      return `SSH KEYS for ${a.username}:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_user_ssh_key",
    title: "Remove User SSH Key",
    annotations: DESTRUCTIVE,
    description: "Removes an SSH key.",
    inputSchema: { key_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing SSH key: key_id=${a.key_id}`);
      const result = await executeMikrotikCommand(`/user ssh-keys remove ${a.key_id}`, ctx);
      if (looksLikeError(result)) return `Failed to remove SSH key: ${result}`;
      return `SSH key ${a.key_id} removed successfully.`;
    },
  }),
];
