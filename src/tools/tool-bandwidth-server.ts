/** Bandwidth-test server — `/tool bandwidth-server`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const bandwidthServerTools: ToolModule = [
  defineTool({
    name: "get_bandwidth_server",
    title: "Get Bandwidth Server",
    annotations: READ,
    description:
      "Gets the bandwidth-test server settings of the MikroTik device " +
      "(`/tool bandwidth-server`).",
    async handler(_a, ctx) {
      ctx.info("Getting bandwidth-server settings");
      const result = await executeMikrotikCommand("/tool bandwidth-server print", ctx);
      return isEmpty(result)
        ? "Unable to read bandwidth-server settings."
        : `BANDWIDTH SERVER:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_bandwidth_server",
    title: "Update Bandwidth Server",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates the bandwidth-test server settings of the MikroTik device.\n\n" +
      "Notes:\n" +
      "    enabled: accept incoming bandwidth-test sessions.\n" +
      "    authenticate: require valid device credentials from test clients.\n" +
      "    max_sessions: cap concurrent test sessions.",
    inputSchema: {
      enabled: z.boolean().optional(),
      authenticate: z.boolean().optional(),
      max_sessions: z.number().int().min(1).optional(),
      allocate_udp_ports_from: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Updating bandwidth-server settings");
      const cmd = new Cmd("/tool bandwidth-server set")
        .bool("enabled", a.enabled)
        .bool("authenticate", a.authenticate)
        .opt("max-sessions", a.max_sessions)
        .opt("allocate-udp-ports-from", a.allocate_udp_ports_from);

      const built = cmd.build();
      if (built === "/tool bandwidth-server set") return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result)) return `Failed to update bandwidth-server: ${result}`;

      const details = await executeMikrotikCommand("/tool bandwidth-server print", ctx);
      return `Bandwidth server updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "list_bandwidth_server_sessions",
    title: "List Bandwidth Server Sessions",
    annotations: READ,
    description: "Lists active bandwidth-test server sessions (`/tool bandwidth-server session`).",
    inputSchema: {
      user_filter: z.string().optional().describe("Partial user match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing bandwidth-server sessions");
      const filters: string[] = [];
      if (a.user_filter) filters.push(`user~"${a.user_filter}"`);

      const result = await executeMikrotikCommand(
        `/tool bandwidth-server session print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No active bandwidth-server sessions."
        : `BANDWIDTH SERVER SESSIONS:\n\n${result}`;
    },
  }),
];
