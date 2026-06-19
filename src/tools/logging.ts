/** System logging rules and actions — `/system logging`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const systemLoggingTools: ToolModule = [
  defineTool({
    name: "add_logging_rule",
    title: "Add Logging Rule",
    annotations: WRITE,
    description:
      "Adds a system logging rule that routes log messages matching the given topics to a logging action.",
    inputSchema: {
      topics: z
        .string()
        .describe('Comma-separated log topics, e.g. "info", "firewall,!debug"'),
      action: z
        .string()
        .optional()
        .describe("Logging action name (default 'memory')"),
      prefix: z
        .string()
        .optional()
        .describe("Text prepended to each matching log message"),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Adding logging rule: topics=${a.topics}, action=${a.action ?? "memory"}`,
      );
      const cmd = new Cmd("/system logging add")
        .set("topics", a.topics)
        .opt("action", a.action)
        .opt("prefix", a.prefix)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to add logging rule: ${result}`;

      const details = await executeMikrotikCommand(
        `/system logging print detail where topics="${a.topics}"`,
        ctx,
      );
      return details.trim()
        ? `Logging rule added successfully:\n\n${details}`
        : "Logging rule add completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_logging_rules",
    title: "List Logging Rules",
    annotations: READ,
    description: "Lists system logging rules on the MikroTik device.",
    inputSchema: {
      topics_filter: z.string().optional().describe("Partial topics match"),
      action_filter: z.string().optional().describe("Exact action name"),
    },
    async handler(a, ctx) {
      ctx.info("Listing logging rules");
      const filters: string[] = [];
      if (a.topics_filter) filters.push(`topics~"${a.topics_filter}"`);
      if (a.action_filter) filters.push(`action="${a.action_filter}"`);

      const result = await executeMikrotikCommand(
        `/system logging print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No logging rules found matching the criteria."
        : `LOGGING RULES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_logging_rule",
    title: "Remove Logging Rule",
    annotations: DESTRUCTIVE,
    description: "Removes a system logging rule by its internal id.",
    inputSchema: {
      rule_id: z
        .string()
        .describe("Internal .id of the logging rule, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing logging rule: rule_id=${a.rule_id}`);
      const count = await executeMikrotikCommand(
        `/system logging print count-only where .id="${a.rule_id}"`,
        ctx,
      );
      if (count.trim() === "0") return `Logging rule '${a.rule_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/system logging remove [find .id="${a.rule_id}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove logging rule: ${result}`;
      return `Logging rule '${a.rule_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "add_logging_action",
    title: "Add Logging Action",
    annotations: WRITE,
    description:
      "Adds a system logging action defining where matching log messages are sent (memory, disk, echo, remote syslog or email).",
    inputSchema: {
      name: z.string().describe("Name for the new logging action"),
      target: z
        .enum(["memory", "disk", "echo", "remote", "email"])
        .describe("Where log messages are written"),
      remote: z
        .string()
        .optional()
        .describe("Remote syslog server address (target=remote)"),
      remote_port: z
        .number()
        .int()
        .optional()
        .describe("Remote syslog UDP port"),
      bsd_syslog: z
        .boolean()
        .optional()
        .describe("Use BSD-style syslog format"),
      syslog_facility: z.string().optional(),
      syslog_severity: z.string().optional(),
      disk_file_name: z
        .string()
        .optional()
        .describe("File name for target=disk"),
      disk_lines_per_file: z.number().int().optional(),
      memory_lines: z
        .number()
        .int()
        .optional()
        .describe("Lines kept for target=memory"),
      email_to: z
        .string()
        .optional()
        .describe("Recipient address for target=email"),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding logging action: name=${a.name}, target=${a.target}`);
      const cmd = new Cmd("/system logging action add")
        .set("name", a.name)
        .set("target", a.target)
        .opt("remote", a.remote)
        .opt("remote-port", a.remote_port)
        .bool("bsd-syslog", a.bsd_syslog)
        .opt("syslog-facility", a.syslog_facility)
        .opt("syslog-severity", a.syslog_severity)
        .opt("disk-file-name", a.disk_file_name)
        .opt("disk-lines-per-file", a.disk_lines_per_file)
        .opt("memory-lines", a.memory_lines)
        .opt("email-to", a.email_to)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to add logging action: ${result}`;

      const details = await executeMikrotikCommand(
        `/system logging action print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `Logging action added successfully:\n\n${details}`
        : "Logging action add completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_logging_actions",
    title: "List Logging Actions",
    annotations: READ,
    description: "Lists system logging actions on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing logging actions");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/system logging action print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No logging actions found matching the criteria."
        : `LOGGING ACTIONS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_logging_action",
    title: "Remove Logging Action",
    annotations: DESTRUCTIVE,
    description: "Removes a system logging action by name.",
    inputSchema: {
      name: z.string().describe("Name of the logging action to remove"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing logging action: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/system logging action print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `Logging action '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/system logging action remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove logging action: ${result}`;
      return `Logging action '${a.name}' removed successfully.`;
    },
  }),
];
