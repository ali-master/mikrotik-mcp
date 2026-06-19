/**
 * Safe Mode tool wrappers — `/` Ctrl+X session.
 *
 * The heavy lifting lives in `ssh/safe-mode.ts`; these are thin tool faces over
 * the singleton manager so the model can open, commit, or roll back a
 * transactional configuration window.
 */
import { WRITE,  READ, defineTool } from "../core/registry";
import type {ToolModule} from "../core/registry";
import { getSafeModeManager } from "../ssh/safe-mode";

export const safeModeTools: ToolModule = [
  defineTool({
    name: "safe_mode_status",
    title: "Safe Mode Status",
    annotations: READ,
    description: "Returns whether MikroTik Safe Mode is currently active.",
    handler(_a, ctx) {
      ctx.info("Checking safe mode status");
      return getSafeModeManager().status();
    },
  }),

  defineTool({
    name: "enable_safe_mode",
    title: "Enable Safe Mode",
    annotations: WRITE,
    description:
      "Activates MikroTik Safe Mode; changes are held in memory and auto-reverted on disconnect until committed.",
    async handler(_a, ctx) {
      ctx.info("Enabling MikroTik safe mode");
      return getSafeModeManager().enable();
    },
  }),

  defineTool({
    name: "commit_safe_mode",
    title: "Commit Safe Mode",
    annotations: WRITE,
    description: "Commits all pending Safe Mode changes to persistent storage and exits Safe Mode.",
    async handler(_a, ctx) {
      ctx.info("Committing safe mode changes");
      return getSafeModeManager().commit();
    },
  }),

  defineTool({
    name: "rollback_safe_mode",
    title: "Rollback Safe Mode",
    annotations: WRITE,
    description:
      "Discards all pending Safe Mode changes by closing the SSH session, triggering automatic rollback.",
    async handler(_a, ctx) {
      ctx.info("Rolling back safe mode changes");
      return getSafeModeManager().rollback();
    },
  }),
];
