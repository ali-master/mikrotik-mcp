/** Wake-on-LAN — `/tool wol`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, Cmd } from "../core/routeros";

export const wolTools: ToolModule = [
  defineTool({
    name: "wake_on_lan",
    title: "Wake-on-LAN",
    annotations: WRITE,
    description:
      "Sends a Wake-on-LAN magic packet to wake a host by MAC address " +
      "(`/tool wol`).",
    inputSchema: {
      mac: z
        .string()
        .describe("Target MAC address, e.g. 'AA:BB:CC:DD:EE:FF'"),
      interface: z
        .string()
        .optional()
        .describe("Interface to send the magic packet from"),
    },
    async handler(a, ctx) {
      ctx.info(`Sending Wake-on-LAN to ${a.mac}`);
      const cmd = new Cmd("/tool wol")
        .set("mac", a.mac)
        .opt("interface", a.interface)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to send Wake-on-LAN to ${a.mac}: ${result}`;
      return `Wake-on-LAN magic packet sent to ${a.mac}.`;
    },
  }),
];
