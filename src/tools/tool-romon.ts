/** RoMON (Router Management Overlay Network) — `/tool romon`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import {
  WRITE_IDEMPOTENT,
  WRITE,
  READ,
  DESTRUCTIVE,
  defineTool,
} from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const romonTools: ToolModule = [
  defineTool({
    name: "get_romon",
    title: "Get RoMON",
    annotations: READ,
    description:
      "Gets the RoMON settings of the MikroTik device (`/tool romon`).",
    async handler(_a, ctx) {
      ctx.info("Getting romon settings");
      const result = await executeMikrotikCommand("/tool romon print", ctx);
      return isEmpty(result)
        ? "Unable to read romon settings."
        : `ROMON:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_romon",
    title: "Update RoMON",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates the RoMON settings of the MikroTik device.\n\n" +
      "Notes:\n" +
      "    enabled: turn the Layer-2 RoMON management overlay on/off.\n" +
      "    id: RoMON ID (defaults to a MAC); secrets: shared secret(s) for the\n" +
      "        overlay.",
    inputSchema: {
      enabled: z.boolean().optional(),
      id: z.string().optional().describe("RoMON ID (MAC-style)"),
      secrets: z.string().optional().describe("Comma-separated shared secret(s)"),
    },
    async handler(a, ctx) {
      // secrets intentionally not logged.
      ctx.info(`Updating romon settings (enabled=${a.enabled ?? "unchanged"})`);
      const cmd = new Cmd("/tool romon set")
        .bool("enabled", a.enabled)
        .opt("id", a.id)
        .opt("secrets", a.secrets);

      const built = cmd.build();
      if (built === "/tool romon set") return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result)) return `Failed to update romon: ${result}`;
      const details = await executeMikrotikCommand("/tool romon print", ctx);
      return `RoMON updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "add_romon_port",
    title: "Add RoMON Port",
    annotations: WRITE,
    description:
      "Adds a RoMON port entry controlling which interfaces participate in the " +
      "overlay (`/tool romon port`).",
    inputSchema: {
      interface: z
        .string()
        .default("all")
        .describe("Interface, or 'all' for the default entry"),
      cost: z.number().int().optional().describe("Path cost for the overlay"),
      secrets: z.string().optional(),
      forbid: z
        .boolean()
        .optional()
        .describe("Forbid RoMON on this interface"),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding romon port: interface=${a.interface}`);
      const cmd = new Cmd("/tool romon port add")
        .set("interface", a.interface)
        .opt("cost", a.cost)
        .opt("secrets", a.secrets)
        .bool("forbid", a.forbid)
        .flag("disabled", a.disabled)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to add romon port: ${result}`;
      const details = await executeMikrotikCommand(
        `/tool romon port print detail where interface="${a.interface}"`,
        ctx,
      );
      return details.trim()
        ? `RoMON port added successfully:\n\n${details}`
        : "RoMON port addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_romon_ports",
    title: "List RoMON Ports",
    annotations: READ,
    description: "Lists RoMON port entries (`/tool romon port`).",
    inputSchema: {
      interface_filter: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Listing romon ports");
      const filters: string[] = [];
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);

      const result = await executeMikrotikCommand(
        `/tool romon port print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No RoMON ports found matching the criteria."
        : `ROMON PORTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_romon_port",
    title: "Remove RoMON Port",
    annotations: DESTRUCTIVE,
    description:
      "Removes a RoMON port entry by interface or '.id' from the MikroTik device.",
    inputSchema: {
      port_id: z.string().describe("Interface name or RouterOS '.id'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing romon port: port_id=${a.port_id}`);
      const selector = a.port_id.startsWith("*")
        ? `.id="${a.port_id}"`
        : `interface="${a.port_id}"`;
      const count = await executeMikrotikCommand(
        `/tool romon port print count-only where ${selector}`,
        ctx,
      );
      if (count.trim() === "0") return `RoMON port '${a.port_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/tool romon port remove [find ${selector}]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove romon port: ${result}`;
      return `RoMON port '${a.port_id}' removed successfully.`;
    },
  }),
];
