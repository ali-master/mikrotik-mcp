/**
 * Raw RouterOS CLI — a single, always-discoverable dispatcher tool.
 *
 * With several hundred granular tools, an MCP host's tool search can struggle to
 * surface the one specific tool the model wants (selection accuracy falls off a
 * cliff past ~100 tools). This tool is the reliable escape hatch: ONE
 * distinctively-named primitive that runs any RouterOS command, so the model can
 * always accomplish a task even when it can't find the dedicated tool — the
 * "consolidation / dispatcher" pattern recommended for large tool catalogs.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError } from "../core/routeros";

export const rawCommandTools: ToolModule = [
  defineTool({
    name: "run_routeros_command",
    title: "Run a RouterOS Command (raw CLI)",
    annotations: WRITE,
    description:
      "Execute ANY single RouterOS / MikroTik CLI command on the device and return its console output — the " +
      "universal primitive to read or change anything when no dedicated tool fits, for uncommon or bulk " +
      "operations, or simply when you can't quickly find the specific tool among the catalog. " +
      "Pass the command EXACTLY as typed in the RouterOS terminal, e.g. " +
      "`/system identity set name=Router1`, " +
      "`/ip dns set servers=1.1.1.1,8.8.8.8 allow-remote-requests=yes`, " +
      "`/ip address print`, `/ip firewall filter print`, `/interface print`, `/ip service print`, " +
      "`/system resource print`. " +
      "Works for reads (`… print`) and writes (`… set` / `add` / `remove`). Runs one command per call — " +
      "call again with a `… print` to verify a change. Prefer a dedicated tool when you know its name " +
      "(better validation and structured output); use this whenever discovery is the bottleneck. " +
      "WARNING: the command is run as-is and is NOT validated — it can be destructive (e.g. " +
      "`/system reset-configuration`, removing the management address), so review it before running. " +
      "For a stored multi-command script use add_script then run_script.",
    inputSchema: {
      command: z
        .string()
        .describe("Full RouterOS CLI command exactly as typed, e.g. '/ip address print'"),
    },
    async handler(a, ctx) {
      const cmd = a.command.trim();
      if (!cmd) return "Provide a RouterOS command to run.";
      ctx.info(`Running raw RouterOS command: ${cmd}`);
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `RouterOS command error: ${result}`;
      return result.trim() ? result : "(command completed with no output)";
    },
  }),
];
