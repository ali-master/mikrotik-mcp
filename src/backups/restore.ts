/**
 * Restore a local vault backup onto a device by replaying its `/export` through
 * RouterOS Safe Mode — shared by the `restore_local_backup` tool and the
 * dashboard's Backups page so both behave identically (and both inherit Safe
 * Mode's auto-revert-on-disconnect lock-out protection).
 */
import { looksLikeError } from "../core/routeros";
import { getDevice } from "../core/runtime";
import { getSafeModeManager } from "../ssh/safe-mode";
import { exportToCommands, readBackup } from "./vault";

export interface RestoreResult {
  ok: boolean;
  message: string;
  /** Commands applied before completion/rollback. */
  applied: number;
  /** True only when the restore was committed (confirm=true and still reachable). */
  committed: boolean;
}

/**
 * Apply backup `name` to `device` in Safe Mode. With `confirm=false` it applies
 * then rolls back (dry-run); with `confirm=true` it commits only if the device
 * still answers afterwards (else it auto-reverts to avoid a lock-out).
 */
export async function restoreLocalBackup(
  device: string,
  name: string,
  confirm: boolean,
): Promise<RestoreResult> {
  const fail = (message: string, applied = 0): RestoreResult => ({
    ok: false,
    message,
    applied,
    committed: false,
  });

  if (getDevice(device).mac) {
    return fail(
      "Restore uses Safe Mode, which requires SSH; not available on a MAC-Telnet device.",
    );
  }
  let body: string;
  try {
    body = readBackup(name);
  } catch {
    return fail(`backup '${name}' not found`);
  }
  const commands = exportToCommands(body);
  if (commands.length === 0) return fail(`backup '${name}' contains no applicable commands`);

  const safe = getSafeModeManager(device);
  const enabled = await safe.enable();
  if (enabled.startsWith("Error")) return fail(enabled);

  try {
    let applied = 0;
    for (const command of commands) {
      const out = await safe.execute(command);
      if (looksLikeError(out)) {
        await safe.rollback();
        return fail(
          `failed at command ${applied + 1}/${commands.length} (rolled back): ${command} → ${out.trim()}`,
          applied,
        );
      }
      applied++;
    }
    const reachable = !looksLikeError(await safe.execute("/system identity print"));
    if (!confirm) {
      await safe.rollback();
      return {
        ok: true,
        applied,
        committed: false,
        message: `dry-run: applied ${applied}, rolled back`,
      };
    }
    if (!reachable) {
      await safe.rollback();
      return fail(
        "device stopped responding after applying — rolled back to avoid a lock-out",
        applied,
      );
    }
    const committed = await safe.commit();
    return {
      ok: true,
      applied,
      committed: true,
      message: `committed ${applied} command(s). ${committed}`,
    };
  } catch (e) {
    await safe.rollback();
    return fail(
      `restore failed and was rolled back: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
