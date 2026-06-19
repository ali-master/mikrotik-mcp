/** IGMP Proxy — `/routing igmp-proxy` (settings, interface, mfc) — RouterOS v7. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, WRITE_IDEMPOTENT, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { yesno, looksLikeError, isEmpty, commandUnsupported, Cmd } from "../core/routeros";

const UNSUPPORTED =
  "IGMP proxy is not available on this device (requires RouterOS v7 with the routing/multicast package).";

export const routingIgmpProxyTools: ToolModule = [
  // ── Global settings ───────────────────────────────────────────────────────
  defineTool({
    name: "get_igmp_proxy_settings",
    title: "Get IGMP Proxy Settings",
    annotations: READ,
    description:
      "Shows global IGMP-proxy settings (`/routing igmp-proxy`). IGMP proxy forwards multicast between a single " +
      "upstream and one or more downstream interfaces without a full multicast routing protocol — ideal for IPTV.",
    async handler(_a, ctx) {
      ctx.info("Getting IGMP proxy settings");
      const result = await executeMikrotikCommand("/routing igmp-proxy print", ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result) ? "No IGMP proxy settings reported." : `IGMP PROXY SETTINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_igmp_proxy_settings",
    title: "Update IGMP Proxy Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates global IGMP-proxy settings. `quick_leave` prunes a group immediately on leave (good for IPTV " +
      "channel zapping); query intervals tune membership refresh behaviour.",
    inputSchema: {
      quick_leave: z.boolean().optional(),
      query_interval: z.string().optional().describe('e.g. "125s"'),
      query_response_interval: z.string().optional().describe('e.g. "10s"'),
    },
    async handler(a, ctx) {
      ctx.info("Updating IGMP proxy settings");
      const cmd = new Cmd("/routing igmp-proxy set")
        .opt("query-interval", a.query_interval)
        .opt("query-response-interval", a.query_response_interval);
      if (a.quick_leave !== undefined) cmd.bool("quick-leave", a.quick_leave);

      const built = cmd.build();
      if (built === "/routing igmp-proxy set") return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to update IGMP proxy settings: ${result}`;
      const details = await executeMikrotikCommand("/routing igmp-proxy print", ctx);
      return `IGMP proxy settings updated:\n\n${details}`;
    },
  }),

  // ── Interfaces ────────────────────────────────────────────────────────────
  defineTool({
    name: "list_igmp_proxy_interfaces",
    title: "List IGMP Proxy Interfaces",
    annotations: READ,
    description:
      "Lists IGMP-proxy interfaces (`/routing igmp-proxy interface`). Exactly one interface should be `upstream` " +
      "(toward the multicast source); the rest are downstream toward receivers.",
    async handler(_a, ctx) {
      ctx.info("Listing IGMP proxy interfaces");
      const result = await executeMikrotikCommand("/routing igmp-proxy interface print detail", ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result) ? "No IGMP proxy interfaces found." : `IGMP PROXY INTERFACES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_igmp_proxy_interface",
    title: "Add IGMP Proxy Interface",
    annotations: WRITE,
    description:
      "Adds an interface to the IGMP proxy. Set `upstream=true` for the interface facing the multicast source; " +
      "`alternative_subnets` whitelists extra source subnets reachable through this interface.",
    inputSchema: {
      interface: z.string().describe("Interface name"),
      upstream: z.boolean().default(false).describe("true = upstream (toward source), false = downstream"),
      alternative_subnets: z.string().optional().describe('Comma list of source subnets, e.g. "10.0.0.0/8"'),
      threshold: z.number().int().optional().describe("Minimum TTL to forward"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Adding IGMP proxy interface ${a.interface}`);
      const cmd = new Cmd("/routing igmp-proxy interface add")
        .set("interface", a.interface)
        .bool("upstream", a.upstream)
        .opt("alternative-subnets", a.alternative_subnets)
        .opt("threshold", a.threshold)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to add IGMP proxy interface: ${result}`;
      return `IGMP proxy interface '${a.interface}' added successfully.`;
    },
  }),

  defineTool({
    name: "update_igmp_proxy_interface",
    title: "Update IGMP Proxy Interface",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates an IGMP-proxy interface by its interface name.",
    inputSchema: {
      interface: z.string().describe("Existing IGMP-proxy interface name"),
      upstream: z.boolean().optional(),
      alternative_subnets: z.string().optional(),
      threshold: z.number().int().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating IGMP proxy interface ${a.interface}`);
      const base = `/routing igmp-proxy interface set [find interface="${a.interface}"]`;
      const cmd = new Cmd(base)
        .opt("alternative-subnets", a.alternative_subnets)
        .opt("threshold", a.threshold);
      if (a.upstream !== undefined) cmd.bool("upstream", a.upstream);
      if (a.comment !== undefined) cmd.set("comment", a.comment);
      if (a.disabled !== undefined) cmd.bool("disabled", a.disabled);

      const built = cmd.build();
      if (built === base) return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to update IGMP proxy interface: ${result}`;
      const details = await executeMikrotikCommand(
        `/routing igmp-proxy interface print detail where interface="${a.interface}"`,
        ctx,
      );
      return `IGMP proxy interface '${a.interface}' updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_igmp_proxy_interface",
    title: "Remove IGMP Proxy Interface",
    annotations: DESTRUCTIVE,
    description: "Removes an IGMP-proxy interface by its interface name.",
    inputSchema: { interface: z.string().describe("IGMP-proxy interface name to remove") },
    async handler(a, ctx) {
      ctx.info(`Removing IGMP proxy interface ${a.interface}`);
      const result = await executeMikrotikCommand(
        `/routing igmp-proxy interface remove [find interface="${a.interface}"]`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to remove IGMP proxy interface: ${result}`;
      return `IGMP proxy interface '${a.interface}' removed successfully.`;
    },
  }),

  defineTool({
    name: "set_igmp_proxy_interface_enabled",
    title: "Enable/Disable IGMP Proxy Interface",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables or disables an IGMP-proxy interface by name.",
    inputSchema: {
      interface: z.string().describe("IGMP-proxy interface name"),
      enabled: z.boolean(),
    },
    async handler(a, ctx) {
      ctx.info(`Setting IGMP proxy interface ${a.interface} enabled=${a.enabled}`);
      const result = await executeMikrotikCommand(
        `/routing igmp-proxy interface set [find interface="${a.interface}"] disabled=${yesno(!a.enabled)}`,
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to update IGMP proxy interface: ${result}`;
      return `IGMP proxy interface '${a.interface}' ${a.enabled ? "enabled" : "disabled"}.`;
    },
  }),

  // ── Forwarding cache (read-only) ──────────────────────────────────────────
  defineTool({
    name: "list_igmp_proxy_mfc",
    title: "List IGMP Proxy Forwarding Cache",
    annotations: READ,
    description:
      "Lists the IGMP-proxy multicast forwarding cache (`/routing igmp-proxy mfc`): active (source, group) entries " +
      "and which downstream interfaces each is being forwarded to. Read-only — the live multicast forwarding state.",
    async handler(_a, ctx) {
      ctx.info("Listing IGMP proxy MFC");
      const result = await executeMikrotikCommand("/routing igmp-proxy mfc print detail", ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "IGMP proxy forwarding cache is empty."
        : `IGMP PROXY FORWARDING CACHE:\n\n${result}`;
    },
  }),
];
