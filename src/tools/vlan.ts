/**
 * VLAN interfaces — `/interface vlan`.
 *
 * This module is the canonical example of the tool-module pattern every other
 * scope follows: a flat array of `defineTool(...)` declarations, each with a Zod
 * input schema, a risk preset, and a handler that builds a RouterOS command via
 * `Cmd` and runs it through `executeMikrotikCommand`.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

const ArpMode = z.enum(["enabled", "disabled", "proxy-arp", "reply-only"]);

export const vlanTools: ToolModule = [
  defineTool({
    name: "create_vlan_interface",
    title: "Create VLAN",
    annotations: WRITE,
    description:
      "Creates a VLAN interface on the MikroTik device with the given VLAN ID and parent interface.",
    inputSchema: {
      name: z.string().describe("Name for the new VLAN interface, e.g. 'vlan100'"),
      vlan_id: z.number().int().min(1).max(4094).describe("802.1Q VLAN ID (1-4094)"),
      interface: z.string().describe("Parent interface, e.g. 'ether1' or 'bridge'"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
      mtu: z.number().int().optional(),
      use_service_tag: z.boolean().default(false).describe("Use 802.1ad service tag (QinQ)"),
      arp: ArpMode.default("enabled"),
      arp_timeout: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(
        `Creating VLAN interface: name=${a.name}, vlan_id=${a.vlan_id}, interface=${a.interface}`,
      );
      const cmd = new Cmd("/interface vlan add")
        .set("name", a.name)
        .set("vlan-id", a.vlan_id)
        .set("interface", a.interface)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .opt("mtu", a.mtu)
        .flag("use-service-tag", a.use_service_tag)
        .raw(a.arp !== "enabled" ? `arp=${a.arp}` : null)
        .opt("arp-timeout", a.arp_timeout)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create VLAN interface: ${result}`;

      const details = await executeMikrotikCommand(
        `/interface vlan print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `VLAN interface created successfully:\n\n${details}`
        : "VLAN interface creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_vlan_interfaces",
    title: "List VLANs",
    annotations: READ,
    description: "Lists VLAN interfaces on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
      vlan_id_filter: z.number().int().optional(),
      interface_filter: z.string().optional().describe("Exact parent interface name"),
      disabled_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing VLAN interfaces");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.vlan_id_filter !== undefined) filters.push(`vlan-id=${a.vlan_id_filter}`);
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");

      const result = await executeMikrotikCommand(
        `/interface vlan print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No VLAN interfaces found matching the criteria."
        : `VLAN INTERFACES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_vlan_interface",
    title: "Get VLAN",
    annotations: READ,
    description: "Gets detailed information about a specific VLAN interface.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting VLAN interface details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/interface vlan print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `VLAN interface '${a.name}' not found.`
        : `VLAN INTERFACE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_vlan_interface",
    title: "Update VLAN",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates an existing VLAN interface's settings on the MikroTik device.",
    inputSchema: {
      name: z.string().describe("Current name of the VLAN interface to update"),
      new_name: z.string().optional(),
      vlan_id: z.number().int().min(1).max(4094).optional(),
      interface: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
      mtu: z.number().int().optional(),
      use_service_tag: z.boolean().optional(),
      arp: ArpMode.optional(),
      arp_timeout: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating VLAN interface: name=${a.name}`);
      const cmd = new Cmd(`/interface vlan set [find name="${a.name}"]`)
        .opt("name", a.new_name)
        .opt("vlan-id", a.vlan_id)
        .opt("interface", a.interface)
        .opt("comment", a.comment)
        .bool("disabled", a.disabled)
        .opt("mtu", a.mtu)
        .bool("use-service-tag", a.use_service_tag)
        .opt("arp", a.arp)
        .opt("arp-timeout", a.arp_timeout)
        .build();

      // No updates were supplied -> the command would just be the `set [find ...]` stem.
      if (!cmd.includes("=", cmd.indexOf("]"))) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update VLAN interface: ${result}`;

      const target = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(
        `/interface vlan print detail where name="${target}"`,
        ctx,
      );
      return `VLAN interface updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_vlan_interface",
    title: "Remove VLAN",
    annotations: DESTRUCTIVE,
    description: "Removes a VLAN interface from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing VLAN interface: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/interface vlan print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `VLAN interface '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/interface vlan remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove VLAN interface: ${result}`;
      return `VLAN interface '${a.name}' removed successfully.`;
    },
  }),
];
