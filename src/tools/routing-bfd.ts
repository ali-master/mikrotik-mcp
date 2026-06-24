/** Bidirectional Forwarding Detection — `/routing bfd` (RouterOS v7). */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
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
  "BFD is not available on this device (requires RouterOS v7 with the routing package).";

export const routingBfdTools: ToolModule = [
  // ── Configuration ─────────────────────────────────────────────────────────
  defineTool({
    name: "list_bfd_configurations",
    title: "List BFD Configurations",
    annotations: READ,
    description:
      "Lists BFD configuration entries (`/routing bfd configuration`). BFD gives sub-second failure detection " +
      "for a link/neighbor so routing protocols (OSPF/BGP) can tear down a session far faster than their own " +
      "hold timers. Each entry binds timers to a set of interfaces in a VRF.",
    async handler(_a, ctx) {
      ctx.info("Listing BFD configurations");
      const result = await executeMikrotikCommand("/routing bfd configuration print detail", ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result) ? "No BFD configurations found." : `BFD CONFIGURATIONS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_bfd_configuration",
    title: "Add BFD Configuration",
    annotations: WRITE,
    description:
      "Adds a BFD configuration. `interfaces` selects where BFD runs (an interface or interface-list); " +
      "`min_rx`/`min_tx` are the desired minimum receive/transmit intervals and `multiplier` is how many " +
      "missed packets declare the session down (detection time ≈ interval × multiplier).",
    inputSchema: {
      interfaces: z.string().describe("Interface or interface-list name BFD runs on"),
      vrf: z.string().optional().describe("VRF (default 'main')"),
      min_rx: z.string().optional().describe('Desired min RX interval, e.g. "200ms"'),
      min_tx: z.string().optional().describe('Desired min TX interval, e.g. "200ms"'),
      multiplier: z.number().int().optional().describe("Detection multiplier, e.g. 5"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding BFD configuration for ${a.interfaces}`);
      const cmd = new Cmd("/routing bfd configuration add")
        .set("interfaces", a.interfaces)
        .opt("vrf", a.vrf)
        .opt("min-rx", a.min_rx)
        .opt("min-tx", a.min_tx)
        .opt("multiplier", a.multiplier)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to add BFD configuration: ${result}`;
      const t = result.trim();
      return t ? `BFD configuration added (id ${t}).` : "BFD configuration added successfully.";
    },
  }),

  defineTool({
    name: "update_bfd_configuration",
    title: "Update BFD Configuration",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates a BFD configuration entry by id.",
    inputSchema: {
      config_id: z.string().describe('Configuration id, e.g. "*1"'),
      interfaces: z.string().optional(),
      vrf: z.string().optional(),
      min_rx: z.string().optional(),
      min_tx: z.string().optional(),
      multiplier: z.number().int().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating BFD configuration ${a.config_id}`);
      const base = `/routing bfd configuration set ${a.config_id}`;
      const cmd = new Cmd(base)
        .opt("interfaces", a.interfaces)
        .opt("vrf", a.vrf)
        .opt("min-rx", a.min_rx)
        .opt("min-tx", a.min_tx)
        .opt("multiplier", a.multiplier);
      if (a.comment !== undefined) cmd.set("comment", a.comment);
      if (a.disabled !== undefined) cmd.bool("disabled", a.disabled);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to update BFD configuration: ${result}`;
      const details = await executeMikrotikCommand(
        `/routing bfd configuration print detail where .id=${a.config_id}`,
        ctx,
      );
      return `BFD configuration updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_bfd_configuration",
    title: "Remove BFD Configuration",
    annotations: DESTRUCTIVE,
    description: "Removes a BFD configuration entry by id.",
    inputSchema: {
      config_id: z.string().describe('Configuration id, e.g. "*1"'),
    },
    async handler(a, ctx) {
      ctx.info(`Removing BFD configuration ${a.config_id}`);
      const result = await executeMikrotikCommand(
        `/routing bfd configuration remove ${a.config_id}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to remove BFD configuration: ${result}`;
      return `BFD configuration '${a.config_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "set_bfd_configuration_enabled",
    title: "Enable/Disable BFD Configuration",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables or disables a BFD configuration entry by id.",
    inputSchema: {
      config_id: z.string().describe('Configuration id, e.g. "*1"'),
      enabled: z.boolean(),
    },
    async handler(a, ctx) {
      ctx.info(`Setting BFD configuration ${a.config_id} enabled=${a.enabled}`);
      const result = await executeMikrotikCommand(
        `/routing bfd configuration set ${a.config_id} disabled=${yesno(!a.enabled)}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to update BFD configuration: ${result}`;
      return `BFD configuration '${a.config_id}' ${a.enabled ? "enabled" : "disabled"}.`;
    },
  }),

  // ── Sessions (read-only) ──────────────────────────────────────────────────
  defineTool({
    name: "list_bfd_sessions",
    title: "List BFD Sessions",
    annotations: READ,
    description:
      "Lists live BFD sessions (`/routing bfd session`): each neighbor's state (up/down), local/remote discriminators " +
      "and negotiated timers. Read-only — use it to confirm BFD is actually up before relying on it for fast failover.",
    inputSchema: {
      up_only: z.boolean().default(false).describe("Show only sessions currently up"),
    },
    async handler(a, ctx) {
      ctx.info("Listing BFD sessions");
      const filters: string[] = [];
      if (a.up_only) filters.push("status=up");
      const result = await executeMikrotikCommand(
        `/routing bfd session print detail${whereClause(filters)}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result) ? "No BFD sessions found." : `BFD SESSIONS:\n\n${result}`;
    },
  }),
];
