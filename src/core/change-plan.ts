/**
 * Change-plan engine — a "terraform plan" for RouterOS.
 *
 * Pure analysis over a list of intended RouterOS CLI commands (no device I/O, so
 * it's unit-tested directly). For each command it works out the target path and
 * the operation (add/set/remove/enable/disable/…), scores its risk, flags the
 * ones that could lock you out of the device, and — crucially — **reorders the
 * steps into a survivable sequence**: additive steps that establish a new path
 * (add an accept rule, add the new management IP, enable a service) run BEFORE
 * the destructive ones that tear the old path down (drop, remove, disable,
 * reset). The result is a reviewable plan with ADD/MODIFY/REMOVE counts that the
 * `apply_plan` tool then executes inside a Safe-Mode window.
 */

export type Severity = "high" | "medium" | "low";
export type ChangeOp = "add" | "set" | "remove" | "enable" | "disable" | "move" | "other";

export interface PlannedStep {
  /** 1-based position in the ORIGINAL command list. */
  index: number;
  command: string;
  /** RouterOS menu path the command targets, e.g. `/ip firewall filter`. */
  path: string;
  op: ChangeOp;
  risk: Severity;
  /** One-line human description. */
  summary: string;
  /** Set when the step could sever your own management access. */
  lockoutRisk?: string;
}

export interface ChangePlan {
  /** Steps in the SAFE execution order (additive first, destructive last). */
  steps: PlannedStep[];
  counts: { add: number; modify: number; remove: number; other: number; total: number };
  riskScore: number;
  grade: string;
  /** Lock-out hazards and ordering notes for the reviewer. */
  warnings: string[];
  /** True when the safe order differs from the order given. */
  reordered: boolean;
}

const VERBS: Record<string, ChangeOp> = {
  add: "add",
  set: "set",
  remove: "remove",
  enable: "enable",
  disable: "disable",
  move: "move",
  unset: "set",
  comment: "set",
};

const WEIGHT: Record<Severity, number> = { high: 20, medium: 8, low: 2 };

/** Split a `script`/command blob into individual commands (one per non-blank line). */
export function splitCommands(input: string): string[] {
  return input
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** Parse a RouterOS command into `{ path, op, args }`. */
function parseCommand(command: string): { path: string; op: ChangeOp; args: string } {
  // Normalise the `/ip/firewall/filter` slash form to the spaced menu form.
  const tokens = command.trim().replace(/^\//, "").split(/\s+/);
  let verbIdx = -1;
  let op: ChangeOp = "other";
  for (let i = 0; i < tokens.length; i++) {
    const v = VERBS[tokens[i]];
    if (v) {
      verbIdx = i;
      op = v;
      break;
    }
  }
  const pathTokens = (verbIdx === -1 ? tokens : tokens.slice(0, verbIdx))
    .join(" ")
    .replace(/\//g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const path = `/${pathTokens.join(" ")}`;
  const args = verbIdx === -1 ? "" : tokens.slice(verbIdx + 1).join(" ");
  // A bare path with no recognised verb but a dangerous tail (reset/reboot/…).
  if (
    op === "other" &&
    /reset-configuration|factory-reset|\breset\b|reboot|shutdown/i.test(command)
  ) {
    op = "other";
  }
  return { path, op, args };
}

const has = (s: string, re: RegExp): boolean => re.test(s);

/** Classify a command's risk and any lock-out hazard. */
function assess(
  path: string,
  op: ChangeOp,
  args: string,
  command: string,
): { risk: Severity; lockout?: string } {
  const p = path.toLowerCase();
  const isInputDrop =
    op === "add" &&
    has(p, /firewall filter/) &&
    has(args, /chain=input/) &&
    has(args, /action=(drop|reject)/);

  // ── lock-out hazards (sever your own management access) ──
  if (has(command, /reset-configuration|factory-reset/i)) {
    return {
      risk: "high",
      lockout: "factory reset wipes all config — you will lose access until re-provisioned",
    };
  }
  if ((op === "remove" || op === "disable") && has(p, /ip address/)) {
    return { risk: "high", lockout: "may remove/disable the IP you manage this device on" };
  }
  if (has(p, /ip service/) && (op === "disable" || has(args, /disabled=yes/))) {
    return {
      risk: "high",
      lockout: "may disable a management service (ssh/api/www) you connect through",
    };
  }
  if (isInputDrop) {
    return {
      risk: "high",
      lockout:
        "adds an input-chain drop — your management traffic must be accepted by an earlier rule",
    };
  }
  if ((op === "remove" || op === "disable") && has(p, /^\/user(\s|$)/)) {
    return { risk: "high", lockout: "may remove/disable the account you authenticate with" };
  }
  if (op === "disable" && has(p, /interface/)) {
    return { risk: "high", lockout: "may disable the interface you reach this device on" };
  }

  // ── plain risk (no lock-out) ──
  if (op === "remove")
    return { risk: has(p, /firewall|route|ip address|ip service/) ? "high" : "medium" };
  if (op === "other") return { risk: has(command, /reboot|shutdown/i) ? "high" : "medium" };
  if (op === "set" || op === "move") return { risk: "medium" };
  if (op === "disable") return { risk: "medium" };
  return { risk: "low" }; // add / enable
}

/** Execution-order group: additive (0) → neutral (1) → destructive (2). */
function orderGroup(step: PlannedStep, args: string): 0 | 1 | 2 {
  const p = step.path.toLowerCase();
  if (step.op === "remove" || step.op === "disable") return 2;
  if (step.op === "other") return 2; // resets/reboots last
  if (step.op === "add" && has(p, /firewall/) && has(args, /action=(drop|reject)/)) return 2;
  if (step.op === "add" || step.op === "enable") return 0; // establish the new path first
  return 1; // set / move
}

function grade(score: number): string {
  if (score === 0) return "no-op";
  if (score < 15) return "low";
  if (score < 40) return "moderate";
  if (score < 75) return "high";
  return "critical";
}

/** Build a reviewable, safely-ordered change plan from intended commands. */
export function buildChangePlan(commands: string[]): ChangePlan {
  const parsed = commands
    .map((c) => c.trim())
    .filter(Boolean)
    .map((command, i) => {
      const { path, op, args } = parseCommand(command);
      const { risk, lockout } = assess(path, op, args, command);
      const step: PlannedStep = {
        index: i + 1,
        command,
        path,
        op,
        risk,
        summary: `${op.toUpperCase()} ${path}`.trim(),
        lockoutRisk: lockout,
      };
      return { step, args, group: 0 as 0 | 1 | 2 };
    });
  for (const entry of parsed) entry.group = orderGroup(entry.step, entry.args);

  // Stable sort into the survivable order; remember if it actually moved.
  const ordered = [...parsed].sort((a, b) => a.group - b.group || a.step.index - b.step.index);
  const reordered = ordered.some((entry, i) => entry.step.index !== parsed[i]?.step.index);

  const steps = ordered.map((e) => e.step);
  const counts = { add: 0, modify: 0, remove: 0, other: 0, total: steps.length };
  let raw = 0;
  const warnings: string[] = [];
  for (const s of steps) {
    if (s.op === "add") counts.add++;
    else if (s.op === "remove") counts.remove++;
    else if (s.op === "other") counts.other++;
    else counts.modify++; // set/enable/disable/move
    raw += WEIGHT[s.risk];
    if (s.lockoutRisk) warnings.push(`Step ${s.index} (${s.command}): ${s.lockoutRisk}.`);
  }
  if (reordered) {
    warnings.unshift(
      "Steps were reordered into a safe sequence: additive changes (add/enable) run before destructive ones (remove/disable/drop) so a new management path is established before the old one is torn down.",
    );
  }

  const riskScore = Math.min(100, raw);
  return { steps, counts, riskScore, grade: grade(riskScore), warnings, reordered };
}

/** A terraform-style plain-text rendering of a plan. */
export function renderPlan(plan: ChangePlan): string {
  const other = plan.counts.other ? `, ${plan.counts.other} other` : "";
  const reorder = plan.reordered ? " · reordered for safety" : "";
  const head =
    `CHANGE PLAN\n\nPlan: +${plan.counts.add} to add, ~${plan.counts.modify} to modify, ` +
    `-${plan.counts.remove} to remove${other}\nRisk: ${plan.riskScore}/100 (${plan.grade})${reorder}\n`;
  const sign: Record<ChangeOp, string> = {
    add: "+",
    set: "~",
    enable: "~",
    disable: "~",
    move: "~",
    remove: "-",
    other: "!",
  };
  const body = plan.steps
    .map(
      (s) => `  ${sign[s.op]} [${s.risk}] ${s.command}${s.lockoutRisk ? "   ⚠ lock-out risk" : ""}`,
    )
    .join("\n");
  const warn = plan.warnings.length
    ? `\n\nWARNINGS:\n${plan.warnings.map((w) => `  • ${w}`).join("\n")}`
    : "";
  return `${head}\n${body}${warn}`;
}
