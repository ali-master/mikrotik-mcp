/**
 * Device disk-space check for the backup tools.
 *
 * Before writing a file to the device, the backup handlers call
 * {@link checkDiskSpace} to decide whether to redirect the output to the local
 * vault instead. The check is **fail-open**: if `/system resource print` fails
 * or returns unparseable data, `low` is `false` — a broken diagnostic should
 * never block a backup attempt (the device will report its own error when truly
 * out of space).
 */
import type { ToolContext } from "../core/context";
import { executeMikrotikCommand } from "../core/connector";
import { parseSystemResource } from "../core/routeros-parse";

/** Disk usage above this percentage triggers the local-vault redirect. */
export const DISK_THRESHOLD_PCT = 90;

export interface DiskCheck {
  /** True when device disk usage is at or above the threshold. */
  low: boolean;
  /** Used percentage 0–100, or undefined if the device didn't report metrics. */
  usedPct?: number;
  /** Free bytes, or undefined if unknown. */
  freeBytes?: number;
  /** Total bytes, or undefined if unknown. */
  totalBytes?: number;
}

/**
 * Query the device's disk usage via `/system resource print`.
 *
 * Returns `{ low: false }` when the check itself fails (unparseable output,
 * connection error caught upstream, missing fields) — fail-open so a broken
 * resource response never prevents a backup.
 */
export async function checkDiskSpace(ctx: ToolContext): Promise<DiskCheck> {
  try {
    const raw = await executeMikrotikCommand("/system resource print", ctx);
    const sys = parseSystemResource(raw);
    if (!sys || sys.hddUsedPct == null) {
      return { low: false };
    }
    return {
      low: sys.hddUsedPct >= DISK_THRESHOLD_PCT,
      usedPct: sys.hddUsedPct,
      freeBytes: sys.freeHdd,
      totalBytes: sys.totalHdd,
    };
  } catch {
    // Connection or parse failure — fail open.
    return { low: false };
  }
}
