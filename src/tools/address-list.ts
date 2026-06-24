/**
 * Firewall address-lists — `/ip firewall address-list`.
 *
 * Named groups of addresses referenced by firewall rules. Entries can be
 * static or dynamically populated (e.g. by rules with action=add-to-list).
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const addressListTools: ToolModule = [
  defineTool({
    name: "add_address_list_entry",
    title: "Add Address-List Entry",
    annotations: WRITE,
    description: "Adds an address to a firewall address-list.",
    inputSchema: {
      list: z.string().describe("Address-list name"),
      address: z.string().describe("Address or subnet to add, e.g. '10.0.0.1' or '10.0.0.0/24'"),
      timeout: z.string().optional().describe("Auto-remove timeout, e.g. '1d00:00:00'"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding ${a.address} to address-list '${a.list}'`);
      const cmd = new Cmd("/ip firewall address-list add")
        .set("list", a.list)
        .set("address", a.address)
        .opt("timeout", a.timeout)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add address-list entry: ${result}`;

      const details = await executeMikrotikCommand(
        `/ip firewall address-list print detail where list="${a.list}" address="${a.address}"`,
        ctx,
      );
      return details.trim()
        ? `Address-list entry added successfully:\n\n${details}`
        : "Address-list entry added but unable to verify.";
    },
  }),

  defineTool({
    name: "list_address_lists",
    title: "List Address-Lists",
    annotations: READ,
    description: "Lists firewall address-list entries with optional filters.",
    inputSchema: {
      list_filter: z.string().optional().describe("Partial list-name match"),
      address_filter: z.string().optional().describe("Partial address match"),
      dynamic_only: z.boolean().default(false).describe("Only show dynamically-added entries"),
    },
    async handler(a, ctx) {
      ctx.info("Listing address-list entries");
      const filters: string[] = [];
      if (a.list_filter) filters.push(`list~"${a.list_filter}"`);
      if (a.address_filter) filters.push(`address~"${a.address_filter}"`);
      if (a.dynamic_only) filters.push("dynamic=yes");
      const result = await executeMikrotikCommand(
        `/ip firewall address-list print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No address-list entries found matching the criteria."
        : `FIREWALL ADDRESS-LISTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_address_list_entry",
    title: "Get Address-List Entry",
    annotations: READ,
    description:
      "Gets detailed information about a specific address-list entry by its internal id.",
    inputSchema: {
      entry_id: z.string().describe("Internal entry id, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting address-list entry ${a.entry_id}`);
      const result = await executeMikrotikCommand(
        `/ip firewall address-list print detail where .id="${a.entry_id}"`,
        ctx,
      );
      return isEmpty(result)
        ? `Address-list entry '${a.entry_id}' not found.`
        : `ADDRESS-LIST ENTRY DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_address_list_entry",
    title: "Remove Address-List Entry",
    annotations: DESTRUCTIVE,
    description: "Removes an address-list entry by its internal id.",
    inputSchema: {
      entry_id: z.string().describe("Internal entry id, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing address-list entry ${a.entry_id}`);
      const count = await executeMikrotikCommand(
        `/ip firewall address-list print count-only where .id="${a.entry_id}"`,
        ctx,
      );
      if (count.trim() === "0") return `Address-list entry '${a.entry_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/ip firewall address-list remove [find .id="${a.entry_id}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove address-list entry: ${result}`;
      return `Address-list entry '${a.entry_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_address_list_entry",
    title: "Enable Address-List Entry",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables an address-list entry by its internal id.",
    inputSchema: {
      entry_id: z.string().describe("Internal entry id, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Enabling address-list entry ${a.entry_id}`);
      const result = await executeMikrotikCommand(
        `/ip firewall address-list enable [find .id="${a.entry_id}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to enable address-list entry: ${result}`;
      return `Address-list entry '${a.entry_id}' enabled.`;
    },
  }),

  defineTool({
    name: "disable_address_list_entry",
    title: "Disable Address-List Entry",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables an address-list entry by its internal id.",
    inputSchema: {
      entry_id: z.string().describe("Internal entry id, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Disabling address-list entry ${a.entry_id}`);
      const result = await executeMikrotikCommand(
        `/ip firewall address-list disable [find .id="${a.entry_id}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to disable address-list entry: ${result}`;
      return `Address-list entry '${a.entry_id}' disabled.`;
    },
  }),
];
