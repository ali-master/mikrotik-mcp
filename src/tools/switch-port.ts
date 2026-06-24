/** Switch chip ports — `/interface ethernet switch port`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

const VlanMode = z.enum(["disabled", "optional", "enabled", "secure"]);
const VlanHeader = z.enum(["leave-as-is", "always-strip", "add-if-missing"]);

export const switchPortTools: ToolModule = [
  defineTool({
    name: "list_switch_ports",
    title: "List Switch Ports",
    annotations: READ,
    description:
      "Lists switch chip ports on the MikroTik device (`/interface ethernet switch port`).",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial port-name match"),
      switch_filter: z.string().optional().describe("Filter by owning switch, e.g. 'switch1'"),
    },
    async handler(a, ctx) {
      ctx.info("Listing switch ports");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.switch_filter) filters.push(`switch="${a.switch_filter}"`);

      const result = await executeMikrotikCommand(
        `/interface ethernet switch port print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No switch ports found matching the criteria."
        : `SWITCH PORTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_switch_port",
    title: "Get Switch Port",
    annotations: READ,
    description: "Gets detailed settings for a specific switch port by name or '.id'.",
    inputSchema: {
      port_id: z.string().describe("Port name (e.g. 'ether1') or RouterOS '.id'"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting switch port details: port_id=${a.port_id}`);
      let result = await executeMikrotikCommand(
        `/interface ethernet switch port print detail where .id="${a.port_id}"`,
        ctx,
      );
      if (isEmpty(result)) {
        result = await executeMikrotikCommand(
          `/interface ethernet switch port print detail where name="${a.port_id}"`,
          ctx,
        );
      }
      return isEmpty(result)
        ? `Switch port '${a.port_id}' not found.`
        : `SWITCH PORT DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_switch_port",
    title: "Update Switch Port",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates a switch port's hardware VLAN settings on the MikroTik device.\n\n" +
      "Notes:\n" +
      "    vlan_mode: 'disabled' (ignore VLAN table), 'optional', 'enabled', or\n" +
      "        'secure' (strict VLAN table enforcement).\n" +
      "    vlan_header: how the egress VLAN tag is handled — 'leave-as-is',\n" +
      "        'always-strip', or 'add-if-missing'.\n" +
      "    default_vlan_id: PVID for untagged ingress ('auto', 'none', or a number).",
    inputSchema: {
      port_id: z.string().describe("Port name (e.g. 'ether1') or RouterOS '.id'"),
      default_vlan_id: z.string().optional().describe("PVID: 'auto', 'none', or a VLAN id number"),
      vlan_mode: VlanMode.optional(),
      vlan_header: VlanHeader.optional(),
      force_vlan_id: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating switch port: port_id=${a.port_id}`);
      const selector = a.port_id.startsWith("*") ? `.id="${a.port_id}"` : `name="${a.port_id}"`;
      const base = `/interface ethernet switch port set [find ${selector}]`;
      const cmd = new Cmd(base)
        .opt("default-vlan-id", a.default_vlan_id)
        .opt("vlan-mode", a.vlan_mode)
        .opt("vlan-header", a.vlan_header)
        .bool("force-vlan-id", a.force_vlan_id);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result)) return `Failed to update switch port: ${result}`;

      const details = await executeMikrotikCommand(
        `/interface ethernet switch port print detail where ${selector}`,
        ctx,
      );
      return `Switch port updated successfully:\n\n${details}`;
    },
  }),
];
