/** Routing settings — `/routing settings` (RouterOS v7). */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, commandUnsupported, Cmd } from "../core/routeros";

const UNSUPPORTED =
  "Routing settings are not available on this device (requires RouterOS v7 with the routing package).";

const HASH_POLICY = ["l3", "l3-inner", "l4"] as const;

export const routingSettingsTools: ToolModule = [
  defineTool({
    name: "get_routing_settings",
    title: "Get Global Routing Settings",
    annotations: READ,
    description:
      "Reads global routing daemon settings (`/routing settings print`) on RouterOS v7 — " +
      "the ECMP/multipath hash policies for IPv4 and IPv6 and the VRF-as-interface flag. " +
      "Use this to inspect how equal-cost next-hops are hashed and whether VRFs are exposed as interfaces. " +
      "For individual IPv4 route entries use list_routes; for IPv6 routes use list_ipv6_routes; " +
      "for policy-routing rules use list_routing_rules; for BGP peers use list_bgp_connections. " +
      "Returns all fields from /routing settings.",
    async handler(_a, ctx) {
      ctx.info("Getting routing settings");
      const result = await executeMikrotikCommand("/routing settings print", ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result) ? "No routing settings reported." : `ROUTING SETTINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_routing_settings",
    title: "Update Global Routing Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Sets global routing daemon settings (`/routing settings set`) on RouterOS v7 — " +
      "controls ECMP/multipath hash policy and VRF-as-interface behavior. " +
      "`ipv4_multipath_hash_policy` and `ipv6_multipath_hash_policy` choose how equal-cost next-hops are selected: " +
      "`l3` = src/dst IP only, `l3-inner` = inner packet header for tunnelled traffic, `l4` = include L4 src/dst ports. " +
      "`ipv4_vrf_as_interface` exposes VRFs as interfaces to the rest of the config. " +
      "For modifying individual IPv4 route entries use update_route; " +
      "for policy-based routing rules use update_routing_rule. " +
      "Returns the full /routing settings after applying changes.",
    inputSchema: {
      ipv4_multipath_hash_policy: z.enum(HASH_POLICY).optional(),
      ipv6_multipath_hash_policy: z.enum(HASH_POLICY).optional(),
      ipv4_vrf_as_interface: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Updating routing settings");
      const cmd = new Cmd("/routing settings set")
        .opt("ipv4-multipath-hash-policy", a.ipv4_multipath_hash_policy)
        .opt("ipv6-multipath-hash-policy", a.ipv6_multipath_hash_policy)
        .bool("ipv4-vrf-as-interface", a.ipv4_vrf_as_interface);

      const built = cmd.build();
      if (built === "/routing settings set") return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (commandUnsupported(result)) return UNSUPPORTED;
      if (looksLikeError(result)) return `Failed to update routing settings: ${result}`;
      const details = await executeMikrotikCommand("/routing settings print", ctx);
      return `Routing settings updated:\n\n${details}`;
    },
  }),
];
