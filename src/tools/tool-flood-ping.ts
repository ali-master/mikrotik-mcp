/** Flood ping — `/tool flood-ping`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const floodPingTools: ToolModule = [
  defineTool({
    name: "flood_ping",
    title: "Flood Ping",
    annotations: READ,
    description:
      "Sends a burst of ICMP echo requests as fast as possible and reports " +
      "sent/received counts and min/avg/max round-trip times " +
      "(`/tool flood-ping`). The run is bounded by `count`, so it terminates " +
      "rather than streaming.",
    inputSchema: {
      address: z.string().describe("Target host or IP"),
      count: z
        .number()
        .int()
        .min(1)
        .max(1000000)
        .default(1000)
        .describe("Number of packets to send (bounds the run)"),
      size: z.number().int().optional().describe("Packet size in bytes"),
      interface: z.string().optional().describe("Outgoing interface"),
      src_address: z.string().optional().describe("Source address"),
    },
    async handler(a, ctx) {
      ctx.info(`Flood-pinging ${a.address} (count=${a.count})`);
      const cmd = new Cmd(`/tool flood-ping ${a.address}`)
        .set("count", a.count)
        .opt("size", a.size)
        .opt("interface", a.interface)
        .opt("src-address", a.src_address)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to flood-ping ${a.address}: ${result}`;
      return isEmpty(result)
        ? `No response from ${a.address}.`
        : `FLOOD PING ${a.address}:\n\n${result}`;
    },
  }),
];
