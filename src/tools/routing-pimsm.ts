/** PIM-SM — `/routing pimsm` (instance, interface-template, rp, neighbor) — RouterOS v7. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import {
  looksLikeError,
  isEmpty,
  commandUnsupported,
  Cmd,
} from "../core/routeros";

const UNSUPPORTED =
  "PIM-SM is not available on this device (requires RouterOS v7 with the routing/multicast package).";

export const routingPimsmTools: ToolModule = [
  // ── Instances ─────────────────────────────────────────────────────────────
  defineTool({
    name: "list_pimsm_instances",
    title: "List PIM-SM Instances",
    annotations: READ,
    description:
      "Lists PIM Sparse-Mode instances (`/routing pimsm instance`). PIM-SM builds multicast distribution trees " +
      "rooted at a Rendezvous Point (RP). An instance fixes the address family and VRF the protocol runs in.",
    async handler(_a, ctx) {
      ctx.info("Listing PIM-SM instances");
      const result = await executeMikrotikCommand(
        "/routing pimsm instance print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No PIM-SM instances found."
        : `PIM-SM INSTANCES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_pimsm_instance",
    title: "Add PIM-SM Instance",
    annotations: WRITE,
    description: "Adds a PIM Sparse-Mode instance.",
    inputSchema: {
      name: z.string().describe("Unique instance name"),
      afi: z.enum(["ipv4", "ipv6"]).default("ipv4").describe("Address family"),
      vrf: z.string().optional(),
      rp_set: z.string().optional().describe("Static RP-set name, if used"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding PIM-SM instance: ${a.name}`);
      const cmd = new Cmd("/routing pimsm instance add")
        .set("name", a.name)
        .opt("afi", a.afi)
        .opt("vrf", a.vrf)
        .opt("rp-set", a.rp_set)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to add PIM-SM instance: ${result}`;
      const details = await executeMikrotikCommand(
        `/routing pimsm instance print detail where name="${a.name}"`,
        ctx,
      );
      return `PIM-SM instance '${a.name}' added successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_pimsm_instance",
    title: "Remove PIM-SM Instance",
    annotations: DESTRUCTIVE,
    description: "Removes a PIM-SM instance by name.",
    inputSchema: {
      name: z.string().describe("PIM-SM instance name to remove"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing PIM-SM instance: ${a.name}`);
      const result = await executeMikrotikCommand(
        `/routing pimsm instance remove [find name="${a.name}"]`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to remove PIM-SM instance: ${result}`;
      return `PIM-SM instance '${a.name}' removed successfully.`;
    },
  }),

  // ── Interface templates ───────────────────────────────────────────────────
  defineTool({
    name: "list_pimsm_interface_templates",
    title: "List PIM-SM Interface Templates",
    annotations: READ,
    description:
      "Lists PIM-SM interface templates (`/routing pimsm interface-template`): which interfaces run PIM and " +
      "their hello/priority settings (DR election).",
    async handler(_a, ctx) {
      ctx.info("Listing PIM-SM interface templates");
      const result = await executeMikrotikCommand(
        "/routing pimsm interface-template print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No PIM-SM interface templates found."
        : `PIM-SM INTERFACE TEMPLATES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_pimsm_interface_template",
    title: "Add PIM-SM Interface Template",
    annotations: WRITE,
    description:
      "Adds a PIM-SM interface template binding interfaces to an instance.",
    inputSchema: {
      instance: z.string().describe("PIM-SM instance name"),
      interfaces: z.string().describe("Interface or interface-list name"),
      priority: z.number().int().optional().describe("DR election priority"),
      hello_period: z
        .string()
        .optional()
        .describe('Hello interval, e.g. "30s"'),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding PIM-SM interface template for instance ${a.instance}`);
      const cmd = new Cmd("/routing pimsm interface-template add")
        .set("instance", a.instance)
        .set("interfaces", a.interfaces)
        .opt("priority", a.priority)
        .opt("hello-period", a.hello_period)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to add PIM-SM interface template: ${result}`;
      const t = result.trim();
      return t
        ? `PIM-SM interface template added (id ${t}).`
        : "PIM-SM interface template added successfully.";
    },
  }),

  defineTool({
    name: "remove_pimsm_interface_template",
    title: "Remove PIM-SM Interface Template",
    annotations: DESTRUCTIVE,
    description: "Removes a PIM-SM interface template by id.",
    inputSchema: { template_id: z.string().describe('Template id, e.g. "*1"') },
    async handler(a, ctx) {
      ctx.info(`Removing PIM-SM interface template ${a.template_id}`);
      const result = await executeMikrotikCommand(
        `/routing pimsm interface-template remove ${a.template_id}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to remove PIM-SM interface template: ${result}`;
      return `PIM-SM interface template '${a.template_id}' removed successfully.`;
    },
  }),

  // ── Rendezvous Points (static RP) ─────────────────────────────────────────
  defineTool({
    name: "list_pimsm_rps",
    title: "List PIM-SM Rendezvous Points",
    annotations: READ,
    description:
      "Lists PIM-SM Rendezvous Points (`/routing pimsm rp`): the RP addresses and the multicast group ranges each " +
      "serves as the root of the shared tree.",
    async handler(_a, ctx) {
      ctx.info("Listing PIM-SM RPs");
      const result = await executeMikrotikCommand(
        "/routing pimsm rp print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No PIM-SM RPs found."
        : `PIM-SM RENDEZVOUS POINTS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_pimsm_rp",
    title: "Add PIM-SM Rendezvous Point",
    annotations: WRITE,
    description: "Adds a static Rendezvous Point for a multicast group range.",
    inputSchema: {
      instance: z.string().describe("PIM-SM instance name"),
      address: z.string().describe("RP IP address"),
      group: z
        .string()
        .optional()
        .describe('Multicast group range, e.g. "239.0.0.0/8"'),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding PIM-SM RP ${a.address}`);
      const cmd = new Cmd("/routing pimsm rp add")
        .set("instance", a.instance)
        .set("address", a.address)
        .opt("group", a.group)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to add PIM-SM RP: ${result}`;
      return `PIM-SM RP '${a.address}' added successfully.`;
    },
  }),

  defineTool({
    name: "remove_pimsm_rp",
    title: "Remove PIM-SM Rendezvous Point",
    annotations: DESTRUCTIVE,
    description: "Removes a PIM-SM Rendezvous Point by id.",
    inputSchema: { rp_id: z.string().describe('RP id, e.g. "*1"') },
    async handler(a, ctx) {
      ctx.info(`Removing PIM-SM RP ${a.rp_id}`);
      const result = await executeMikrotikCommand(
        `/routing pimsm rp remove ${a.rp_id}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to remove PIM-SM RP: ${result}`;
      return `PIM-SM RP '${a.rp_id}' removed successfully.`;
    },
  }),

  // ── Neighbors (read-only) ─────────────────────────────────────────────────
  defineTool({
    name: "list_pimsm_neighbors",
    title: "List PIM-SM Neighbors",
    annotations: READ,
    description:
      "Lists PIM-SM neighbors (`/routing pimsm neighbor`): adjacent PIM routers discovered via Hello messages, " +
      "with their DR priority and timers. Read-only.",
    async handler(_a, ctx) {
      ctx.info("Listing PIM-SM neighbors");
      const result = await executeMikrotikCommand(
        "/routing pimsm neighbor print detail",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No PIM-SM neighbors found."
        : `PIM-SM NEIGHBORS:\n\n${result}`;
    },
  }),
];
