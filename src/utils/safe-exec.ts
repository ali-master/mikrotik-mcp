/**
 * Error-suppressing command executor — returns `""` when the device reports an
 * error or the connection fails, so a multi-dimensional collector can skip one
 * dimension instead of aborting the whole batch.
 */
import { executeMikrotikCommand } from "../core/connector";
import type { ToolContext } from "../core/context";
import { looksLikeError } from "../core/routeros";
import { parseKeyValues, parseRecords } from "../core/routeros-parse";

export async function safe(cmd: string, ctx: ToolContext): Promise<string> {
  try {
    const out = await executeMikrotikCommand(cmd, ctx);
    return looksLikeError(out) ? "" : out;
  } catch {
    return "";
  }
}

/**
 * Run a multi-record `print`/`print detail` and return its parsed rows,
 * error-suppressed — an unreadable path (missing subsystem, device error) yields
 * `[]` rather than throwing, so a batch collector can carry on.
 */
export async function fetchRows(cmd: string, ctx: ToolContext): Promise<Record<string, string>[]> {
  const out = await safe(cmd, ctx);
  return out ? parseRecords(out).rows : [];
}

/**
 * Run a singleton `print` and return it as a `key → value` map, error-suppressed
 * (an unreadable path yields `{}`).
 */
export async function fetchKv(cmd: string, ctx: ToolContext): Promise<Record<string, string>> {
  const out = await safe(cmd, ctx);
  return out ? parseKeyValues(out) : {};
}
