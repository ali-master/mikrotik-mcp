/**
 * Raw RouterOS CLI — last-resort fallback when `find_tools` returns nothing.
 *
 * Models should ALWAYS try `find_tools` → `invoke_tool` first: dedicated tools
 * have schema validation, structured output, and correct risk annotations.
 * This raw escape hatch skips all of that and runs an unvalidated CLI string,
 * so it should only fire when the gateway search genuinely found no match.
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
      "⚠️ LAST RESORT — do NOT call this tool directly. ALWAYS call `find_tools` first to locate the " +
      "dedicated tool for your task, then run it via `invoke_tool`. Dedicated tools provide schema " +
      "validation, structured output, and accurate risk annotations that this raw command lacks. " +
      "Only use this tool when `find_tools` returned zero results for your query AND you are certain " +
      "no dedicated tool exists.\n\n" +
      "When you do use it: pass one RouterOS CLI command exactly as typed in the terminal. " +
      "The command is executed as-is with NO validation — it can be destructive, so review carefully. " +
      "Runs one command per call; call again with `… print` to verify a change. " +
      "For multi-command scripts use add_script + run_script instead.",
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
