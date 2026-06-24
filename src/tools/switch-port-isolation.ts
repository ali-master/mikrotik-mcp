/** Switch port isolation — `/interface ethernet switch port-isolation`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, quoteValue, looksLikeError, isEmpty, Cmd } from "../core/routeros";

/** Build the RouterOS `[find ...]` selector for a port (by name) or `.id`. */
function selectorFor(id: string): string {
  return id.startsWith("*") ? `.id="${id}"` : `port="${id}"`;
}

export const switchPortIsolationTools: ToolModule = [
  defineTool({
    name: "add_switch_port_isolation",
    title: "Add Switch Port Isolation",
    annotations: WRITE,
    description:
      "Adds a switch port-isolation entry on the MikroTik device, overriding " +
      "which ports a given port may forward traffic to (hardware private-VLAN " +
      "style isolation).\n\n" +
      "Notes:\n" +
      "    port: the source port being isolated.\n" +
      "    forwarding_override_ports: comma-separated list of the only ports\n" +
      "        this port may forward to (others are blocked in hardware).",
    inputSchema: {
      port: z.string().describe("Source port to isolate, e.g. 'ether1'"),
      forwarding_override_ports: z.string().describe("Comma-separated allowed destination ports"),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Adding switch port-isolation: port=${a.port}`);
      const cmd = new Cmd("/interface ethernet switch port-isolation add")
        .set("port", a.port)
        .set("forwarding-override-ports", a.forwarding_override_ports)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add switch port-isolation: ${result}`;
      const details = await executeMikrotikCommand(
        `/interface ethernet switch port-isolation print detail where port="${a.port}"`,
        ctx,
      );
      return details.trim()
        ? `Switch port-isolation added successfully:\n\n${details}`
        : "Switch port-isolation addition completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_switch_port_isolation",
    title: "List Switch Port Isolation",
    annotations: READ,
    description: "Lists switch port-isolation entries on the MikroTik device.",
    inputSchema: {
      port_filter: z.string().optional().describe("Partial source-port match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing switch port-isolation entries");
      const filters: string[] = [];
      if (a.port_filter) filters.push(`port~"${a.port_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface ethernet switch port-isolation print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No switch port-isolation entries found matching the criteria."
        : `SWITCH PORT-ISOLATION:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_switch_port_isolation",
    title: "Get Switch Port Isolation",
    annotations: READ,
    description: "Gets a specific switch port-isolation entry by source port or '.id'.",
    inputSchema: {
      isolation_id: z.string().describe("Source port name (e.g. 'ether1') or RouterOS '.id'"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting switch port-isolation: isolation_id=${a.isolation_id}`);
      const result = await executeMikrotikCommand(
        `/interface ethernet switch port-isolation print detail where ${selectorFor(a.isolation_id)}`,
        ctx,
      );
      return isEmpty(result)
        ? `Switch port-isolation '${a.isolation_id}' not found.`
        : `SWITCH PORT-ISOLATION DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_switch_port_isolation",
    title: "Update Switch Port Isolation",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates a switch port-isolation entry (by source port or '.id'). " +
      'Pass comment="" to clear the comment.',
    inputSchema: {
      isolation_id: z.string().describe("Source port name or RouterOS '.id'"),
      forwarding_override_ports: z
        .string()
        .optional()
        .describe("Comma-separated allowed destination ports"),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating switch port-isolation: isolation_id=${a.isolation_id}`);
      const selector = selectorFor(a.isolation_id);
      const base = `/interface ethernet switch port-isolation set [find ${selector}]`;
      const cmd = new Cmd(base).opt("forwarding-override-ports", a.forwarding_override_ports);
      if (a.comment !== undefined) cmd.raw(`comment=${quoteValue(a.comment)}`);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result)) return `Failed to update switch port-isolation: ${result}`;
      const details = await executeMikrotikCommand(
        `/interface ethernet switch port-isolation print detail where ${selector}`,
        ctx,
      );
      return `Switch port-isolation updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_switch_port_isolation",
    title: "Remove Switch Port Isolation",
    annotations: DESTRUCTIVE,
    description:
      "Removes a switch port-isolation entry by source port or '.id' from the MikroTik device.",
    inputSchema: {
      isolation_id: z.string().describe("Source port name or RouterOS '.id'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing switch port-isolation: isolation_id=${a.isolation_id}`);
      const selector = selectorFor(a.isolation_id);
      const count = await executeMikrotikCommand(
        `/interface ethernet switch port-isolation print count-only where ${selector}`,
        ctx,
      );
      if (count.trim() === "0") return `Switch port-isolation '${a.isolation_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface ethernet switch port-isolation remove [find ${selector}]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove switch port-isolation: ${result}`;
      return `Switch port-isolation '${a.isolation_id}' removed successfully.`;
    },
  }),
];
