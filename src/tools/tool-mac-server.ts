/** MAC server — `/tool mac-server` (MAC-Telnet, MAC-Winbox, MAC-ping). */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const macServerTools: ToolModule = [
  // ── MAC-Telnet server ───────────────────────────────────────────────────────
  defineTool({
    name: "get_mac_server",
    title: "Get MAC Server",
    annotations: READ,
    description:
      "Gets the MAC-Telnet server settings (`/tool mac-server`).",
    async handler(_a, ctx) {
      ctx.info("Getting mac-server settings");
      const result = await executeMikrotikCommand(
        "/tool mac-server print",
        ctx,
      );
      return isEmpty(result)
        ? "Unable to read mac-server settings."
        : `MAC SERVER:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_mac_server",
    title: "Update MAC Server",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates the MAC-Telnet server settings of the MikroTik device.\n\n" +
      "Notes:\n" +
      "    allowed_interface_list: which interfaces accept MAC-Telnet — an\n" +
      "        interface-list name, or 'all' / 'none'.",
    inputSchema: {
      allowed_interface_list: z
        .string()
        .describe("Interface-list name, or 'all' / 'none'"),
    },
    async handler(a, ctx) {
      ctx.info("Updating mac-server settings");
      const cmd = new Cmd("/tool mac-server set")
        .set("allowed-interface-list", a.allowed_interface_list)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to update mac-server: ${result}`;
      const details = await executeMikrotikCommand(
        "/tool mac-server print",
        ctx,
      );
      return `MAC server updated successfully:\n\n${details}`;
    },
  }),

  // ── MAC-Winbox server ───────────────────────────────────────────────────────
  defineTool({
    name: "get_mac_winbox",
    title: "Get MAC Winbox Server",
    annotations: READ,
    description:
      "Gets the MAC-Winbox server settings (`/tool mac-server mac-winbox`).",
    async handler(_a, ctx) {
      ctx.info("Getting mac-winbox settings");
      const result = await executeMikrotikCommand(
        "/tool mac-server mac-winbox print",
        ctx,
      );
      return isEmpty(result)
        ? "Unable to read mac-winbox settings."
        : `MAC WINBOX SERVER:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_mac_winbox",
    title: "Update MAC Winbox Server",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates the MAC-Winbox server settings of the MikroTik device " +
      "(which interfaces accept Winbox over MAC).",
    inputSchema: {
      allowed_interface_list: z
        .string()
        .describe("Interface-list name, or 'all' / 'none'"),
    },
    async handler(a, ctx) {
      ctx.info("Updating mac-winbox settings");
      const cmd = new Cmd("/tool mac-server mac-winbox set")
        .set("allowed-interface-list", a.allowed_interface_list)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to update mac-winbox: ${result}`;
      const details = await executeMikrotikCommand(
        "/tool mac-server mac-winbox print",
        ctx,
      );
      return `MAC Winbox server updated successfully:\n\n${details}`;
    },
  }),

  // ── MAC-ping ────────────────────────────────────────────────────────────────
  defineTool({
    name: "get_mac_ping",
    title: "Get MAC Ping",
    annotations: READ,
    description:
      "Gets the MAC-ping server setting (`/tool mac-server ping`).",
    async handler(_a, ctx) {
      ctx.info("Getting mac-ping settings");
      const result = await executeMikrotikCommand(
        "/tool mac-server ping print",
        ctx,
      );
      return isEmpty(result)
        ? "Unable to read mac-ping settings."
        : `MAC PING:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_mac_ping",
    title: "Update MAC Ping",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Enables or disables the MAC-ping server (`/tool mac-server ping`).",
    inputSchema: {
      enabled: z.boolean().describe("Whether MAC-ping is enabled"),
    },
    async handler(a, ctx) {
      ctx.info(`Updating mac-ping: enabled=${a.enabled}`);
      const cmd = new Cmd("/tool mac-server ping set")
        .bool("enabled", a.enabled)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to update mac-ping: ${result}`;
      const details = await executeMikrotikCommand(
        "/tool mac-server ping print",
        ctx,
      );
      return `MAC ping updated successfully:\n\n${details}`;
    },
  }),

  // ── Sessions ────────────────────────────────────────────────────────────────
  defineTool({
    name: "list_mac_server_sessions",
    title: "List MAC Server Sessions",
    annotations: READ,
    description:
      "Lists active MAC-Telnet sessions (`/tool mac-server session`).",
    inputSchema: {
      interface_filter: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Listing mac-server sessions");
      const filters: string[] = [];
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);

      const result = await executeMikrotikCommand(
        `/tool mac-server session print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No active MAC-server sessions."
        : `MAC SERVER SESSIONS:\n\n${result}`;
    },
  }),
];
