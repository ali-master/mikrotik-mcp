/** RPKI — `/routing rpki` (BGP origin-validation sessions) — RouterOS v7. */
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
  yesno,
  whereClause,
  looksLikeError,
  isEmpty,
  commandUnsupported,
  Cmd,
} from "../core/routeros";

const UNSUPPORTED =
  "RPKI is not available on this device (requires RouterOS v7 with the routing package).";

export const routingRpkiTools: ToolModule = [
  defineTool({
    name: "list_rpki_sessions",
    title: "List RPKI Sessions",
    annotations: READ,
    description:
      "Lists RPKI sessions (`/routing rpki`). Each session is an RTR connection to a validator cache that streams " +
      "Validated ROA Payloads (VRPs); BGP filters reference the session `group` to mark routes valid/invalid/unknown " +
      "for Route Origin Validation. Shows connection status and VRP counts.",
    inputSchema: {
      group_filter: z
        .string()
        .optional()
        .describe("Show only sessions in this group"),
    },
    async handler(a, ctx) {
      ctx.info("Listing RPKI sessions");
      const filters: string[] = [];
      if (a.group_filter) filters.push(`group="${a.group_filter}"`);
      const result = await executeMikrotikCommand(
        `/routing rpki print detail${whereClause(filters)}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No RPKI sessions found."
        : `RPKI SESSIONS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_rpki_session",
    title: "Add RPKI Session",
    annotations: WRITE,
    description:
      "Adds an RPKI session to a validator cache. `group` is the name BGP filters match against; `address`/`port` " +
      "point at the RTR cache (port 8282 is the common rpki-rtr default). Tune refresh/retry/expire intervals to " +
      "control how often VRPs are pulled and when stale data is dropped.",
    inputSchema: {
      group: z
        .string()
        .describe("RPKI group name referenced by BGP route filters"),
      address: z
        .string()
        .describe("Validator (RTR cache) IP address or hostname"),
      port: z
        .number()
        .int()
        .default(8282)
        .describe("RTR port, e.g. 8282 or 323"),
      refresh_interval: z.string().optional().describe('e.g. "10m"'),
      expire_interval: z.string().optional().describe('e.g. "2h"'),
      retry_interval: z.string().optional().describe('e.g. "30s"'),
      vrf: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(
        `Adding RPKI session group=${a.group} -> ${a.address}:${a.port}`,
      );
      const cmd = new Cmd("/routing rpki add")
        .set("group", a.group)
        .set("address", a.address)
        .set("port", a.port)
        .opt("refresh-interval", a.refresh_interval)
        .opt("expire-interval", a.expire_interval)
        .opt("retry-interval", a.retry_interval)
        .opt("vrf", a.vrf)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to add RPKI session: ${result}`;
      const t = result.trim();
      return t
        ? `RPKI session added (id ${t}).`
        : `RPKI session for group '${a.group}' added successfully.`;
    },
  }),

  defineTool({
    name: "update_rpki_session",
    title: "Update RPKI Session",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates an RPKI session by id.",
    inputSchema: {
      session_id: z.string().describe('Session id, e.g. "*1"'),
      address: z.string().optional(),
      port: z.number().int().optional(),
      refresh_interval: z.string().optional(),
      expire_interval: z.string().optional(),
      retry_interval: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating RPKI session ${a.session_id}`);
      const base = `/routing rpki set ${a.session_id}`;
      const cmd = new Cmd(base)
        .opt("address", a.address)
        .opt("port", a.port)
        .opt("refresh-interval", a.refresh_interval)
        .opt("expire-interval", a.expire_interval)
        .opt("retry-interval", a.retry_interval);
      if (a.comment !== undefined) cmd.set("comment", a.comment);
      if (a.disabled !== undefined) cmd.bool("disabled", a.disabled);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to update RPKI session: ${result}`;
      const details = await executeMikrotikCommand(
        `/routing rpki print detail where .id=${a.session_id}`,
        ctx,
      );
      return `RPKI session updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_rpki_session",
    title: "Remove RPKI Session",
    annotations: DESTRUCTIVE,
    description:
      "Removes an RPKI session by id (BGP routes using its group fall back to 'unknown').",
    inputSchema: { session_id: z.string().describe('Session id, e.g. "*1"') },
    async handler(a, ctx) {
      ctx.info(`Removing RPKI session ${a.session_id}`);
      const result = await executeMikrotikCommand(
        `/routing rpki remove ${a.session_id}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to remove RPKI session: ${result}`;
      return `RPKI session '${a.session_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "set_rpki_session_enabled",
    title: "Enable/Disable RPKI Session",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables or disables an RPKI session by id.",
    inputSchema: {
      session_id: z.string().describe('Session id, e.g. "*1"'),
      enabled: z.boolean(),
    },
    async handler(a, ctx) {
      ctx.info(`Setting RPKI session ${a.session_id} enabled=${a.enabled}`);
      const result = await executeMikrotikCommand(
        `/routing rpki set ${a.session_id} disabled=${yesno(!a.enabled)}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result))
        return `Failed to update RPKI session: ${result}`;
      return `RPKI session '${a.session_id}' ${a.enabled ? "enabled" : "disabled"}.`;
    },
  }),
];
