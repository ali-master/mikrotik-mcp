/** Global IPv6 settings — `/ipv6 settings`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";

const AcceptMode = z.enum(["yes", "no", "yes-if-forwarding-disabled"]);
const MultipathHashPolicy = z.enum(["l3", "l4", "l3-inner"]);

export const ipv6SettingsTools: ToolModule = [
  defineTool({
    name: "get_ipv6_settings",
    title: "Get IPv6 Global Settings",
    annotations: READ,
    description:
      "Read IPv6 global settings (`/ipv6 settings`) — the single device-wide control record " +
      "that governs whether IPv6 is enabled, packet forwarding, ICMP redirect acceptance, " +
      "router-advertisement acceptance, and the neighbor-cache limit.\n\n" +
      "Use this to inspect the current state before calling update_ipv6_settings. " +
      "This is not for per-interface IPv6 addresses (use add_ipv6_address / list_ipv6_addresses) " +
      "or routes (use list_ipv6_routes / add_ipv6_route) or firewall rules (use list_ipv6_filter_rules).\n\n" +
      "Returns the full `/ipv6 settings print` output as a text block.",
    async handler(_a, ctx) {
      ctx.info("Getting IPv6 settings");
      const result = await executeMikrotikCommand("/ipv6 settings print", ctx);
      return isEmpty(result) ? "Unable to read IPv6 settings." : `IPV6 SETTINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_ipv6_settings",
    title: "Update IPv6 Global Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Update IPv6 global settings (`/ipv6 settings set`) — modify the device-wide IPv6 " +
      "control record that covers the enable/disable toggle, packet forwarding, ICMP redirect " +
      "acceptance, router-advertisement acceptance, and the neighbor-cache ceiling.\n\n" +
      "Use this to toggle IPv6 entirely or tune host-vs-router behavior. " +
      "This does NOT add IPv6 addresses (use add_ipv6_address), static routes " +
      "(use add_ipv6_route), or firewall rules (use create_ipv6_filter_rule / " +
      "create_ipv6_nat_rule / create_ipv6_mangle_rule). " +
      "To read the current state first, use get_ipv6_settings.\n\n" +
      "Argument notes:\n" +
      "    disable_ipv6: true turns off IPv6 device-wide.\n" +
      "    forward: true enables IPv6 packet forwarding (router mode).\n" +
      "    accept_redirects / accept_router_advertisements: 'yes', 'no', or\n" +
      "        'yes-if-forwarding-disabled' (the host-like default).\n" +
      "    max_neighbor_entries: integer cap on the IPv6 neighbor cache.\n\n" +
      "Returns the updated `/ipv6 settings print` output on success.",
    inputSchema: {
      disable_ipv6: z.boolean().optional(),
      forward: z.boolean().optional(),
      accept_redirects: AcceptMode.optional(),
      accept_router_advertisements: AcceptMode.optional(),
      accept_router_advertisements_on: z
        .string()
        .optional()
        .describe("Interface list on which to accept router advertisements (e.g. 'all')."),
      max_neighbor_entries: z.number().int().optional(),
      min_neighbor_entries: z
        .number()
        .int()
        .optional()
        .describe(
          "Lower threshold for the IPv6 neighbor cache below which entries are not reclaimed.",
        ),
      soft_max_neighbor_entries: z
        .number()
        .int()
        .optional()
        .describe("Soft ceiling for the IPv6 neighbor cache before aggressive garbage collection."),
      stale_neighbor_timeout: z
        .string()
        .optional()
        .describe("Time a stale IPv6 neighbor entry is kept before revalidation (e.g. '60')."),
      multipath_hash_policy: MultipathHashPolicy.optional().describe(
        "Hashing fields for ECMP multipath route selection: l3, l4, or l3-inner.",
      ),
      allow_fast_path: z.boolean().optional().describe("Allow IPv6 FastPath processing."),
    },
    async handler(a, ctx) {
      ctx.info("Updating IPv6 settings");
      const cmd = new Cmd("/ipv6 settings set")
        .bool("disable-ipv6", a.disable_ipv6)
        .bool("forward", a.forward)
        .opt("accept-redirects", a.accept_redirects)
        .opt("accept-router-advertisements", a.accept_router_advertisements)
        .opt("accept-router-advertisements-on", a.accept_router_advertisements_on)
        .opt("max-neighbor-entries", a.max_neighbor_entries)
        .opt("min-neighbor-entries", a.min_neighbor_entries)
        .opt("soft-max-neighbor-entries", a.soft_max_neighbor_entries)
        .opt("stale-neighbor-timeout", a.stale_neighbor_timeout)
        .opt("multipath-hash-policy", a.multipath_hash_policy)
        .bool("allow-fast-path", a.allow_fast_path);

      const built = cmd.build();
      if (built === "/ipv6 settings set") return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result)) return `Failed to update IPv6 settings: ${result}`;

      const details = await executeMikrotikCommand("/ipv6 settings print", ctx);
      return `IPv6 settings updated successfully:\n\n${details}`;
    },
  }),
];
