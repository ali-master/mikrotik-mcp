/**
 * Change Plan & Dry-Run — `plan_changes` + `apply_plan`.
 *
 * `plan_changes` is a read-only "terraform plan": it parses the intended
 * RouterOS commands and returns a risk-scored, lock-out-aware, safely-ordered
 * plan WITHOUT touching the device.
 *
 * `apply_plan` executes that plan inside RouterOS **Safe Mode** (every change is
 * held in memory and auto-reverts on disconnect). It captures `/export terse`
 * before and after, returns the exact diff (via the snapshot diff engine), and
 * then either commits — but only if the device is still reachable, so a lock-out
 * auto-reverts instead of sticking — or rolls back when `confirm` is false (a
 * true dry-run that shows precisely what would change).
 */
import { z } from "zod";
import { buildChangePlan, renderPlan, splitCommands } from "../core/change-plan";
import { diffLines } from "../core/diff";
import { DANGEROUS, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError } from "../core/routeros";
import { getDevice, resolveDeviceName } from "../core/runtime";
import { normalizeExport } from "../snapshots/format";
import { getSafeModeManager } from "../ssh/safe-mode";

/** Accept commands as an array and/or a newline-delimited script. */
function collectCommands(a: { commands?: string[]; script?: string }): string[] {
  const fromArray = (a.commands ?? []).map((c) => c.trim()).filter(Boolean);
  const fromScript = a.script ? splitCommands(a.script) : [];
  return [...fromArray, ...fromScript];
}

export const changePlanTools: ToolModule = [
  defineTool({
    name: "plan_changes",
    title: "Plan Changes (Dry-Run)",
    annotations: READ,
    description:
      "Previews a set of intended RouterOS commands WITHOUT touching the device — a 'terraform " +
      "plan'. Returns ADD/MODIFY/REMOVE counts, a risk score, lock-out warnings (e.g. an " +
      "input-chain drop or removing your management IP), and the steps reordered into a safe " +
      "sequence (additive changes before destructive ones). Feed the same commands to apply_plan " +
      "to execute them under Safe Mode. Provide commands as an array and/or a newline script.",
    inputSchema: {
      commands: z.array(z.string()).optional().describe("Intended RouterOS CLI commands."),
      script: z
        .string()
        .optional()
        .describe("Newline-delimited commands (alternative to `commands`)."),
    },
    async handler(a) {
      const commands = collectCommands(a);
      if (commands.length === 0) return "No commands provided to plan.";
      const plan = buildChangePlan(commands);
      return {
        text: renderPlan(plan),
        structuredContent: plan as unknown as Record<string, unknown>,
      };
    },
  }),

  defineTool({
    name: "apply_plan",
    title: "Apply Plan (Safe Mode)",
    annotations: DANGEROUS,
    description:
      "Executes intended RouterOS commands inside Safe Mode and reports the EXACT `/export` diff. " +
      "With confirm=false (default) it applies, shows the diff, then rolls everything back — a true " +
      "dry-run. With confirm=true it commits, but ONLY after verifying the device is still reachable, " +
      "so a change that would lock you out auto-reverts instead. Steps run in the safe order from " +
      "plan_changes. Safe Mode requires SSH (not available on MAC-Telnet devices).",
    inputSchema: {
      commands: z.array(z.string()).optional(),
      script: z.string().optional(),
      confirm: z
        .boolean()
        .default(false)
        .describe(
          "false = apply, show diff, roll back (dry-run). true = commit if still reachable.",
        ),
    },
    async handler(a, ctx) {
      const commands = collectCommands(a);
      if (commands.length === 0) return "No commands provided to apply.";

      const device = resolveDeviceName(ctx.device);
      if (getDevice(ctx.device).mac) {
        return "Safe Mode (and therefore apply_plan) requires SSH; it is not available on a MAC-Telnet device.";
      }

      const plan = buildChangePlan(commands);
      const safe = getSafeModeManager(device);

      const enabled = await safe.enable();
      if (enabled.startsWith("Error")) return enabled;

      try {
        const before = normalizeExport(await safe.execute("/export terse"));

        const log: string[] = [];
        for (const step of plan.steps) {
          const out = await safe.execute(step.command);
          if (looksLikeError(out)) {
            await safe.rollback();
            return (
              `Step ${step.index} failed and the plan was ROLLED BACK (nothing committed):\n` +
              `  ${step.command}\n  → ${out.trim()}`
            );
          }
          log.push(`  ✓ ${step.command}`);
        }

        const after = normalizeExport(await safe.execute("/export terse"));
        const diff = diffLines(before, after, { fromLabel: "before", toLabel: "after" });

        // Reachability gate: if the device still answers, committing is safe.
        const reachable = !looksLikeError(await safe.execute("/system identity print"));

        const planBody = renderPlan(plan).split("\n").slice(2).join("\n");
        const header =
          `APPLY PLAN — ${device}\n\n${planBody}\n\n` +
          `Executed ${plan.steps.length} step(s) in Safe Mode:\n${log.join("\n")}\n\n` +
          `EXACT DIFF (+${diff.summary.added}/-${diff.summary.removed}):\n${diff.unified || "(no config change)"}`;

        if (!a.confirm) {
          await safe.rollback();
          return `${header}\n\nDRY-RUN: all changes rolled back. Re-run with confirm=true to commit.`;
        }
        if (!reachable) {
          await safe.rollback();
          return `${header}\n\nABORTED: the device stopped responding after applying — changes rolled back to avoid a lock-out.`;
        }
        const committed = await safe.commit();
        return `${header}\n\nCOMMITTED: changes are now permanent. ${committed}`;
      } catch (e) {
        await safe.rollback();
        const msg = e instanceof Error ? e.message : String(e);
        return `apply_plan failed and was rolled back: ${msg}`;
      }
    },
  }),
];
