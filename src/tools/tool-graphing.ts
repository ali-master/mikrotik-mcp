/** Graphing — `/tool graphing` (interface / queue / resource graph rules). */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

const Kind = z.enum(["interface", "queue", "resource"]);

export const graphingTools: ToolModule = [
  defineTool({
    name: "add_graphing_interface",
    title: "Add Interface Graphing",
    annotations: WRITE,
    description:
      "Adds an interface graphing rule so the device records traffic graphs " +
      "for an interface (`/tool graphing interface`).",
    inputSchema: {
      interface: z.string().default("all").describe("Interface to graph, or 'all'"),
      allow_address: z
        .string()
        .optional()
        .describe("Subnet allowed to view the graphs, e.g. '0.0.0.0/0'"),
      store_on_disk: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Adding interface graphing: interface=${a.interface}`);
      const cmd = new Cmd("/tool graphing interface add")
        .set("interface", a.interface)
        .opt("allow-address", a.allow_address)
        .bool("store-on-disk", a.store_on_disk)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add interface graphing: ${result}`;
      return `Interface graphing rule added for '${a.interface}'.`;
    },
  }),

  defineTool({
    name: "add_graphing_queue",
    title: "Add Queue Graphing",
    annotations: WRITE,
    description: "Adds a simple-queue graphing rule (`/tool graphing queue`).",
    inputSchema: {
      simple_queue: z.string().default("all").describe("Simple queue to graph, or 'all'"),
      allow_address: z.string().optional(),
      store_on_disk: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Adding queue graphing: simple_queue=${a.simple_queue}`);
      const cmd = new Cmd("/tool graphing queue add")
        .set("simple-queue", a.simple_queue)
        .opt("allow-address", a.allow_address)
        .bool("store-on-disk", a.store_on_disk)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add queue graphing: ${result}`;
      return `Queue graphing rule added for '${a.simple_queue}'.`;
    },
  }),

  defineTool({
    name: "add_graphing_resource",
    title: "Add Resource Graphing",
    annotations: WRITE,
    description:
      "Adds a system-resource graphing rule (CPU, memory, disk) " + "(`/tool graphing resource`).",
    inputSchema: {
      allow_address: z.string().optional(),
      store_on_disk: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Adding resource graphing");
      const cmd = new Cmd("/tool graphing resource add")
        .opt("allow-address", a.allow_address)
        .bool("store-on-disk", a.store_on_disk)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to add resource graphing: ${result}`;
      return "Resource graphing rule added.";
    },
  }),

  defineTool({
    name: "list_graphing",
    title: "List Graphing Rules",
    annotations: READ,
    description: "Lists graphing rules of the given kind (interface, queue or resource).",
    inputSchema: {
      kind: Kind.describe("Which graphing table to list"),
    },
    async handler(a, ctx) {
      ctx.info(`Listing ${a.kind} graphing rules`);
      const result = await executeMikrotikCommand(
        `/tool graphing ${a.kind} print${whereClause([])}`,
        ctx,
      );
      return isEmpty(result)
        ? `No ${a.kind} graphing rules found.`
        : `GRAPHING (${a.kind.toUpperCase()}):\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_graphing",
    title: "Remove Graphing Rule",
    annotations: DESTRUCTIVE,
    description: "Removes a graphing rule of the given kind by '.id' (from list output).",
    inputSchema: {
      kind: Kind,
      entry_id: z.string().describe("RouterOS '.id', e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing ${a.kind} graphing rule: entry_id=${a.entry_id}`);
      const count = await executeMikrotikCommand(
        `/tool graphing ${a.kind} print count-only where .id="${a.entry_id}"`,
        ctx,
      );
      if (count.trim() === "0") return `${a.kind} graphing rule '${a.entry_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/tool graphing ${a.kind} remove [find .id="${a.entry_id}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove ${a.kind} graphing rule: ${result}`;
      return `${a.kind} graphing rule '${a.entry_id}' removed successfully.`;
    },
  }),
];
