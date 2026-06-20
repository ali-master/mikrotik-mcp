/** Global IPv6 settings — `/ipv6 settings`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";

const AcceptMode = z.enum(["yes", "no", "yes-if-forwarding-disabled"]);

export const ipv6SettingsTools: ToolModule = [
  defineTool({
    name: "get_ipv6_settings",
    title: "Get IPv6 Settings",
    annotations: READ,
    description:
      "Gets the global IPv6 settings of the MikroTik device (`/ipv6 settings`).",
    async handler(_a, ctx) {
      ctx.info("Getting IPv6 settings");
      const result = await executeMikrotikCommand("/ipv6 settings print", ctx);
      return isEmpty(result)
        ? "Unable to read IPv6 settings."
        : `IPV6 SETTINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_ipv6_settings",
    title: "Update IPv6 Settings",
    annotations: WRITE_IDEMPOTENT,
    description:
      "Updates the global IPv6 settings of the MikroTik device.\n\n" +
      "Notes:\n" +
      "    disable_ipv6: when true, IPv6 is turned off device-wide.\n" +
      "    forward: enable/disable IPv6 packet forwarding (routing).\n" +
      "    accept_redirects / accept_router_advertisements: 'yes', 'no', or\n" +
      "        'yes-if-forwarding-disabled' (the host-like default).",
    inputSchema: {
      disable_ipv6: z.boolean().optional(),
      forward: z.boolean().optional(),
      accept_redirects: AcceptMode.optional(),
      accept_router_advertisements: AcceptMode.optional(),
      max_neighbor_entries: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info("Updating IPv6 settings");
      const cmd = new Cmd("/ipv6 settings set")
        .bool("disable-ipv6", a.disable_ipv6)
        .bool("forward", a.forward)
        .opt("accept-redirects", a.accept_redirects)
        .opt("accept-router-advertisements", a.accept_router_advertisements)
        .opt("max-neighbor-entries", a.max_neighbor_entries);

      const built = cmd.build();
      if (built === "/ipv6 settings set") return "No updates specified.";

      const result = await executeMikrotikCommand(built, ctx);
      if (looksLikeError(result))
        return `Failed to update IPv6 settings: ${result}`;

      const details = await executeMikrotikCommand("/ipv6 settings print", ctx);
      return `IPv6 settings updated successfully:\n\n${details}`;
    },
  }),
];
