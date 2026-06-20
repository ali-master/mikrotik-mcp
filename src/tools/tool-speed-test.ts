/** Speed test — `/tool speed-test`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const speedTestTools: ToolModule = [
  defineTool({
    name: "speed_test",
    title: "Speed Test",
    annotations: READ,
    description:
      "Runs a latency and throughput test to another reachable RouterOS device " +
      "(`/tool speed-test`). The run is bounded by `duration`, so it terminates " +
      "rather than streaming.",
    inputSchema: {
      address: z.string().describe("Target RouterOS device address"),
      duration: z
        .number()
        .int()
        .min(1)
        .default(10)
        .describe("Test duration in seconds (bounds the run)"),
      direction: z.enum(["receive", "transmit", "both"]).default("both"),
      tcp_connection_count: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Parallel TCP connections to use"),
      user: z.string().optional().describe("Username for the target device"),
      password: z.string().optional().describe("Password for the target device"),
    },
    async handler(a, ctx) {
      ctx.info(
        `Speed test to ${a.address} (duration=${a.duration}s, direction=${a.direction})`,
      );
      const cmd = new Cmd(`/tool speed-test address=${a.address}`)
        .set("duration", `${a.duration}s`)
        .set("direction", a.direction)
        .opt("tcp-connection-count", a.tcp_connection_count)
        .opt("user", a.user)
        .opt("password", a.password)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result))
        return `Failed to run speed test to ${a.address}: ${result}`;
      return isEmpty(result)
        ? `No speed-test results for ${a.address}.`
        : `SPEED TEST:\n\n${result}`;
    },
  }),
];
