/** OSPF — `/routing ospf` (instance, area, area-range, interface-template, neighbor, lsa) — RouterOS v7. */
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
  yesno,
  whereClause,
  looksLikeError,
  isEmpty,
  commandUnsupported,
  Cmd,
} from "../core/routeros";

const UNSUPPORTED =
  "OSPF is not available on this device (requires RouterOS v7 with the routing package).";

export const routingOspfTools: ToolModule = [
  // ── Instances ─────────────────────────────────────────────────────────────
  defineTool({
    name: "list_ospf_instances",
    title: "List OSPF Instances",
    annotations: READ,
    description:
      "Lists OSPF instances (`/routing ospf instance`). An instance is one OSPF process: it fixes the protocol " +
      "version (2 for IPv4, 3 for IPv6), router-id, redistribution and import/export filter chains.",
    async handler(_a, ctx) {
      ctx.info("Listing OSPF instances");
      const result = await executeMikrotikCommand(
        "/routing ospf instance print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No OSPF instances found."
        : `OSPF INSTANCES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_ospf_instance",
    title: "Add OSPF Instance",
    annotations: WRITE,
    description:
      "Adds an OSPF instance. `version` 2 = OSPFv2 (IPv4), 3 = OSPFv3 (IPv6). `router_id` may be an IPv4 address, " +
      "'main', or the name of a `/routing id`. `redistribute` is a comma list (connected,static,rip,bgp,…).",
    inputSchema: {
      name: z.string().describe("Unique instance name"),
      version: z
        .number()
        .int()
        .min(2)
        .max(3)
        .default(2)
        .describe("2 = OSPFv2, 3 = OSPFv3"),
      router_id: z
        .string()
        .optional()
        .describe("IPv4 address, 'main', or a /routing id name"),
      vrf: z.string().optional(),
      redistribute: z
        .string()
        .optional()
        .describe('Comma list, e.g. "connected,static"'),
      in_filter_chain: z
        .string()
        .optional()
        .describe("Routing filter chain for received routes"),
      out_filter_chain: z
        .string()
        .optional()
        .describe("Routing filter chain for redistributed routes"),
      originate_default: z
        .string()
        .optional()
        .describe("never, if-installed, or always"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding OSPF instance: ${a.name}`);
      const cmd = new Cmd("/routing ospf instance add")
        .set("name", a.name)
        .set("version", a.version)
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
        return `Failed to add OSPF instance: ${result}`;
      const details = await executeMikrotikCommand(
        `/routing ospf instance print detail where name="${a.name}"`,
        ctx,
      );
      return `OSPF instance '${a.name}' added successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "update_ospf_instance",
    title: "Update OSPF Instance",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates an OSPF instance by name.",
    inputSchema: {
      name: z.string().describe("Existing OSPF instance name"),
      router_id: z.string().optional(),
      redistribute: z.string().optional(),
      in_filter_chain: z.string().optional(),
      out_filter_chain: z.string().optional(),
      originate_default: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating OSPF instance: ${a.name}`);
      const base = `/routing ospf instance set [find name="${a.name}"]`;
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
        return `Failed to update OSPF instance: ${result}`;
      const details = await executeMikrotikCommand(
        `/routing ospf instance print detail where name="${a.name}"`,
        ctx,
      );
      return `OSPF instance '${a.name}' updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_ospf_instance",
    title: "Remove OSPF Instance",
    annotations: DESTRUCTIVE,
    description: "Removes an OSPF instance by name.",
    inputSchema: { name: z.string().describe("OSPF instance name to remove") },
    async handler(a, ctx) {
      ctx.info(`Removing OSPF instance: ${a.name}`);
      const result = await executeMikrotikCommand(
        `/routing ospf instance remove [find name="${a.name}"]`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to remove OSPF instance: ${result}`;
      return `OSPF instance '${a.name}' removed successfully.`;
    },
  }),

  // ── Areas ─────────────────────────────────────────────────────────────────
  defineTool({
    name: "list_ospf_areas",
    title: "List OSPF Areas",
    annotations: READ,
    description:
      "Lists OSPF areas (`/routing ospf area`). An area groups links inside an instance; `type` controls LSA " +
      "flooding (default/backbone, stub, nssa).",
    async handler(_a, ctx) {
      ctx.info("Listing OSPF areas");
      const result = await executeMikrotikCommand(
        "/routing ospf area print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No OSPF areas found."
        : `OSPF AREAS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_ospf_area",
    title: "Add OSPF Area",
    annotations: WRITE,
    description:
      "Adds an OSPF area to an instance. The backbone is area-id 0.0.0.0.",
    inputSchema: {
      name: z.string().describe("Unique area name"),
      area_id: z
        .string()
        .describe('Area id in IPv4 notation, e.g. "0.0.0.0" for backbone'),
      instance: z.string().describe("OSPF instance name this area belongs to"),
      type: z.enum(["default", "stub", "nssa"]).optional(),
      no_summaries: z
        .boolean()
        .optional()
        .describe("Make a totally-stubby/NSSA area (block summary LSAs)"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding OSPF area: ${a.name}`);
      const cmd = new Cmd("/routing ospf area add")
        .set("name", a.name)
        .set("area-id", a.area_id)
        .set("instance", a.instance)
        .opt("type", a.type);
      if (a.no_summaries !== undefined)
        cmd.bool("no-summaries", a.no_summaries);
      cmd.opt("comment", a.comment).flag("disabled", a.disabled);

      const result = await executeMikrotikCommand(cmd.build(), ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to add OSPF area: ${result}`;
      return `OSPF area '${a.name}' added successfully.`;
    },
  }),

  defineTool({
    name: "remove_ospf_area",
    title: "Remove OSPF Area",
    annotations: DESTRUCTIVE,
    description: "Removes an OSPF area by name.",
    inputSchema: { name: z.string().describe("OSPF area name to remove") },
    async handler(a, ctx) {
      ctx.info(`Removing OSPF area: ${a.name}`);
      const result = await executeMikrotikCommand(
        `/routing ospf area remove [find name="${a.name}"]`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to remove OSPF area: ${result}`;
      return `OSPF area '${a.name}' removed successfully.`;
    },
  }),

  // ── Area ranges (summarisation) ───────────────────────────────────────────
  defineTool({
    name: "list_ospf_area_ranges",
    title: "List OSPF Area Ranges",
    annotations: READ,
    description:
      "Lists OSPF area ranges (`/routing ospf area range`): aggregate prefixes advertised at an area boundary " +
      "to summarise intra-area routes.",
    async handler(_a, ctx) {
      ctx.info("Listing OSPF area ranges");
      const result = await executeMikrotikCommand(
        "/routing ospf area range print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No OSPF area ranges found."
        : `OSPF AREA RANGES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_ospf_area_range",
    title: "Add OSPF Area Range",
    annotations: WRITE,
    description: "Adds a summarisation range to an OSPF area.",
    inputSchema: {
      area: z.string().describe("OSPF area name"),
      prefix: z.string().describe('Aggregate prefix, e.g. "10.10.0.0/16"'),
      advertise: z
        .boolean()
        .default(true)
        .describe("Advertise the summary (false suppresses it)"),
      cost: z.number().int().optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Adding OSPF area range ${a.prefix} to ${a.area}`);
      const cmd = new Cmd("/routing ospf area range add")
        .set("area", a.area)
        .set("prefix", a.prefix)
        .bool("advertise", a.advertise)
        .opt("cost", a.cost)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to add OSPF area range: ${result}`;
      return `OSPF area range '${a.prefix}' added to area '${a.area}'.`;
    },
  }),

  defineTool({
    name: "remove_ospf_area_range",
    title: "Remove OSPF Area Range",
    annotations: DESTRUCTIVE,
    description: "Removes an OSPF area range by id.",
    inputSchema: { range_id: z.string().describe('Range id, e.g. "*1"') },
    async handler(a, ctx) {
      ctx.info(`Removing OSPF area range ${a.range_id}`);
      const result = await executeMikrotikCommand(
        `/routing ospf area range remove ${a.range_id}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to remove OSPF area range: ${result}`;
      return `OSPF area range '${a.range_id}' removed successfully.`;
    },
  }),

  // ── Interface templates ───────────────────────────────────────────────────
  defineTool({
    name: "list_ospf_interface_templates",
    title: "List OSPF Interface Templates",
    annotations: READ,
    description:
      "Lists OSPF interface templates (`/routing ospf interface-template`). A template binds interfaces/networks " +
      "to an area and sets per-link parameters (cost, type, timers, authentication, passive).",
    async handler(_a, ctx) {
      ctx.info("Listing OSPF interface templates");
      const result = await executeMikrotikCommand(
        "/routing ospf interface-template print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No OSPF interface templates found."
        : `OSPF INTERFACE TEMPLATES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_ospf_interface_template",
    title: "Add OSPF Interface Template",
    annotations: WRITE,
    description:
      "Adds an OSPF interface template. Match links via `interfaces` and/or `networks`; `type` sets the link model " +
      "(broadcast/ptp/nbma/ptmp), `passive` advertises the subnet without forming adjacencies, and the `auth_*` " +
      "fields enable per-interface authentication.",
    inputSchema: {
      area: z
        .string()
        .describe("OSPF area name to attach matched interfaces to"),
      interfaces: z
        .string()
        .optional()
        .describe("Interface or interface-list name"),
      networks: z
        .string()
        .optional()
        .describe('Network prefix(es) to enable OSPF on, e.g. "10.0.0.0/24"'),
      cost: z.number().int().optional().describe("Output cost / metric"),
      priority: z
        .number()
        .int()
        .optional()
        .describe("DR election priority (0 = never DR)"),
      type: z
        .enum(["broadcast", "ptp", "nbma", "ptmp", "virtual-link"])
        .optional(),
      passive: z.boolean().optional(),
      hello_interval: z.string().optional().describe('e.g. "10s"'),
      dead_interval: z.string().optional().describe('e.g. "40s"'),
      auth: z
        .enum(["simple", "md5", "sha1", "sha256", "sha384", "sha512"])
        .optional(),
      auth_id: z
        .number()
        .int()
        .optional()
        .describe("Key id for keyed authentication"),
      auth_key: z.string().optional().describe("Authentication key/password"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding OSPF interface template for area ${a.area}`);
      const cmd = new Cmd("/routing ospf interface-template add")
        .set("area", a.area)
        .opt("interfaces", a.interfaces)
        .opt("networks", a.networks)
        .opt("cost", a.cost)
        .opt("priority", a.priority)
        .opt("type", a.type)
        .opt("hello-interval", a.hello_interval)
        .opt("dead-interval", a.dead_interval)
        .opt("auth", a.auth)
        .opt("auth-id", a.auth_id)
        .opt("auth-key", a.auth_key)
        .opt("comment", a.comment);
      if (a.passive !== undefined) cmd.bool("passive", a.passive);
      cmd.flag("disabled", a.disabled);

      const result = await executeMikrotikCommand(cmd.build(), ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to add OSPF interface template: ${result}`;
      const t = result.trim();
      return t
        ? `OSPF interface template added (id ${t}).`
        : "OSPF interface template added successfully.";
    },
  }),

  defineTool({
    name: "remove_ospf_interface_template",
    title: "Remove OSPF Interface Template",
    annotations: DESTRUCTIVE,
    description: "Removes an OSPF interface template by id.",
    inputSchema: { template_id: z.string().describe('Template id, e.g. "*2"') },
    async handler(a, ctx) {
      ctx.info(`Removing OSPF interface template ${a.template_id}`);
      const result = await executeMikrotikCommand(
        `/routing ospf interface-template remove ${a.template_id}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to remove OSPF interface template: ${result}`;
      return `OSPF interface template '${a.template_id}' removed successfully.`;
    },
  }),

  // ── Neighbors & LSAs (read-only) ──────────────────────────────────────────
  defineTool({
    name: "list_ospf_neighbors",
    title: "List OSPF Neighbors",
    annotations: READ,
    description:
      "Lists OSPF neighbors (`/routing ospf neighbor`): adjacency state (Full/2-Way/…), neighbor router-id and " +
      "address. Read-only — the key health check for OSPF adjacencies.",
    async handler(_a, ctx) {
      ctx.info("Listing OSPF neighbors");
      const result = await executeMikrotikCommand(
        "/routing ospf neighbor print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No OSPF neighbors found."
        : `OSPF NEIGHBORS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "list_ospf_lsa",
    title: "List OSPF LSAs",
    annotations: READ,
    description:
      "Lists the OSPF link-state database (`/routing ospf lsa`): every LSA the router holds, by type, area and " +
      "originator. Read-only — used to inspect topology and diagnose flooding/summarisation problems.",
    inputSchema: {
      area_filter: z
        .string()
        .optional()
        .describe("Show only LSAs for this area"),
    },
    async handler(a, ctx) {
      ctx.info("Listing OSPF LSAs");
      const filters: string[] = [];
      if (a.area_filter) filters.push(`area="${a.area_filter}"`);
      const result = await executeMikrotikCommand(
        `/routing ospf lsa print${whereClause(filters)}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "OSPF link-state database is empty."
        : `OSPF LSAs:\n\n${result}`;
    },
  }),
];
