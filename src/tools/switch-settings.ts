/** Switch chip settings — `/interface ethernet switch`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const switchSettingsTools: ToolModule = [
  defineTool({
    name: "list_switches",
    title: "List Switches",
    annotations: READ,
    description:
      "Lists the hardware switch chips on the MikroTik device (`/interface ethernet switch`).",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial switch-name match"),
      type_filter: z.string().optional().describe("Partial switch-type match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing switches");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.type_filter) filters.push(`type~"${a.type_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface ethernet switch print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No switches found matching the criteria."
        : `SWITCHES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_switch",
    title: "Get Switch",
    annotations: READ,
    description:
      "Gets detailed settings for a specific switch chip by name or '.id'.",
    inputSchema: {
      switch_id: z
        .string()
        .describe("Switch name (e.g. 'switch1') or RouterOS '.id'"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting switch details: switch_id=${a.switch_id}`);
      let result = await executeMikrotikCommand(
        `/interface ethernet switch print detail where .id="${a.switch_id}"`,
        ctx,
      );
      if (isEmpty(result)) {
        result = await executeMikrotikCommand(
          `/interface ethernet switch print detail where name="${a.switch_id}"`,
          ctx,
        );
      }
      return isEmpty(result)
        ? `Switch '${a.switch_id}' not found.`
        : `SWITCH DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_switch",
    title: "Update Switch Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates settings for a switch chip on the MikroTik device.\n\n" +
      "Notes:\n" +
      "    cpu_flow_control: pause CPU-bound traffic when the CPU port is\n" +
      "        congested.\n" +
      "    mirror_source / mirror_target: span/mirror a port's traffic to a\n" +
      "        monitor port (or 'cpu'). Availability is chip-dependent.\n" +
      "    Pass mirror_source/mirror_target='none' to disable mirroring.",
    inputSchema: {
      switch_id: z
        .string()
        .describe("Switch name (e.g. 'switch1') or RouterOS '.id'"),
      name: z.string().optional().describe("Rename the switch"),
      cpu_flow_control: z.boolean().optional(),
      mirror_source: z
        .string()
        .optional()
        .describe("Source port to mirror, or 'none'"),
      mirror_target: z
        .string()
        .optional()
        .describe("Monitor port, 'cpu', or 'none'"),
      mirror_egress: z
        .string()
        .optional()
        .describe("Egress mirror source port (newer chips), or 'none'"),
    },
    async handler(a, ctx) {
      ctx.info(`Updating switch: switch_id=${a.switch_id}`);
      const selector = a.switch_id.startsWith("*")
        ? `.id="${a.switch_id}"`
        : `name="${a.switch_id}"`;
      const base = `/interface ethernet switch set [find ${selector}]`;
      const cmd = new Cmd(base)
        .opt("name", a.name)
        .bool("cpu-flow-control", a.cpu_flow_control)
        .opt("mirror-source", a.mirror_source)
        .opt("mirror-target", a.mirror_target)
        .opt("mirror-egress", a.mirror_egress);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result)) return `Failed to update switch: ${result}`;

      const detailSelector = a.name
        ? `name="${a.name}"`
        : selector;
      const details = await executeMikrotikCommand(
        `/interface ethernet switch print detail where ${detailSelector}`,
        ctx,
      );
      return `Switch updated successfully:\n\n${details}`;
    },
  }),
];
