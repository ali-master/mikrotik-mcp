/** IPv6 address/prefix pools — `/ipv6 pool`. */
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
import {
  whereClause,
  quoteValue,
  looksLikeError,
  isEmpty,
  Cmd,
} from "../core/routeros";

export const ipv6PoolTools: ToolModule = [
  defineTool({
    name: "create_ipv6_pool",
    title: "Create IPv6 Pool",
    annotations: WRITE,
    description:
      "Creates an IPv6 pool on the MikroTik device.\n\n" +
      "Notes:\n" +
      "    prefix: the overall block, e.g. '2001:db8::/48'.\n" +
      "    prefix_length: size of each delegation carved from the block, e.g.\n" +
      "        64. Must be longer than the pool prefix.",
    inputSchema: {
      name: z.string(),
      prefix: z.string().describe("Overall block, e.g. '2001:db8::/48'"),
      prefix_length: z
        .number()
        .int()
        .min(1)
        .max(128)
        .describe("Size of each carved delegation, e.g. 64"),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Creating IPv6 pool: name=${a.name}, prefix=${a.prefix}`);
      const cmd = new Cmd("/ipv6 pool add")
        .set("name", a.name)
        .set("prefix", a.prefix)
        .set("prefix-length", a.prefix_length)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to create IPv6 pool: ${result}`;
      const details = await executeMikrotikCommand(
        `/ipv6 pool print detail where name="${a.name}"`,
        ctx,
      );
      return `IPv6 pool created successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "list_ipv6_pools",
    title: "List IPv6 Pools",
    annotations: READ,
    description: "Lists IPv6 pools on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      prefix_filter: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPv6 pools");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.prefix_filter) filters.push(`prefix~"${a.prefix_filter}"`);

      const result = await executeMikrotikCommand(
        `/ipv6 pool print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No IPv6 pools found matching the criteria."
        : `IPV6 POOLS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipv6_pool",
    title: "Get IPv6 Pool",
    annotations: READ,
    description: "Gets detailed information about a specific IPv6 pool.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting IPv6 pool details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ipv6 pool print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `IPv6 pool '${a.name}' not found.`
        : `IPV6 POOL DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "list_ipv6_pool_used",
    title: "List IPv6 Pool Usage",
    annotations: READ,
    description:
      "Lists the currently delegated prefixes taken from IPv6 pools (`/ipv6 pool used`).",
    inputSchema: {
      pool_filter: z.string().optional().describe("Partial pool-name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPv6 pool usage");
      const filters: string[] = [];
      if (a.pool_filter) filters.push(`pool~"${a.pool_filter}"`);

      const result = await executeMikrotikCommand(
        `/ipv6 pool used print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No IPv6 pool usage found matching the criteria."
        : `IPV6 POOL USAGE:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_ipv6_pool",
    title: "Update IPv6 Pool",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates an existing IPv6 pool on the MikroTik device. " +
      'Pass comment="" to clear the comment.',
    inputSchema: {
      name: z.string(),
      new_name: z.string().optional(),
      prefix: z.string().optional(),
      prefix_length: z.number().int().min(1).max(128).optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating IPv6 pool: name=${a.name}`);
      const base = `/ipv6 pool set [find name="${a.name}"]`;
      const cmd = new Cmd(base);
      if (a.new_name) cmd.set("name", a.new_name);
      if (a.prefix) cmd.set("prefix", a.prefix);
      if (a.prefix_length !== undefined)
        cmd.set("prefix-length", a.prefix_length);
      if (a.comment !== undefined) cmd.raw(`comment=${quoteValue(a.comment)}`);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result))
        return `Failed to update IPv6 pool: ${result}`;
      const details = await executeMikrotikCommand(
        `/ipv6 pool print detail where name="${a.new_name || a.name}"`,
        ctx,
      );
      return `IPv6 pool updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_ipv6_pool",
    title: "Remove IPv6 Pool",
    annotations: DESTRUCTIVE,
    description: "Removes an IPv6 pool from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing IPv6 pool: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/ipv6 pool print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `IPv6 pool '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/ipv6 pool remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result))
        return `Failed to remove IPv6 pool: ${result}`;
      return `IPv6 pool '${a.name}' removed successfully.`;
    },
  }),
];
