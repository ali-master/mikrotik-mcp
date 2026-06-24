/** IP address pools — `/ip pool`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, quoteValue, looksLikeError, isEmpty, Cmd } from "../core/routeros";

interface UpdatePoolArgs {
  name: string;
  new_name?: string;
  ranges?: string;
  next_pool?: string;
  comment?: string;
}

/** Shared `update_ip_pool` body, reused by `expand_ip_pool`. */
async function updatePool(
  a: UpdatePoolArgs,
  ctx: Parameters<typeof executeMikrotikCommand>[1],
): Promise<string> {
  ctx.info(`Updating IP pool: name=${a.name}`);
  const base = `/ip pool set [find name="${a.name}"]`;
  const cmd = new Cmd(base);
  if (a.new_name) cmd.set("name", a.new_name);
  if (a.ranges) cmd.set("ranges", a.ranges);
  if (a.next_pool !== undefined) {
    cmd.raw(a.next_pool === "" ? "!next-pool" : `next-pool=${quoteValue(a.next_pool)}`);
  }
  if (a.comment !== undefined) cmd.raw(`comment=${quoteValue(a.comment)}`);

  const built = cmd.build();
  if (built === base) return "No updates specified.";

  const result = await executeMikrotikCommand(built, ctx);
  if (looksLikeError(result)) return `Failed to update IP pool: ${result}`;

  const detailsName = a.new_name || a.name;
  const details = await executeMikrotikCommand(
    `/ip pool print detail where name="${detailsName}"`,
    ctx,
  );
  return `IP pool updated successfully:\n\n${details}`;
}

export const ipPoolTools: ToolModule = [
  defineTool({
    name: "create_ip_pool",
    title: "Add IP Pool",
    annotations: WRITE,
    description: "Creates an IP pool with the given address ranges on the MikroTik device.",
    inputSchema: {
      name: z.string(),
      ranges: z
        .string()
        .describe(
          'Hyphen-separated range(s) e.g. "192.168.1.1-192.168.1.100". Multiple ranges comma-separated: "10.0.0.1-10.0.0.50,10.0.0.100-10.0.0.120"',
        ),
      next_pool: z.string().optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Creating IP pool: name=${a.name}, ranges=${a.ranges}`);
      const cmd = new Cmd("/ip pool add")
        .set("name", a.name)
        .set("ranges", a.ranges)
        .opt("next-pool", a.next_pool)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      const t = result.trim();
      if (t) {
        if (t.includes("*") || /^\d+$/.test(t)) {
          const details = await executeMikrotikCommand(
            `/ip pool print detail where name="${a.name}"`,
            ctx,
          );
          return details.trim()
            ? `IP pool created successfully:\n\n${details}`
            : `IP pool created with ID: ${result}`;
        }
        return `Failed to create IP pool: ${result}`;
      }
      const details = await executeMikrotikCommand(
        `/ip pool print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `IP pool created successfully:\n\n${details}`
        : "IP pool creation completed but unable to verify.";
    },
  }),

  defineTool({
    name: "list_ip_pools",
    title: "List IP Pools",
    annotations: READ,
    description: "Lists IP pools on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional(),
      ranges_filter: z.string().optional(),
      include_used: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Listing IP pools with filters: name=${a.name_filter}, ranges=${a.ranges_filter}`);
      let cmd = "/ip pool print";
      if (a.include_used) cmd += " detail";

      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.ranges_filter) filters.push(`ranges~"${a.ranges_filter}"`);
      cmd += whereClause(filters);

      const result = await executeMikrotikCommand(cmd, ctx);
      if (isEmpty(result)) return "No IP pools found matching the criteria.";

      if (a.include_used) {
        const resultLines = result.trim().split("\n");
        const outputLines: string[] = [];
        for (const line of resultLines) {
          outputLines.push(line);
          if (line.includes("name=")) {
            const nameStart = line.indexOf('name="') + 6;
            const nameEnd = line.indexOf('"', nameStart);
            if (nameStart > 5 && nameEnd > nameStart) {
              const poolName = line.slice(nameStart, nameEnd);
              const usedCount = await executeMikrotikCommand(
                `/ip pool used print count-only where pool="${poolName}"`,
                ctx,
              );
              if (/^\d+$/.test(usedCount.trim()))
                outputLines.push(`      used-addresses=${usedCount.trim()}`);
            }
          }
        }
        return `IP POOLS:\n\n${outputLines.join("\n")}`;
      }

      return `IP POOLS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ip_pool",
    title: "Get IP Pool",
    annotations: READ,
    description: "Gets detailed information about a specific IP pool including used address count.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting IP pool details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ip pool print detail where name="${a.name}"`,
        ctx,
      );
      if (isEmpty(result)) return `IP pool '${a.name}' not found.`;

      const usedCount = await executeMikrotikCommand(
        `/ip pool used print count-only where pool="${a.name}"`,
        ctx,
      );
      if (/^\d+$/.test(usedCount.trim())) {
        return `IP POOL DETAILS:\n\n${result}\n      used-addresses=${usedCount.trim()}`;
      }
      return `IP POOL DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_ip_pool",
    title: "Update IP Pool",
    annotations: WRITE_IDEMPOTENT,
    description:
      'Updates an existing IP pool\'s name, ranges, or next-pool reference. Pass "" for next_pool to clear it.',
    inputSchema: {
      name: z.string(),
      new_name: z.string().optional(),
      ranges: z
        .string()
        .optional()
        .describe(
          'Hyphen-separated range(s) e.g. "192.168.1.1-192.168.1.100". Multiple ranges comma-separated: "10.0.0.1-10.0.0.50,10.0.0.100-10.0.0.120"',
        ),
      next_pool: z.string().optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      return updatePool(a, ctx);
    },
  }),

  defineTool({
    name: "remove_ip_pool",
    title: "Remove IP Pool",
    annotations: DESTRUCTIVE,
    description: "Removes an IP pool from the MikroTik device (fails if pool is in use).",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing IP pool: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/ip pool print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `IP pool '${a.name}' not found.`;

      const usedCount = await executeMikrotikCommand(
        `/ip pool used print count-only where pool="${a.name}"`,
        ctx,
      );
      if (usedCount.trim() !== "0") {
        return `Cannot remove IP pool '${a.name}': ${usedCount.trim()} addresses are currently in use.`;
      }

      const dhcpCount = await executeMikrotikCommand(
        `/ip dhcp-server print count-only where address-pool="${a.name}"`,
        ctx,
      );
      if (dhcpCount.trim() !== "0") {
        return `Cannot remove IP pool '${a.name}': It is used by ${dhcpCount.trim()} DHCP server(s).`;
      }

      const result = await executeMikrotikCommand(`/ip pool remove [find name="${a.name}"]`, ctx);
      if (looksLikeError(result)) return `Failed to remove IP pool: ${result}`;
      return `IP pool '${a.name}' removed successfully.`;
    },
  }),

  defineTool({
    name: "list_ip_pool_used",
    title: "List IP Pool Used",
    annotations: READ,
    description: "Lists currently used (allocated) addresses from IP pools.",
    inputSchema: {
      pool_name: z.string().optional(),
      address_filter: z.string().optional(),
      mac_filter: z.string().optional(),
      info_filter: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Listing used IP pool addresses: pool=${a.pool_name}, address=${a.address_filter}`);
      const filters: string[] = [];
      if (a.pool_name) filters.push(`pool="${a.pool_name}"`);
      if (a.address_filter) filters.push(`address~"${a.address_filter}"`);
      if (a.mac_filter) filters.push(`mac-address~"${a.mac_filter}"`);
      if (a.info_filter) filters.push(`info~"${a.info_filter}"`);

      const result = await executeMikrotikCommand(
        `/ip pool used print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result)
        ? "No used addresses found matching the criteria."
        : `USED IP POOL ADDRESSES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "expand_ip_pool",
    title: "Expand IP Pool",
    annotations: WRITE_IDEMPOTENT,
    description: "Expands an existing IP pool by appending additional address ranges.",
    inputSchema: {
      name: z.string(),
      additional_ranges: z
        .string()
        .describe(
          'Hyphen-separated range(s) e.g. "192.168.1.101-192.168.1.150". Multiple ranges comma-separated: "10.0.0.51-10.0.0.60,10.0.0.70-10.0.0.80"',
        ),
    },
    async handler(a, ctx) {
      ctx.info(`Expanding IP pool: name=${a.name}, additional_ranges=${a.additional_ranges}`);
      const current = await executeMikrotikCommand(
        `/ip pool print detail where name="${a.name}"`,
        ctx,
      );
      if (!current || current.includes("no such item")) return `IP pool '${a.name}' not found.`;

      const match = current.match(/ranges=(\S+)/);
      if (!match) return "Unable to determine current ranges.";

      const newRanges = `${match[1]},${a.additional_ranges}`;
      return updatePool({ name: a.name, ranges: newRanges }, ctx);
    },
  }),
];
