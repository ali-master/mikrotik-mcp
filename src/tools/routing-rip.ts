/** RIP — `/routing rip` (instance, interface-template, static-neighbor, neighbor) — RouterOS v7. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import {
  WRITE,
  WRITE_IDEMPOTENT,
  READ,
  DESTRUCTIVE,
  defineTool,
} from "../core/registry";
import type { ToolModule } from "../core/registry";
import {
  looksLikeError,
  isEmpty,
  commandUnsupported,
  Cmd,
} from "../core/routeros";

const UNSUPPORTED =
  "RIP is not available on this device (requires RouterOS v7 with the routing package).";

export const routingRipTools: ToolModule = [
  // ── Instances ─────────────────────────────────────────────────────────────
  defineTool({
    name: "list_rip_instances",
    title: "List RIP Instances",
    annotations: READ,
    description:
      "Lists RIP instances (`/routing rip instance`). An instance is one RIP process with its own router-id, " +
      "redistribution and import/export filter chains.",
    async handler(_a, ctx) {
      ctx.info("Listing RIP instances");
      const result = await executeMikrotikCommand(
        "/routing rip instance print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No RIP instances found."
        : `RIP INSTANCES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_rip_instance",
    title: "Add RIP Instance",
    annotations: WRITE,
    description:
      "Adds a RIP instance. `redistribute` is a comma list (connected,static,ospf,bgp,…); filter chains " +
      "reference `/routing filter`.",
    inputSchema: {
      name: z.string().describe("Unique instance name"),
      router_id: z
        .string()
        .optional()
        .describe("IPv4 address, 'main', or a /routing id name"),
      vrf: z.string().optional(),
      redistribute: z
        .string()
        .optional()
        .describe('Comma list, e.g. "connected,static"'),
      in_filter_chain: z.string().optional(),
      out_filter_chain: z.string().optional(),
      originate_default: z
        .string()
        .optional()
        .describe("never, if-installed, or always"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding RIP instance: ${a.name}`);
      const cmd = new Cmd("/routing rip instance add")
        .set("name", a.name)
        .opt("router-id", a.router_id)
        .opt("vrf", a.vrf)
        .opt("redistribute", a.redistribute)
        .opt("in-filter-chain", a.in_filter_chain)
        .opt("out-filter-chain", a.out_filter_chain)
        .opt("originate-default", a.originate_default)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to add RIP instance: ${result}`;
      const details = await executeMikrotikCommand(
        `/routing rip instance print detail where name="${a.name}"`,
        ctx,
      );
      return `RIP instance '${a.name}' added successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "update_rip_instance",
    title: "Update RIP Instance",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates a RIP instance by name.",
    inputSchema: {
      name: z.string().describe("Existing RIP instance name"),
      router_id: z.string().optional(),
      redistribute: z.string().optional(),
      in_filter_chain: z.string().optional(),
      out_filter_chain: z.string().optional(),
      originate_default: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating RIP instance: ${a.name}`);
      const base = `/routing rip instance set [find name="${a.name}"]`;
      const cmd = new Cmd(base)
        .opt("router-id", a.router_id)
        .opt("redistribute", a.redistribute)
        .opt("in-filter-chain", a.in_filter_chain)
        .opt("out-filter-chain", a.out_filter_chain)
        .opt("originate-default", a.originate_default);
      if (a.comment !== undefined) cmd.set("comment", a.comment);
      if (a.disabled !== undefined) cmd.bool("disabled", a.disabled);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to update RIP instance: ${result}`;
      const details = await executeMikrotikCommand(
        `/routing rip instance print detail where name="${a.name}"`,
        ctx,
      );
      return `RIP instance '${a.name}' updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_rip_instance",
    title: "Remove RIP Instance",
    annotations: DESTRUCTIVE,
    description: "Removes a RIP instance by name.",
    inputSchema: { name: z.string().describe("RIP instance name to remove") },
    async handler(a, ctx) {
      ctx.info(`Removing RIP instance: ${a.name}`);
      const result = await executeMikrotikCommand(
        `/routing rip instance remove [find name="${a.name}"]`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to remove RIP instance: ${result}`;
      return `RIP instance '${a.name}' removed successfully.`;
    },
  }),

  // ── Interface templates ───────────────────────────────────────────────────
  defineTool({
    name: "list_rip_interface_templates",
    title: "List RIP Interface Templates",
    annotations: READ,
    description:
      "Lists RIP interface templates (`/routing rip interface-template`): which interfaces participate in an " +
      "instance and their per-link options (passive, authentication, key-chain).",
    async handler(_a, ctx) {
      ctx.info("Listing RIP interface templates");
      const result = await executeMikrotikCommand(
        "/routing rip interface-template print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No RIP interface templates found."
        : `RIP INTERFACE TEMPLATES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_rip_interface_template",
    title: "Add RIP Interface Template",
    annotations: WRITE,
    description:
      "Adds a RIP interface template binding interfaces to an instance. `passive` advertises without sending " +
      "updates; `key_chain` enables authentication.",
    inputSchema: {
      instance: z.string().describe("RIP instance name"),
      interfaces: z.string().describe("Interface or interface-list name"),
      passive: z.boolean().optional(),
      key_chain: z
        .string()
        .optional()
        .describe("Key-chain name for authentication"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding RIP interface template for instance ${a.instance}`);
      const cmd = new Cmd("/routing rip interface-template add")
        .set("instance", a.instance)
        .set("interfaces", a.interfaces)
        .opt("key-chain", a.key_chain)
        .opt("comment", a.comment);
      if (a.passive !== undefined) cmd.bool("passive", a.passive);
      cmd.flag("disabled", a.disabled);

      const result = await executeMikrotikCommand(cmd.build(), ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to add RIP interface template: ${result}`;
      const t = result.trim();
      return t
        ? `RIP interface template added (id ${t}).`
        : "RIP interface template added successfully.";
    },
  }),

  defineTool({
    name: "remove_rip_interface_template",
    title: "Remove RIP Interface Template",
    annotations: DESTRUCTIVE,
    description: "Removes a RIP interface template by id.",
    inputSchema: { template_id: z.string().describe('Template id, e.g. "*1"') },
    async handler(a, ctx) {
      ctx.info(`Removing RIP interface template ${a.template_id}`);
      const result = await executeMikrotikCommand(
        `/routing rip interface-template remove ${a.template_id}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to remove RIP interface template: ${result}`;
      return `RIP interface template '${a.template_id}' removed successfully.`;
    },
  }),

  // ── Static neighbors ──────────────────────────────────────────────────────
  defineTool({
    name: "list_rip_static_neighbors",
    title: "List RIP Static Neighbors",
    annotations: READ,
    description:
      "Lists statically-configured RIP neighbors (`/routing rip static-neighbor`) — used to unicast RIP updates " +
      "to peers across non-broadcast links.",
    async handler(_a, ctx) {
      ctx.info("Listing RIP static neighbors");
      const result = await executeMikrotikCommand(
        "/routing rip static-neighbor print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No RIP static neighbors found."
        : `RIP STATIC NEIGHBORS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_rip_static_neighbor",
    title: "Add RIP Static Neighbor",
    annotations: WRITE,
    description: "Adds a static RIP neighbor to unicast updates to.",
    inputSchema: {
      address: z.string().describe("Neighbor IP address"),
      instance: z.string().optional().describe("RIP instance name"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding RIP static neighbor ${a.address}`);
      const cmd = new Cmd("/routing rip static-neighbor add")
        .set("address", a.address)
        .opt("instance", a.instance)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to add RIP static neighbor: ${result}`;
      return `RIP static neighbor '${a.address}' added successfully.`;
    },
  }),

  defineTool({
    name: "remove_rip_static_neighbor",
    title: "Remove RIP Static Neighbor",
    annotations: DESTRUCTIVE,
    description: "Removes a RIP static neighbor by id.",
    inputSchema: {
      neighbor_id: z.string().describe('Static-neighbor id, e.g. "*1"'),
    },
    async handler(a, ctx) {
      ctx.info(`Removing RIP static neighbor ${a.neighbor_id}`);
      const result = await executeMikrotikCommand(
        `/routing rip static-neighbor remove ${a.neighbor_id}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to remove RIP static neighbor: ${result}`;
      return `RIP static neighbor '${a.neighbor_id}' removed successfully.`;
    },
  }),

  // ── Operational neighbors (read-only) ─────────────────────────────────────
  defineTool({
    name: "list_rip_neighbors",
    title: "List RIP Neighbors",
    annotations: READ,
    description:
      "Lists discovered RIP neighbors (`/routing rip neighbor`): peers this router is exchanging routes with, " +
      "with last-update timing. Read-only.",
    async handler(_a, ctx) {
      ctx.info("Listing RIP neighbors");
      const result = await executeMikrotikCommand(
        "/routing rip neighbor print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No RIP neighbors found."
        : `RIP NEIGHBORS:\n\n${result}`;
    },
  }),
];
