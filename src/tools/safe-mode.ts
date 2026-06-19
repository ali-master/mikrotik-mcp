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
    title: "Safe Mode Status",
    annotations: READ,
    description: "Returns whether MikroTik Safe Mode is currently active (for the targeted device).",
    handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] Checking safe mode status`);
      return getSafeModeManager(device).status();
    },
  }),

  defineTool({
    name: "enable_safe_mode",
    title: "Enable Safe Mode",
    annotations: WRITE,
    description:
      "Activates MikroTik Safe Mode on the targeted device; changes are held in memory and auto-reverted on disconnect until committed.",
    async handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] Enabling MikroTik safe mode`);
      return getSafeModeManager(device).enable();
    },
  }),

  defineTool({
    name: "commit_safe_mode",
    title: "Commit Safe Mode",
    annotations: WRITE,
    description:
      "Commits all pending Safe Mode changes on the targeted device to persistent storage and exits Safe Mode.",
    async handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] Committing safe mode changes`);
      return getSafeModeManager(device).commit();
    },
  }),

  defineTool({
    name: "rollback_safe_mode",
    title: "Rollback Safe Mode",
    annotations: WRITE,
    description:
      "Discards all pending Safe Mode changes on the targeted device by closing the SSH session, triggering automatic rollback.",
    async handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] Rolling back safe mode changes`);
      return getSafeModeManager(device).rollback();
    },
  }),
];
