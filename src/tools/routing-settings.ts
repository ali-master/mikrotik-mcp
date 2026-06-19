/** Routing settings — `/routing settings` (RouterOS v7). */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import {
  looksLikeError,
  isEmpty,
  commandUnsupported,
  Cmd,
} from "../core/routeros";

const UNSUPPORTED =
  "Routing settings are not available on this device (requires RouterOS v7 with the routing package).";

const HASH_POLICY = ["l3", "l3-inner", "l4"] as const;

export const routingSettingsTools: ToolModule = [
  defineTool({
    name: "get_routing_settings",
    title: "Get Routing Settings",
    annotations: READ,
    description:
      "Shows global routing settings (`/routing settings`): ECMP/multipath hash policy for IPv4 and IPv6 " +
      "and whether VRFs are treated as interfaces.",
    async handler(_a, ctx) {
      ctx.info("Getting routing settings");
      const result = await executeMikrotikCommand(
        "/routing settings print",
        ctx,
      );
      if (commandUnsupported(result)) return UNSUPPORTED;
      return isEmpty(result)
        ? "No routing settings reported."
        : `ROUTING SETTINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_routing_settings",
    title: "Update Routing Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates global routing settings. `*_multipath_hash_policy` controls how ECMP next-hops are chosen " +
      "(l3 = src/dst IP, l3-inner = inner header for tunnels, l4 = include L4 ports). " +
      "`ipv4_vrf_as_interface` exposes VRFs as interfaces to the rest of the config.",
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
      if (looksLikeError(result))
        return `Failed to update routing settings: ${result}`;
      const details = await executeMikrotikCommand(
        "/routing settings print",
        ctx,
      );
      return `Routing settings updated:\n\n${details}`;
    },
  }),
];
