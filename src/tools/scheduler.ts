/** Scheduler & scripts — `/system scheduler` and `/system script`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const schedulerTools: ToolModule = [
  defineTool({
    name: "create_scheduler",
    title: "Create Scheduler",
    annotations: WRITE,
    description:
      "Creates a scheduled task on the MikroTik device that runs an on-event script at an interval or start time.",
    inputSchema: {
      name: z.string().describe("Name for the scheduler entry"),
      on_event: z
        .string()
        .describe("Script source to run on event (may contain spaces/semicolons)"),
      interval: z.string().optional().describe("Run interval, e.g. '00:05:00' (0 = run once)"),
      start_time: z.string().optional().describe("Start time, e.g. '12:00:00' or 'startup'"),
      start_date: z.string().optional().describe("Start date, e.g. 'jan/01/2026'"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Creating scheduler: name=${a.name}`);
      const cmd = new Cmd("/system scheduler add")
        .set("name", a.name)
        .set("on-event", a.on_event)
        .opt("interval", a.interval)
        .opt("start-time", a.start_time)
        .opt("start-date", a.start_date)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create scheduler: ${result}`;

      const details = await executeMikrotikCommand(
        `/system scheduler print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `Scheduler created successfully:\n\n${details}`
        : "Scheduler creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_schedulers",
    title: "List Schedulers",
    annotations: READ,
    description: "Lists scheduled tasks on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing schedulers");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/system scheduler print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No schedulers found matching the criteria."
        : `SCHEDULERS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_scheduler",
    title: "Get Scheduler",
    annotations: READ,
    description: "Gets detailed information about a specific scheduler entry.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting scheduler details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/system scheduler print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `Scheduler '${a.name}' not found.`
        : `SCHEDULER DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_scheduler",
    title: "Remove Scheduler",
    annotations: DESTRUCTIVE,
    description: "Removes a scheduled task from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing scheduler: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/system scheduler print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `Scheduler '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/system scheduler remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove scheduler: ${result}`;
      return `Scheduler '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_scheduler",
    title: "Enable Scheduler",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a scheduled task on the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Enabling scheduler: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/system scheduler enable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to enable scheduler: ${result}`;
      return `Scheduler '${a.name}' enabled successfully.`;
    },
  }),

  defineTool({
    name: "disable_scheduler",
    title: "Disable Scheduler",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a scheduled task on the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Disabling scheduler: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/system scheduler disable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to disable scheduler: ${result}`;
      return `Scheduler '${a.name}' disabled successfully.`;
    },
  }),

  defineTool({
    name: "add_script",
    title: "Add Script",
    annotations: WRITE,
    description: "Adds a named script to the MikroTik device's script repository.",
    inputSchema: {
      name: z.string().describe("Name for the script"),
      source: z.string().describe("Script source code (may contain spaces/semicolons)"),
      comment: z.string().optional(),
      dont_require_permissions: z
        .boolean()
        .default(false)
        .describe("Run without checking the policy permissions of the caller"),
    },
    async handler(a, ctx) {
      ctx.info(`Adding script: name=${a.name}`);
      const cmd = new Cmd("/system script add")
        .set("name", a.name)
        .set("source", a.source)
        .opt("comment", a.comment)
        .flag("dont-require-permissions", a.dont_require_permissions)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add script: ${result}`;

      const details = await executeMikrotikCommand(
        `/system script print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `Script added successfully:\n\n${details}`
        : "Script creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_scripts",
    title: "List Scripts",
    annotations: READ,
    description: "Lists scripts in the MikroTik device's script repository.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing scripts");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/system script print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result) ? "No scripts found matching the criteria." : `SCRIPTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_script",
    title: "Remove Script",
    annotations: DESTRUCTIVE,
    description: "Removes a script from the MikroTik device's script repository.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing script: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/system script print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `Script '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/system script remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove script: ${result}`;
      return `Script '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "run_script",
    title: "Run Script",
    annotations: WRITE,
    description: "Runs a named script from the MikroTik device's script repository.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Running script: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/system script run [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to run script: ${result}`;
      return `Script '${a.name}' executed.\n\n${result}`;
    },
  }),
];
