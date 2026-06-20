/** CPU profiler — `/tool profile`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const profileTools: ToolModule = [
  defineTool({
    name: "profile_cpu",
    title: "Profile CPU",
    annotations: READ,
    description:
      "Profiles CPU usage by process/classifier over a bounded sampling " +
      "window, showing which subsystems consume CPU (`/tool profile`). The " +
      "run is bounded by `duration`, so it terminates rather than streaming.",
    inputSchema: {
      duration: z
        .number()
        .int()
        .min(1)
        .default(5)
        .describe("Sampling duration in seconds (bounds the run)"),
      cpu: z
        .string()
        .optional()
        .describe("Limit to a specific CPU core (e.g. '0'), or 'all'"),
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
