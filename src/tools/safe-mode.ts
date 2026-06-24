/**
 * Safe Mode tool wrappers — `/` Ctrl+X session.
 *
 * The heavy lifting lives in `ssh/safe-mode.ts`; these are thin tool faces over
 * the per-device managers so the model can open, commit, or roll back a
 * transactional configuration window on a chosen router.
 */
import type { ToolModule } from "../core/registry";
import { WRITE, READ, defineTool } from "../core/registry";
import { resolveDeviceName } from "../core/runtime";
import { getSafeModeManager } from "../ssh/safe-mode";

export const safeModeTools: ToolModule = [
  defineTool({
    name: "safe_mode_status",
    title: "Get Safe Mode Session Status",
    annotations: READ,
    description:
      "Queries the Safe Mode SSH session state for the targeted device — reports whether a Safe Mode window is currently open (active) or closed." +
      " Safe Mode (RouterOS Ctrl+X) stages all configuration changes in memory for automatic revert on disconnect; this tool does not modify any state." +
      " Returns a status string indicating whether Safe Mode is currently active." +
      " Use enable_safe_mode to open a session, commit_safe_mode to persist staged changes, or rollback_safe_mode to discard them.",
    handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] Checking safe mode status`);
      return getSafeModeManager(device).status();
    },
  }),

  defineTool({
    name: "enable_safe_mode",
    title: "Enable Safe Mode Session",
    annotations: WRITE,
    description:
      "Opens a Safe Mode SSH session on the targeted device (RouterOS Ctrl+X equivalent) — all subsequent configuration changes are staged in memory and auto-reverted if the SSH connection drops before an explicit commit." +
      " Use this to make reversible, transactional configuration changes without risk of permanent misconfiguration." +
      " Safe Mode is SSH-only and is not supported over MAC-Telnet connections." +
      " Check current state first with safe_mode_status; persist staged changes with commit_safe_mode; discard staged changes without saving with rollback_safe_mode.",
    async handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] Enabling MikroTik safe mode`);
      return getSafeModeManager(device).enable();
    },
  }),

  defineTool({
    name: "commit_safe_mode",
    title: "Commit Safe Mode Changes",
    annotations: WRITE,
    description:
      "Commits all pending Safe Mode changes on the targeted device to persistent flash storage and exits the Safe Mode session — equivalent to pressing Ctrl+X a second time to confirm in a RouterOS terminal." +
      " Use this after enable_safe_mode once staged changes have been verified as correct." +
      " To discard staged changes instead of persisting them, use rollback_safe_mode." +
      " Check whether Safe Mode is currently active with safe_mode_status.",
    async handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] Committing safe mode changes`);
      return getSafeModeManager(device).commit();
    },
  }),

  defineTool({
    name: "rollback_safe_mode",
    title: "Roll Back Safe Mode Changes",
    annotations: WRITE,
    description:
      "Discards all pending Safe Mode changes on the targeted device by closing the SSH session, triggering RouterOS's automatic revert — all configuration changes staged since enable_safe_mode was called are undone as if they were never applied." +
      " Use this when staged changes are incorrect or need to be abandoned without saving." +
      " To persist staged changes instead, use commit_safe_mode." +
      " Check current Safe Mode state with safe_mode_status.",
    async handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] Rolling back safe mode changes`);
      return getSafeModeManager(device).rollback();
    },
  }),
];
