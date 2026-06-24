/**
 * Traffic generator — `/tool traffic-generator`.
 *
 * Covers ports and streams plus run control (start/stop). Packet-templates and
 * the interactive `monitor`/`quick` live stats are intentionally not wrapped:
 * templates need full per-header definitions and the live stats stream
 * continuously, neither of which suits a one-shot tool call.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const trafficGeneratorTools: ToolModule = [
  // ── Ports ───────────────────────────────────────────────────────────────────
  defineTool({
    name: "add_traffic_generator_port",
    title: "Add Traffic Generator Port",
    annotations: WRITE,
    description:
      "Adds a traffic-generator port binding a name to a physical interface " +
      "(`/tool traffic-generator port`).",
    inputSchema: {
      name: z.string(),
      interface: z.string(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding traffic-generator port: name=${a.name}`);
      const cmd = new Cmd("/tool traffic-generator port add")
        .set("name", a.name)
        .set("interface", a.interface)
        .flag("disabled", a.disabled)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add traffic-generator port: ${result}`;
      const details = await executeMikrotikCommand(
        `/tool traffic-generator port print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `Traffic-generator port added successfully:\n\n${details}`
        : "Traffic-generator port addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_traffic_generator_ports",
    title: "List Traffic Generator Ports",
    annotations: READ,
    description: "Lists traffic-generator ports (`/tool traffic-generator port`).",
    inputSchema: {
      name_filter: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Listing traffic-generator ports");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      const result = await executeMikrotikCommand(
        `/tool traffic-generator port print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No traffic-generator ports found matching the criteria."
        : `TRAFFIC GENERATOR PORTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_traffic_generator_port",
    title: "Remove Traffic Generator Port",
    annotations: DESTRUCTIVE,
    description: "Removes a traffic-generator port by name or '.id' from the MikroTik device.",
    inputSchema: {
      port_id: z.string().describe("Port name or RouterOS '.id'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing traffic-generator port: port_id=${a.port_id}`);
      const selector = a.port_id.startsWith("*") ? `.id="${a.port_id}"` : `name="${a.port_id}"`;
      const count = await executeMikrotikCommand(
        `/tool traffic-generator port print count-only where ${selector}`,
        ctx,
      );
      if (count.trim() === "0") return `Traffic-generator port '${a.port_id}' not found.`;
      const result = await executeMikrotikCommand(
        `/tool traffic-generator port remove [find ${selector}]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove traffic-generator port: ${result}`;
      return `Traffic-generator port '${a.port_id}' removed successfully.`;
    },
  }),

  // ── Streams ─────────────────────────────────────────────────────────────────
  defineTool({
    name: "add_traffic_generator_stream",
    title: "Add Traffic Generator Stream",
    annotations: WRITE,
    description:
      "Adds a traffic-generator stream describing what to transmit on a port " +
      "(`/tool traffic-generator stream`).\n\n" +
      "Notes:\n" +
      "    tx_template: name of an existing packet-template to send.\n" +
      "    tx_rate: transmit rate in bits/second.",
    inputSchema: {
      name: z.string(),
      port: z.string().describe("Traffic-generator port name"),
      tx_template: z.string().optional().describe("Packet-template name to transmit"),
      packet_size: z.string().optional().describe("Packet size or range"),
      tx_rate: z.string().optional().describe("Transmit rate in bits/second"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding traffic-generator stream: name=${a.name}`);
      const cmd = new Cmd("/tool traffic-generator stream add")
        .set("name", a.name)
        .set("port", a.port)
        .opt("tx-template", a.tx_template)
        .opt("packet-size", a.packet_size)
        .opt("tx-rate", a.tx_rate)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add traffic-generator stream: ${result}`;
      const details = await executeMikrotikCommand(
        `/tool traffic-generator stream print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `Traffic-generator stream added successfully:\n\n${details}`
        : "Traffic-generator stream addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_traffic_generator_streams",
    title: "List Traffic Generator Streams",
    annotations: READ,
    description: "Lists traffic-generator streams (`/tool traffic-generator stream`).",
    inputSchema: {
      name_filter: z.string().optional(),
      port_filter: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Listing traffic-generator streams");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.port_filter) filters.push(`port="${a.port_filter}"`);
      const result = await executeMikrotikCommand(
        `/tool traffic-generator stream print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No traffic-generator streams found matching the criteria."
        : `TRAFFIC GENERATOR STREAMS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_traffic_generator_stream",
    title: "Remove Traffic Generator Stream",
    annotations: DESTRUCTIVE,
    description: "Removes a traffic-generator stream by name or '.id' from the MikroTik device.",
    inputSchema: {
      stream_id: z.string().describe("Stream name or RouterOS '.id'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing traffic-generator stream: stream_id=${a.stream_id}`);
      const selector = a.stream_id.startsWith("*")
        ? `.id="${a.stream_id}"`
        : `name="${a.stream_id}"`;
      const count = await executeMikrotikCommand(
        `/tool traffic-generator stream print count-only where ${selector}`,
        ctx,
      );
      if (count.trim() === "0") return `Traffic-generator stream '${a.stream_id}' not found.`;
      const result = await executeMikrotikCommand(
        `/tool traffic-generator stream remove [find ${selector}]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove traffic-generator stream: ${result}`;
      return `Traffic-generator stream '${a.stream_id}' removed successfully.`;
    },
  }),

  // ── Run control ─────────────────────────────────────────────────────────────
  defineTool({
    name: "start_traffic_generator",
    title: "Start Traffic Generator",
    annotations: WRITE,
    description:
      "Starts the traffic generator, transmitting the configured streams " +
      "(`/tool traffic-generator start`).",
    inputSchema: {
      duration: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Optional run duration in seconds (else runs until stopped)"),
    },
    async handler(a, ctx) {
      ctx.info("Starting traffic generator");
      const cmd = new Cmd("/tool traffic-generator start")
        .opt("duration", a.duration ? `${a.duration}s` : undefined)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to start traffic generator: ${result}`;
      return "Traffic generator started.";
    },
  }),

  defineTool({
    name: "stop_traffic_generator",
    title: "Stop Traffic Generator",
    annotations: WRITE,
    description: "Stops the traffic generator (`/tool traffic-generator stop`).",
    async handler(_a, ctx) {
      ctx.info("Stopping traffic generator");
      const result = await executeMikrotikCommand("/tool traffic-generator stop", ctx);
      if (looksLikeError(result)) return `Failed to stop traffic generator: ${result}`;
      return "Traffic generator stopped.";
    },
  }),
];
