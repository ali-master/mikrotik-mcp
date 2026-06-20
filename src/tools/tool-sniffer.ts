/** Packet sniffer — `/tool sniffer`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import {
  WRITE_IDEMPOTENT,
  WRITE,
  READ,
  defineTool,
} from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const snifferTools: ToolModule = [
  defineTool({
    name: "get_sniffer_settings",
    title: "Get Sniffer Settings",
    annotations: READ,
    description:
      "Gets the packet sniffer configuration and running state (`/tool sniffer`).",
    async handler(_a, ctx) {
      ctx.info("Getting sniffer settings");
      const result = await executeMikrotikCommand("/tool sniffer print", ctx);
      return isEmpty(result)
        ? "Unable to read sniffer settings."
        : `SNIFFER SETTINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_sniffer_settings",
    title: "Update Sniffer Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates the packet sniffer configuration on the MikroTik device.\n\n" +
      "Notes:\n" +
      "    streaming_enabled + streaming_server: forward captured packets as\n" +
      "        TZSP to a remote analyzer (e.g. Wireshark).\n" +
      "    memory_limit: capture buffer size, e.g. '10M'.\n" +
      "    only_headers: capture packet headers only (smaller buffer).",
    inputSchema: {
      filter_interface: z.string().optional(),
      filter_ip_address: z
        .string()
        .optional()
        .describe("Match IP/CIDR, e.g. '10.0.0.0/24'"),
      filter_port: z.string().optional(),
      filter_mac_protocol: z.string().optional(),
      streaming_enabled: z.boolean().optional(),
      streaming_server: z
        .string()
        .optional()
        .describe("TZSP target, e.g. '192.168.88.2'"),
      memory_limit: z.string().optional().describe("Buffer size, e.g. '10M'"),
      file_name: z.string().optional().describe("Capture file name (.pcap)"),
      only_headers: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Updating sniffer settings");
      const cmd = new Cmd("/tool sniffer set")
        .opt("filter-interface", a.filter_interface)
        .opt("filter-ip-address", a.filter_ip_address)
        .opt("filter-port", a.filter_port)
        .opt("filter-mac-protocol", a.filter_mac_protocol)
        .bool("streaming-enabled", a.streaming_enabled)
        .opt("streaming-server", a.streaming_server)
        .opt("memory-limit", a.memory_limit)
        .opt("file-name", a.file_name)
        .bool("only-headers", a.only_headers);

      const built = cmd.build();
      if (built === "/tool sniffer set") return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result))
        return `Failed to update sniffer settings: ${result}`;
      const details = await executeMikrotikCommand("/tool sniffer print", ctx);
      return `Sniffer settings updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "start_sniffer",
    title: "Start Sniffer",
    annotations: WRITE,
    description:
      "Starts the packet sniffer capturing into memory (and a file if " +
      "configured). Stop it with stop_sniffer to read the results.",
    async handler(_a, ctx) {
      ctx.info("Starting sniffer");
      const result = await executeMikrotikCommand("/tool sniffer start", ctx);
      if (looksLikeError(result)) return `Failed to start sniffer: ${result}`;
      return "Packet sniffer started.";
    },
  }),

  defineTool({
    name: "stop_sniffer",
    title: "Stop Sniffer",
    annotations: WRITE,
    description: "Stops the packet sniffer.",
    async handler(_a, ctx) {
      ctx.info("Stopping sniffer");
      const result = await executeMikrotikCommand("/tool sniffer stop", ctx);
      if (looksLikeError(result)) return `Failed to stop sniffer: ${result}`;
      return "Packet sniffer stopped.";
    },
  }),

  defineTool({
    name: "save_sniffer",
    title: "Save Sniffer Capture",
    annotations: WRITE,
    description:
      "Saves the current sniffer buffer to a .pcap file on the device.",
    inputSchema: {
      file_name: z.string().describe("Output file name, e.g. 'capture'"),
    },
    async handler(a, ctx) {
      ctx.info(`Saving sniffer capture to ${a.file_name}`);
      const result = await executeMikrotikCommand(
        `/tool sniffer save file-name="${a.file_name}"`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to save sniffer capture: ${result}`;
      return `Sniffer capture saved to '${a.file_name}'.`;
    },
  }),

  defineTool({
    name: "list_sniffer_packets",
    title: "List Sniffer Packets",
    annotations: READ,
    description: "Lists captured packets (`/tool sniffer packet`).",
    inputSchema: {
      address_filter: z
        .string()
        .optional()
        .describe("Partial src/dst address match"),
      protocol_filter: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Listing sniffer packets");
      const filters: string[] = [];
      if (a.address_filter)
        filters.push(
          `(src-address~"${a.address_filter}" or dst-address~"${a.address_filter}")`,
        );
      if (a.protocol_filter) filters.push(`protocol~"${a.protocol_filter}"`);

      const result = await executeMikrotikCommand(
        `/tool sniffer packet print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No captured packets found matching the criteria."
        : `SNIFFER PACKETS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "list_sniffer_hosts",
    title: "List Sniffer Hosts",
    annotations: READ,
    description:
      "Lists hosts seen by the sniffer with byte/packet counts (`/tool sniffer host`).",
    inputSchema: {
      address_filter: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Listing sniffer hosts");
      const filters: string[] = [];
      if (a.address_filter) filters.push(`address~"${a.address_filter}"`);

      const result = await executeMikrotikCommand(
        `/tool sniffer host print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No sniffer hosts found matching the criteria."
        : `SNIFFER HOSTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "list_sniffer_protocols",
    title: "List Sniffer Protocols",
    annotations: READ,
    description:
      "Lists the protocol distribution seen by the sniffer (`/tool sniffer protocol`).",
    async handler(_a, ctx) {
      ctx.info("Listing sniffer protocols");
      const result = await executeMikrotikCommand(
        "/tool sniffer protocol print",
        ctx,
      );
      return isEmpty(result)
        ? "No sniffer protocol data found."
        : `SNIFFER PROTOCOLS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "list_sniffer_connections",
    title: "List Sniffer Connections",
    annotations: READ,
    description:
      "Lists connections observed by the sniffer (`/tool sniffer connection`).",
    async handler(_a, ctx) {
      ctx.info("Listing sniffer connections");
      const result = await executeMikrotikCommand(
        "/tool sniffer connection print",
        ctx,
      );
      return isEmpty(result)
        ? "No sniffer connections found."
        : `SNIFFER CONNECTIONS:\n\n${result}`;
    },
  }),
];
