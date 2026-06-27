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
import { deviceSlug } from "../core/slug";
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

/** Comprehensive `/export` options shared by the tool and the dashboard. */
export interface ExportOptions {
  /** Filename label suffix, e.g. "pre-upgrade". */
  label?: string;
  /** Reveal secrets (keys/passwords). RouterOS `show-sensitive`. Default false. */
  showSensitive?: boolean;
  /** Include every parameter, even defaults. RouterOS `verbose`. */
  verbose?: boolean;
  /** Emit only non-default values. RouterOS `compact` (ignored if verbose). */
  compact?: boolean;
  /** One self-contained line per item (machine-readable). RouterOS `terse`. */
  terse?: boolean;
}

/** Build the `/export` command from {@link ExportOptions} (pure, unit-tested). */
export function buildExportCommand(opts: ExportOptions = {}): string {
  return (
    new Cmd("/export")
      // `verbose` wins over `compact` — RouterOS rejects both together.
      .raw(opts.verbose ? "verbose" : opts.compact ? "compact" : undefined)
      .raw(opts.terse ? "terse" : undefined)
      .raw(opts.showSensitive ? "show-sensitive" : undefined)
      .build()
  );
}

/**
 * Run `/export` on the device behind `ctx` and write it to the vault as
 * `<device-slug>_<datestamp>.rsc` (24-hour, device-local clock). The device name
 * is slugified (spaces/underscores/etc → dash) so the filename stays vault-safe.
 */
export async function createLocalBackup(
  ctx: ToolContext,
  opts: ExportOptions = {},
): Promise<CreateResult> {
  const device = resolveDeviceName(ctx.device);
  const body = await executeMikrotikCommand(buildExportCommand(opts), ctx);
  if (isEmpty(body) || looksLikeError(body)) {
    return { ok: false, device, error: body.trim() || "(empty export)" };
  }
  const stamp = await deviceDateStamp(ctx);
  const name = `${deviceSlug(device)}_${stamp}${labelSlug(opts.label)}.rsc`;
  return { ok: true, device, name: writeBackup(name, body), bytes: Buffer.byteLength(body) };
}
