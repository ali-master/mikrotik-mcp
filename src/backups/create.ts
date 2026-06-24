/**
 * Capture a device's `/export` and save it to the local backup vault — shared by
 * the `create_local_backup` tool and the dashboard's "Create backup" action so
 * both produce identically-named, identically-stamped files.
 */
import type { ToolContext } from "../core/context";
import { executeMikrotikCommand } from "../core/connector";
import { deviceDateStamp } from "../core/datestamp";
import { Cmd, isEmpty, looksLikeError } from "../core/routeros";
import { resolveDeviceName } from "../core/runtime";
import { writeBackup } from "./vault";

export interface CreateResult {
  ok: boolean;
  name?: string;
  bytes?: number;
  device?: string;
  error?: string;
}

/** Slugify a user label into a filename-safe fragment (empty string when blank). */
function labelSlug(label: string | undefined): string {
  const s = (label ?? "")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s ? `_${s}` : "";
}

/**
 * Run `/export` on the device behind `ctx` and write it to the vault as
 * `<device>_<datestamp>.rsc` (24-hour, device-local clock).
 */
export async function createLocalBackup(
  ctx: ToolContext,
  opts: { label?: string; showSensitive?: boolean } = {},
): Promise<CreateResult> {
  const device = resolveDeviceName(ctx.device);
  const cmd = new Cmd("/export").raw(opts.showSensitive ? "show-sensitive" : undefined).build();
  const body = await executeMikrotikCommand(cmd, ctx);
  if (isEmpty(body) || looksLikeError(body)) {
    return { ok: false, device, error: body.trim() || "(empty export)" };
  }
  const stamp = await deviceDateStamp(ctx);
  const name = `${device}_${stamp}${labelSlug(opts.label)}.rsc`;
  return { ok: true, device, name: writeBackup(name, body), bytes: Buffer.byteLength(body) };
}
