/** Traffic monitor — `/tool traffic-monitor` (threshold-triggered scripts). */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { yesno, whereClause, quoteValue, looksLikeError, isEmpty, Cmd } from "../core/routeros";

const Traffic = z.enum(["received", "transmitted"]);
const Trigger = z.enum(["above", "below", "always"]);

export const trafficMonitorTools: ToolModule = [
  defineTool({
    name: "add_traffic_monitor",
    title: "Add Traffic Monitor",
    annotations: WRITE,
    description:
      "Adds a traffic-monitor entry that runs a script when an interface's " +
      "traffic crosses a threshold (`/tool traffic-monitor`).\n\n" +
      "Notes:\n" +
      "    traffic: which direction to watch (received or transmitted).\n" +
      "    trigger: fire when traffic goes 'above' or 'below' the threshold\n" +
      "        (or 'always').\n" +
      "    threshold: rate in bits/second.",
    inputSchema: {
      name: z.string(),
      interface: z.string(),
      traffic: Traffic,
      trigger: Trigger,
      threshold: z.number().int().describe("Rate threshold in bits/second"),
      on_event: z.string().optional().describe("Script source/name to run on trigger"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding traffic-monitor: name=${a.name}`);
      const cmd = new Cmd("/tool traffic-monitor add")
        .set("name", a.name)
        .set("interface", a.interface)
        .set("traffic", a.traffic)
        .set("trigger", a.trigger)
        .set("threshold", a.threshold)
        .opt("on-event", a.on_event)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add traffic-monitor: ${result}`;
      const details = await executeMikrotikCommand(
        `/tool traffic-monitor print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `Traffic monitor added successfully:\n\n${details}`
        : "Traffic monitor addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_traffic_monitors",
    title: "List Traffic Monitors",
    annotations: READ,
    description: "Lists traffic-monitor entries (`/tool traffic-monitor`).",
    inputSchema: {
      name_filter: z.string().optional(),
      interface_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing traffic monitors");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      const result = await executeMikrotikCommand(
        `/tool traffic-monitor print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No traffic monitors found matching the criteria."
        : `TRAFFIC MONITORS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_traffic_monitor",
    title: "Get Traffic Monitor",
    annotations: READ,
    description: "Gets a specific traffic-monitor entry by name.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting traffic-monitor: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/tool traffic-monitor print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `Traffic monitor '${a.name}' not found.`
        : `TRAFFIC MONITOR DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_traffic_monitor",
    title: "Update Traffic Monitor",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates a traffic-monitor entry by name. " + 'Pass comment="" to clear the comment.',
    inputSchema: {
      name: z.string(),
      interface: z.string().optional(),
      traffic: Traffic.optional(),
      trigger: Trigger.optional(),
      threshold: z.number().int().optional(),
      on_event: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating traffic-monitor: name=${a.name}`);
      const base = `/tool traffic-monitor set [find name="${a.name}"]`;
      const cmd = new Cmd(base)
        .opt("interface", a.interface)
        .opt("traffic", a.traffic)
        .opt("trigger", a.trigger)
        .opt("threshold", a.threshold)
        .opt("on-event", a.on_event);
      if (a.comment !== undefined) cmd.raw(`comment=${quoteValue(a.comment)}`);
      if (a.disabled !== undefined) cmd.raw(`disabled=${yesno(a.disabled)}`);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result)) return `Failed to update traffic-monitor: ${result}`;
      const details = await executeMikrotikCommand(
        `/tool traffic-monitor print detail where name="${a.name}"`,
        ctx,
      );
      return `Traffic monitor updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_traffic_monitor",
    title: "Remove Traffic Monitor",
    annotations: DESTRUCTIVE,
    description: "Removes a traffic-monitor entry by name.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing traffic-monitor: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/tool traffic-monitor print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `Traffic monitor '${a.name}' not found.`;
      const result = await executeMikrotikCommand(
        `/tool traffic-monitor remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove traffic-monitor: ${result}`;
      return `Traffic monitor '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_traffic_monitor",
    title: "Enable Traffic Monitor",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a traffic-monitor entry by name.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Enabling traffic-monitor: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/tool traffic-monitor enable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to enable traffic-monitor: ${result}`;
      return `Traffic monitor '${a.name}' enabled.`;
    },
  }),

  defineTool({
    name: "disable_traffic_monitor",
    title: "Disable Traffic Monitor",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a traffic-monitor entry by name.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Disabling traffic-monitor: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/tool traffic-monitor disable [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to disable traffic-monitor: ${result}`;
      return `Traffic monitor '${a.name}' disabled.`;
    },
  }),
];
