/** Power over Ethernet — `/interface ethernet poe`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import type { ToolModule } from "../core/registry";
import { READ, defineTool } from "../core/registry";
import { looksLikeError, isEmpty, commandUnsupported } from "../core/routeros";

/**
 * Devices without PoE-out hardware have no `/interface ethernet poe` menu, so
 * RouterOS answers with `bad command name poe`. Treat that as "no PoE hardware"
 * rather than wrapping the parser error in a success message.
 */
const NO_POE =
  "This device does not have PoE-out hardware — the /interface ethernet poe menu is not available.";

export const poeTools: ToolModule = [
  defineTool({
    name: "get_poe_monitor",
    title: "PoE Monitor",
    annotations: READ,
    description:
      "Reads real-time Power-over-Ethernet (PoE) monitor data for one or more ethernet interfaces — PoE-out status, voltage, current, and power. Runs `/interface ethernet poe monitor <interfaces> once`.",
    inputSchema: {
      interfaces: z
        .string()
        .describe("Comma-separated ethernet interface name(s), e.g. 'ether1' or 'ether9,ether10'"),
    },
    async handler(a, ctx) {
      ctx.info(`Reading PoE monitor for: ${a.interfaces}`);
      // `once` is required — without it the monitor streams forever and hangs the session.
      const result = await executeMikrotikCommand(
        `/interface ethernet poe monitor ${a.interfaces} once`,
        ctx,
      );
      if (commandUnsupported(result)) return NO_POE;
      if (looksLikeError(result)) return `Failed to read PoE monitor: ${result}`;
      if (isEmpty(result)) {
        return `No PoE monitor data returned for: ${a.interfaces}. The interface(s) may not exist or may not support PoE-out.`;
      }
      return `POE MONITOR:\n\n${result}`;
    },
  }),

  defineTool({
    name: "list_poe",
    title: "List PoE",
    annotations: READ,
    description:
      "Lists the Power-over-Ethernet (PoE) configuration of PoE-capable ethernet interfaces (PoE-out mode, priority). Runs `/interface ethernet poe print`.",
    inputSchema: {
      interface_filter: z.string().optional().describe("Partial name match, e.g. 'ether'"),
    },
    async handler(a, ctx) {
      ctx.info("Listing PoE configuration");
      let cmd = "/interface ethernet poe print";
      if (a.interface_filter) cmd += ` where name~"${a.interface_filter}"`;
      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return NO_POE;
      if (looksLikeError(result)) return `Failed to list PoE configuration: ${result}`;
      if (isEmpty(result)) return "No PoE-capable ethernet interfaces found on this device.";
      return `POE CONFIGURATION:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_poe_settings",
    title: "PoE Settings",
    annotations: READ,
    description:
      "Gets the detailed PoE-out settings of a specific ethernet interface (mode, priority, voltage, thresholds). Runs `/interface ethernet poe print detail where name=<name>`.",
    inputSchema: {
      name: z.string().describe("Exact ethernet interface name, e.g. 'ether1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting PoE settings for: ${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface ethernet poe print detail where name="${a.name}"`,
        ctx,
      );
      if (commandUnsupported(result)) return NO_POE;
      if (looksLikeError(result)) return `Failed to get PoE settings: ${result}`;
      if (isEmpty(result)) return `No PoE settings found for interface '${a.name}'.`;
      return `POE SETTINGS:\n\n${result}`;
    },
  }),
];
