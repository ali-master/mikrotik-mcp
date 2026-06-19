/** IP addresses — `/ip address`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const ipAddressTools: ToolModule = [
  defineTool({
    name: "add_ip_address",
    title: "Add IP Address",
    annotations: WRITE,
    description: "Adds an IP address to an interface on the MikroTik device.",
    inputSchema: {
      address: z.string().describe("Address with CIDR, e.g. '192.168.1.1/24'"),
      interface: z.string(),
      network: z.string().optional(),
      broadcast: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Adding IP address: address=${a.address}, interface=${a.interface}`,
      );
      const cmd = new Cmd("/ip address add")
        .set("address", a.address)
        .set("interface", a.interface)
        .opt("network", a.network)
        .opt("broadcast", a.broadcast)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add IP address: ${result}`;
      const details = await executeMikrotikCommand(
        `/ip address print detail where address="${a.address}"`,
        ctx,
      );
      return `IP address added successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "list_ip_addresses",
    title: "List IP Addresses",
    annotations: READ,
    description: "Lists IP addresses on the MikroTik device.",
    inputSchema: {
      interface_filter: z.string().optional(),
      address_filter: z.string().optional(),
      network_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      dynamic_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info("Listing IP addresses");
      const filters: string[] = [];
      if (a.interface_filter) filters.push(`interface="${a.interface_filter}"`);
      if (a.address_filter) filters.push(`address~"${a.address_filter}"`);
      if (a.network_filter) filters.push(`network="${a.network_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.dynamic_only) filters.push("dynamic=yes");

      const result = await executeMikrotikCommand(
        `/ip address print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No IP addresses found matching the criteria."
        : `IP ADDRESSES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ip_address",
    title: "Get IP Address",
    annotations: READ,
    description:
      "Gets detailed information about a specific IP address by ID or address value.",
    inputSchema: {
      address_id: z
        .string()
        .describe("RouterOS .id (e.g. '*1') or the address value"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting IP address details: address_id=${a.address_id}`);
      let result = await executeMikrotikCommand(
        `/ip address print detail where .id="${a.address_id}"`,
        ctx,
      );
      if (isEmpty(result)) {
        result = await executeMikrotikCommand(
          `/ip address print detail where address="${a.address_id}"`,
          ctx,
        );
      }
      return isEmpty(result)
        ? `IP address '${a.address_id}' not found.`
        : `IP ADDRESS DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_ip_address",
    title: "Remove IP Address",
    annotations: DESTRUCTIVE,
    description:
      "Removes an IP address from the MikroTik device by ID or address value.",
    inputSchema: { address_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing IP address: address_id=${a.address_id}`);
      let byId = true;
      let count = await executeMikrotikCommand(
        `/ip address print count-only where .id="${a.address_id}"`,
        ctx,
      );
      if (count.trim() === "0") {
        byId = false;
        count = await executeMikrotikCommand(
          `/ip address print count-only where address="${a.address_id}"`,
          ctx,
        );
        if (count.trim() === "0")
          return `IP address '${a.address_id}' not found.`;
      }
      const selector = byId
        ? `.id="${a.address_id}"`
        : `address="${a.address_id}"`;
      const result = await executeMikrotikCommand(
        `/ip address remove [find ${selector}]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove IP address: ${result}`;
      return `IP address '${a.address_id}' removed successfully.`;
    },
  }),
];
