/**
 * IPv6 firewall address-lists — `/ipv6 firewall address-list`.
 *
 * Named groups of IPv6 addresses/prefixes referenced by IPv6 firewall rules.
 * Entries can be static or dynamically populated (e.g. by rules with
 * action=add-src-to-address-list).
 */
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

export const ipv6FirewallAddressListTools: ToolModule = [
  defineTool({
    name: "add_ipv6_address_list_entry",
    title: "Add IPv6 Address-List Entry",
    annotations: WRITE,
    description:
      "Adds an IPv6 address/prefix to an IPv6 firewall address-list.",
    inputSchema: {
      list: z.string().describe("Address-list name"),
      address: z
        .string()
        .describe(
          "IPv6 address or prefix to add, e.g. '2001:db8::1' or '2001:db8::/32'",
        ),
      timeout: z
        .string()
        .optional()
        .describe("Auto-remove timeout, e.g. '1d00:00:00'"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding ${a.address} to IPv6 address-list '${a.list}'`);
      const cmd = new Cmd("/ipv6 firewall address-list add")
        .set("list", a.list)
        .set("address", a.address)
        .opt("timeout", a.timeout)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to add IPv6 address-list entry: ${result}`;

      const details = await executeMikrotikCommand(
        `/ipv6 firewall address-list print detail where list="${a.list}" address="${a.address}"`,
        ctx,
      );
      return details.trim()
        ? `IPv6 address-list entry added successfully:\n\n${details}`
        : "IPv6 address-list entry added but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ipv6_address_lists",
    title: "List IPv6 Address-Lists",
    annotations: READ,
    description:
      "Lists IPv6 firewall address-list entries with optional filters.",
    inputSchema: {
      list_filter: z.string().optional().describe("Partial list-name match"),
      address_filter: z.string().optional().describe("Partial address match"),
      dynamic_only: z
        .boolean()
        .default(false)
        .describe("Only show dynamically-added entries"),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPv6 address-list entries");
      const filters: string[] = [];
      if (a.list_filter) filters.push(`list~"${a.list_filter}"`);
      if (a.address_filter) filters.push(`address~"${a.address_filter}"`);
      if (a.dynamic_only) filters.push("dynamic=yes");
      const result = await executeMikrotikCommand(
        `/ipv6 firewall address-list print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No IPv6 address-list entries found matching the criteria."
        : `IPV6 FIREWALL ADDRESS-LISTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipv6_address_list_entry",
    title: "Get IPv6 Address-List Entry",
    annotations: READ,
    description:
      "Gets detailed information about a specific IPv6 address-list entry by its internal id.",
    inputSchema: {
      entry_id: z.string().describe("Internal entry id, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Getting IPv6 address-list entry ${a.entry_id}`);
      const result = await executeMikrotikCommand(
        `/ipv6 firewall address-list print detail where .id="${a.entry_id}"`,
        ctx,
      );
      return isEmpty(result)
        ? `IPv6 address-list entry '${a.entry_id}' not found.`
        : `IPV6 ADDRESS-LIST ENTRY DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_ipv6_address_list_entry",
    title: "Remove IPv6 Address-List Entry",
    annotations: DESTRUCTIVE,
    description: "Removes an IPv6 address-list entry by its internal id.",
    inputSchema: {
      entry_id: z.string().describe("Internal entry id, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing IPv6 address-list entry ${a.entry_id}`);
      const count = await executeMikrotikCommand(
        `/ipv6 firewall address-list print count-only where .id="${a.entry_id}"`,
        ctx,
      );
      if (count.trim() === "0")
        return `IPv6 address-list entry '${a.entry_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/ipv6 firewall address-list remove [find .id="${a.entry_id}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove IPv6 address-list entry: ${result}`;
      return `IPv6 address-list entry '${a.entry_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_ipv6_address_list_entry",
    title: "Enable IPv6 Address-List Entry",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables an IPv6 address-list entry by its internal id.",
    inputSchema: {
      entry_id: z.string().describe("Internal entry id, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Enabling IPv6 address-list entry ${a.entry_id}`);
      const result = await executeMikrotikCommand(
        `/ipv6 firewall address-list enable [find .id="${a.entry_id}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to enable IPv6 address-list entry: ${result}`;
      return `IPv6 address-list entry '${a.entry_id}' enabled.`;
    },
  }),

  defineTool({
    name: "disable_ipv6_address_list_entry",
    title: "Disable IPv6 Address-List Entry",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables an IPv6 address-list entry by its internal id.",
    inputSchema: {
      entry_id: z.string().describe("Internal entry id, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Disabling IPv6 address-list entry ${a.entry_id}`);
      const result = await executeMikrotikCommand(
        `/ipv6 firewall address-list disable [find .id="${a.entry_id}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to disable IPv6 address-list entry: ${result}`;
      return `IPv6 address-list entry '${a.entry_id}' disabled.`;
    },
  }),
];
