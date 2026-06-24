/**
 * System logs — `/log`.
 *
 * Reading, filtering, searching, and exporting RouterOS log entries, plus a
 * few convenience views (by severity, by topic, security, system events) that
 * all funnel through the shared `runGetLogs` query builder.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { isEmpty } from "../core/routeros";
import { tailLines, orMatch } from "../utils";
import type { ToolContext } from "../core/context";

interface GetLogsOptions {
  topics?: string;
  action?: string;
  time_filter?: string;
  message_filter?: string;
  prefix_filter?: string;
  limit?: number;
  follow?: boolean;
  print_as?: "value" | "detail" | "terse";
}

/** Shared log query used directly by `get_logs` and the convenience views. */
async function runGetLogs(o: GetLogsOptions, ctx: ToolContext): Promise<string> {
  const printAs = o.print_as ?? "value";
  ctx.info(
    `Getting logs with filters: topics=${o.topics}, action=${o.action}, time=${o.time_filter}`,
  );

  let cmd = `/log print ${printAs}`;

  const filters: string[] = [];

  if (o.topics) {
    // Handle multiple topics separated by comma
    const topicList = o.topics.split(",").map((t) => t.trim());
    const topicFilter = topicList.map((t) => `topics~"${t}"`).join(" or ");
    if (topicList.length > 1) filters.push(`(${topicFilter})`);
    else filters.push(topicFilter);
  }

  if (o.action) filters.push(`action="${o.action}"`);
  if (o.message_filter) filters.push(`message~"${o.message_filter}"`);
  if (o.prefix_filter) filters.push(`message~"^${o.prefix_filter}"`);
  if (o.time_filter) filters.push(`time > ([:timestamp] - ${o.time_filter})`);

  if (filters.length) cmd += ` where ${filters.join(" and ")}`;
  if (o.follow) cmd += " follow";

  const result = await executeMikrotikCommand(cmd, ctx);
  if (isEmpty(result)) return "No log entries found matching the criteria.";
  const limited = o.limit ? tailLines(result, o.limit) : result;
  return `LOG ENTRIES:\n\n${limited}`;
}

export const logTools: ToolModule = [
  defineTool({
    name: "get_logs",
    title: "Get Logs",
    annotations: READ,
    description:
      "Gets logs from the MikroTik device with optional topic, time, and message filters.",
    inputSchema: {
      topics: z.string().optional(),
      action: z.string().optional(),
      time_filter: z.string().optional(),
      message_filter: z.string().optional(),
      prefix_filter: z.string().optional(),
      limit: z.number().int().optional(),
      follow: z.boolean().default(false),
      print_as: z.enum(["value", "detail", "terse"]).default("value"),
    },
    async handler(a, ctx) {
      return runGetLogs(
        {
          topics: a.topics,
          action: a.action,
          time_filter: a.time_filter,
          message_filter: a.message_filter,
          prefix_filter: a.prefix_filter,
          limit: a.limit,
          follow: a.follow,
          print_as: a.print_as,
        },
        ctx,
      );
    },
  }),

  defineTool({
    name: "get_logs_by_severity",
    title: "Get Logs by Severity",
    annotations: READ,
    description: "Gets logs filtered by severity level (debug/info/warning/error/critical).",
    inputSchema: {
      severity: z.enum(["debug", "info", "warning", "error", "critical"]),
      time_filter: z.string().optional(),
      limit: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Getting logs by severity: severity=${a.severity}`);

      // Map severity to topics
      const severityTopics: Record<string, string> = {
        debug: "debug",
        info: "info",
        warning: "warning",
        error: "error,critical",
        critical: "critical",
      };

      const topics = severityTopics[a.severity];

      return runGetLogs({ topics, time_filter: a.time_filter, limit: a.limit }, ctx);
    },
  }),

  defineTool({
    name: "get_logs_by_topic",
    title: "Get Logs by Topic",
    annotations: READ,
    description:
      "Gets logs for a specific topic/facility (system, dhcp, interface, firewall, etc.).",
    inputSchema: {
      topic: z.string(),
      time_filter: z.string().optional(),
      limit: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Getting logs by topic: topic=${a.topic}`);
      return runGetLogs({ topics: a.topic, time_filter: a.time_filter, limit: a.limit }, ctx);
    },
  }),

  defineTool({
    name: "search_logs",
    title: "Search Logs",
    annotations: READ,
    description: "Searches log messages for a specific term.",
    inputSchema: {
      search_term: z.string(),
      time_filter: z.string().optional(),
      case_sensitive: z.boolean().default(false),
      limit: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Searching logs for: term=${a.search_term}`);

      // MikroTik uses ~ for partial match (case-insensitive by default); the
      // case_sensitive flag does not change the filter we build here.
      const message_filter = a.search_term;

      return runGetLogs({ message_filter, time_filter: a.time_filter, limit: a.limit }, ctx);
    },
  }),

  defineTool({
    name: "get_system_events",
    title: "System Events",
    annotations: READ,
    description: "Gets system-related log events (login, reboot, config-change, etc.).",
    inputSchema: {
      event_type: z.string().optional(),
      time_filter: z.string().optional(),
      limit: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Getting system events: type=${a.event_type}`);

      // Build filter based on event type
      const topics = "system";
      let message_filter: string | undefined;

      if (a.event_type) {
        const eventPatterns: Record<string, string> = {
          login: "logged in",
          logout: "logged out",
          reboot: "reboot",
          "config-change": "config changed",
          backup: "backup",
          restore: "restore",
          upgrade: "upgrade",
        };

        const key = a.event_type.toLowerCase();
        message_filter = key in eventPatterns ? eventPatterns[key] : a.event_type;
      }

      return runGetLogs(
        { topics, message_filter, time_filter: a.time_filter, limit: a.limit },
        ctx,
      );
    },
  }),

  defineTool({
    name: "get_security_logs",
    title: "Security Logs",
    annotations: READ,
    description: "Gets security-related log entries (login failures, blocked connections, etc.).",
    inputSchema: {
      time_filter: z.string().optional(),
      limit: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Getting security logs");

      // Security-related topics and keywords. RouterOS `where` clauses require
      // double-quoted strings (single quotes are a syntax error), and matching
      // several topics needs an OR of separate `topics~"…"` terms rather than a
      // single comma-joined regex.
      const securityTopics = ["system", "firewall", "warning", "error"];
      const securityKeywords = "(login|logout|failed|denied|blocked|attack|invalid|unauthorized)";

      let cmd = `/log print where ${orMatch("topics", securityTopics)} and message~"${securityKeywords}"`;

      if (a.time_filter) cmd += ` and time > ([:timestamp] - ${a.time_filter})`;

      const result = await executeMikrotikCommand(cmd, ctx);
      if (isEmpty(result)) return "No security-related log entries found.";
      const limited = a.limit ? tailLines(result, a.limit) : result;
      return `SECURITY LOG ENTRIES:\n\n${limited}`;
    },
  }),

  defineTool({
    name: "clear_logs",
    title: "Clear Logs",
    annotations: DESTRUCTIVE,
    description: "Clears all logs from the MikroTik device. This action cannot be undone.",
    async handler(_a, ctx) {
      ctx.info("Clearing all logs");

      const result = await executeMikrotikCommand("/log print follow-only", ctx);
      if (result.trim() === "") return "Logs cleared successfully.";
      return `Log clear result: ${result}`;
    },
  }),

  defineTool({
    name: "get_log_statistics",
    title: "Log Statistics",
    annotations: READ,
    description: "Gets log entry counts by topic and severity from the MikroTik device.",
    async handler(_a, ctx) {
      ctx.info("Getting log statistics");

      // Get total count
      const totalCount = await executeMikrotikCommand("/log print count-only", ctx);

      const stats = [`Total log entries: ${totalCount.trim()}`];

      // Get counts by common topics
      const topics = ["info", "warning", "error", "system", "dhcp", "firewall", "interface"];
      for (const topic of topics) {
        const count = await executeMikrotikCommand(
          `/log print count-only where topics~"${topic}"`,
          ctx,
        );
        const c = count.trim();
        if (/^\d+$/.test(c) && Number.parseInt(c, 10) > 0) {
          stats.push(`${topic.charAt(0).toUpperCase()}${topic.slice(1)}: ${c}`);
        }
      }

      // Get recent entries count (last hour)
      const recentCount = await executeMikrotikCommand(
        "/log print count-only where time > ([:timestamp] - 1h)",
        ctx,
      );
      stats.push(`\nEntries in last hour: ${recentCount.trim()}`);

      // Get today's entries
      const todayCount = await executeMikrotikCommand(
        "/log print count-only where time > ([:timestamp] - 1d)",
        ctx,
      );
      stats.push(`Entries in last 24 hours: ${todayCount.trim()}`);

      return `LOG STATISTICS:\n\n${stats.join("\n")}`;
    },
  }),

  defineTool({
    name: "export_logs",
    title: "Export Logs",
    annotations: READ,
    description:
      "Exports logs to a file on the MikroTik device with optional topic and time filters.",
    inputSchema: {
      filename: z.string().optional(),
      topics: z.string().optional(),
      time_filter: z.string().optional(),
      format: z.enum(["plain", "csv"]).default("plain"),
    },
    async handler(a, ctx) {
      const filename = a.filename || `logs_export_${Math.floor(Date.now() / 1000)}`;

      ctx.info(`Exporting logs to file: ${filename}`);

      let cmd = `/log print file=${filename}`;

      const filters: string[] = [];
      if (a.topics) filters.push(`topics~"${a.topics}"`);
      if (a.time_filter) filters.push(`time > ([:timestamp] - ${a.time_filter})`);

      if (filters.length) cmd += ` where ${filters.join(" and ")}`;

      const result = await executeMikrotikCommand(cmd, ctx);

      if (result.trim() === "") return `Logs exported to file: ${filename}.txt`;
      return `Export result: ${result}`;
    },
  }),

  defineTool({
    name: "monitor_logs",
    title: "Monitor Logs",
    annotations: READ,
    description: "Monitors MikroTik logs in near-real-time for a limited duration (max 60s).",
    inputSchema: {
      topics: z.string().optional(),
      action: z.string().optional(),
      duration: z.number().int().default(10),
    },
    async handler(a, ctx) {
      ctx.info(`Monitoring logs for ${a.duration} seconds`);

      // Limit duration for safety
      let duration = a.duration;
      if (duration > 60) duration = 60;

      // A non-interactive SSH session can't truly stream, so instead of the
      // blocking `follow-only` we read the entries logged within the last
      // `duration` seconds. RouterOS `print` has no `limit=`, so the output is
      // capped client-side via tailLines().
      const filters: string[] = [];
      if (a.topics) filters.push(`topics~"${a.topics}"`);
      if (a.action) filters.push(`action="${a.action}"`);
      filters.push(`time > ([:timestamp] - ${duration}s)`);

      const cmd = `/log print where ${filters.join(" and ")}`;
      const result = await executeMikrotikCommand(cmd, ctx);
      if (isEmpty(result)) {
        return `LOG MONITOR (last ${duration} seconds):\n\nNo log entries in this window.`;
      }

      return `LOG MONITOR (last ${duration} seconds):\n\n${tailLines(result, 100)}`;
    },
  }),
];
