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
    title: "Plan RouterOS Changes (Dry-Run Preview)",
    annotations: READ,
    description:
      "Parses a set of intended RouterOS CLI commands locally — without contacting the device — " +
      "and returns a risk-scored, lock-out-aware execution plan. Classifies each command as " +
      "ADD/MODIFY/REMOVE/OTHER, calculates an overall risk score, emits warnings when commands would " +
      "drop input-chain traffic or remove the management IP, and reorders steps into the safest " +
      "sequence (additive changes before destructive ones). Use this to understand what will " +
      "happen before committing; to execute the plan use apply_plan. Provide commands as an " +
      "array via `commands`, as a newline-delimited string via `script`, or both — they are " +
      "merged. Before planning a change, FIRST call capture_config_snapshot to take a restore " +
      "point — it stores a local `/export` on the MCP host (~/.mikrotik-mcp/snapshots.db) with " +
      "zero footprint on the device's disk (no file is written to the router). " +
      "Returns a human-readable plan text and a structured plan object with per-step details.",
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
    title: "Apply RouterOS Change Plan in Safe Mode",
    annotations: DANGEROUS,
    description:
      "Executes intended RouterOS commands inside RouterOS Safe Mode (activated by Ctrl+X over " +
      "an interactive SSH shell) and reports the exact unified diff of what changed, computed " +
      "from `/export terse` snapshots captured before and after execution. With confirm=false " +
      "(default) it applies all steps, captures the diff, then rolls everything back — a true " +
      "dry-run that shows precisely what would change without persisting anything. With " +
      "confirm=true it commits permanently, but ONLY after verifying the device still responds " +
      "to `/system identity print` — a change that would lock you out auto-reverts instead of " +
      "sticking. Steps execute in the same safe order that plan_changes computes (additive before " +
      "destructive); if any step returns a RouterOS error the entire plan rolls back immediately. " +
      "Safe Mode requires SSH — not available on MAC-Telnet devices. For a no-device preview " +
      "use plan_changes instead. ALWAYS call capture_config_snapshot BEFORE this tool to record " +
      "a restore point — it stores a local `/export` on the MCP host (~/.mikrotik-mcp/snapshots.db), " +
      "adding no load to the device's disk and leaving nothing to remove on the router; after the " +
      "change, diff_config_snapshots (from=latest, to=live) confirms what changed. Returns the " +
      "plan summary, per-step execution log, unified diff, and commit/rollback outcome.",
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
        if (!committed.ok) {
          // Commit did NOT take — the changes are still pending in Safe Mode and
          // will revert if the session drops. Report honestly; never claim
          // "committed". The session is left open so the caller can retry
          // commit_safe_mode or rollback_safe_mode.
          return (
            `${header}\n\nCOMMIT FAILED — changes are NOT saved (still pending in Safe Mode). ` +
            `${committed.message}`
          );
        }
        return `${header}\n\nCOMMITTED: changes are now permanent. ${committed.message}`;
      } catch (e) {
        await safe.rollback();
        const msg = e instanceof Error ? e.message : String(e);
        return `apply_plan failed and was rolled back: ${msg}`;
      }
    },
  }),
];
