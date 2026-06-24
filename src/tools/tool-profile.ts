/** CPU profiler — `/tool profile`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const profileTools: ToolModule = [
  defineTool({
    name: "profile_cpu",
    title: "Sample CPU Usage by Process",
    annotations: READ,
    description:
      "Sample CPU usage by RouterOS process/classifier over a bounded window (`/tool profile`) — " +
      "identifies which subsystem (firewall, routing, wireless, bridging, etc.) is consuming CPU during " +
      "a spike or slowdown. Runs for exactly `duration` seconds then returns; it is a one-shot sample, " +
      "not a streaming monitor. " +
      "This tool measures CPU load breakdown across internal RouterOS classifiers; for throughput " +
      "measurement between endpoints use `bandwidth_test` instead. " +
      "Optionally scope the sample to a single core via `cpu` (e.g. '0'); omit or pass 'all' for " +
      "aggregate totals across all cores. " +
      "Returns a table of process names with their CPU-time percentage for the sampling window.",
    inputSchema: {
      duration: z
        .number()
        .int()
        .min(1)
        .default(5)
        .describe("Sampling duration in seconds (bounds the run)"),
      cpu: z.string().optional().describe("Limit to a specific CPU core (e.g. '0'), or 'all'"),
    },
    async handler(a, ctx) {
      ctx.info(`Profiling CPU (duration=${a.duration}s)`);
      const cmd = new Cmd("/tool profile")
        .set("duration", `${a.duration}s`)
        .opt("cpu", a.cpu)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to profile CPU: ${result}`;
      return isEmpty(result)
        ? "CPU profiling completed; no data returned."
        : `CPU PROFILE:\n\n${result}`;
    },
  }),
];
