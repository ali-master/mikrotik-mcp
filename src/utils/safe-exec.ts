/**
 * Error-suppressing command executor — returns `""` when the device reports an
 * error or the connection fails, so a multi-dimensional collector can skip one
 * dimension instead of aborting the whole batch.
 */
import { executeMikrotikCommand } from "../core/connector";
import type { ToolContext } from "../core/context";
import { looksLikeError } from "../core/routeros";

export async function safe(cmd: string, ctx: ToolContext): Promise<string> {
  try {
    const out = await executeMikrotikCommand(cmd, ctx);
    return looksLikeError(out) ? "" : out;
  } catch {
    return "";
  }
}
