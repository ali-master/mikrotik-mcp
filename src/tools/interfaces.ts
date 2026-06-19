/** Generic interfaces — `/interface`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT,  READ, defineTool } from "../core/registry";
import type {ToolModule} from "../core/registry";
import { whereClause, looksLikeError, isEmpty } from "../core/routeros";

const InterfaceType = z.enum([
  "ether",
  "wg",
  "bridge",
  "vlan",
  "pppoe-out",
  "pppoe-server",
  "wifi",
  "wireless",
  "lte",
  "loopback",
  "sfp",
  "sfp-sfpplus",
]);

async function verify(name: string, ctx: Parameters<typeof executeMikrotikCommand>[1]) {
  return executeMikrotikCommand(`/interface print detail where name="${name}"`, ctx);
}

export const interfaceTools: ToolModule = [
  defineTool({
    name: "list_interfaces",
    title: "List Interfaces",
    annotations: READ,
    description:
      "Lists all interfaces on the MikroTik device (ethernet, bridge, WireGuard, PPPoE, VLAN, WiFi, SFP, LTE, loopback, and any other type).",
    inputSchema: {
      type_filter: InterfaceType.optional().describe("RouterOS interface type, e.g. 'ether', 'bridge'"),
      name_filter: z.string().optional().describe("Partial name match, e.g. 'ether'"),
      running_only: z.boolean().default(false),
      disabled_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing all interfaces");
      const filters: string[] = [];
      if (a.type_filter) filters.push(`type="${a.type_filter}"`);
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.running_only) filters.push("running=yes");
      if (a.disabled_only) filters.push("disabled=yes");

      const result = await executeMikrotikCommand(`/interface print${whereClause(filters)}`, ctx);
      return isEmpty(result) ? "No interfaces found matching the criteria." : `INTERFACES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_interface",
    title: "Get Interface",
    annotations: READ,
    description: "Gets detailed information about a specific interface by name.",
    inputSchema: { name: z.string().describe("Exact interface name, e.g. 'ether1', 'wg0'") },
    async handler(a, ctx) {
      ctx.info(`Getting interface details: name=${a.name}`);
      const result = await verify(a.name, ctx);
      return isEmpty(result) ? `Interface '${a.name}' not found.` : `INTERFACE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "enable_interface",
    title: "Enable Interface",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables an interface on the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Enabling interface: name=${a.name}`);
      const result = await executeMikrotikCommand(`/interface enable [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to enable interface '${a.name}': ${result}`;
      const details = await verify(a.name, ctx);
      return isEmpty(details) ? `Interface '${a.name}' not found.` : `Interface '${a.name}' enabled successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "disable_interface",
    title: "Disable Interface",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables an interface on the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Disabling interface: name=${a.name}`);
      const result = await executeMikrotikCommand(`/interface disable [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to disable interface '${a.name}': ${result}`;
      const details = await verify(a.name, ctx);
      return isEmpty(details) ? `Interface '${a.name}' not found.` : `Interface '${a.name}' disabled successfully:\n\n${details}`;
    },
  }),
];
