/**
 * Shared, pure firewall-chain analysis helpers over normalised {@link FirewallRule}
 * rows (produced by `rulesFromRows`). Kept separate so multiple tools can share
 * one definition of "where does the chain's default-deny sit" without each
 * re-deriving it.
 */
import type { FirewallRule } from "./firewall-audit";

const CATCH_ALL_ADDR = new Set(["0.0.0.0/0", "::/0"]);
const TERMINAL_DROP = new Set(["drop", "reject"]);

/**
 * True when a rule matches EVERY packet in its chain — no match conditions, or
 * only a catch-all address (`0.0.0.0/0` / `::/0`). Chain/action/admin fields are
 * already excluded from `rule.match` by the normaliser, so an empty `match` map
 * means "unconditional".
 */
export function ruleMatchesAll(rule: FirewallRule): boolean {
  for (const [k, v] of Object.entries(rule.match)) {
    if ((k === "src-address" || k === "dst-address") && CATCH_ALL_ADDR.has(v)) continue;
    return false;
  }
  return true;
}

/**
 * Find the chain's final unconditional `drop`/`reject` — its default-deny, if
 * any. Scans active (non-disabled, non-dynamic) rules and returns the LAST one
 * whose action is a terminal drop and which matches all traffic. Returns `null`
 * when the chain has no such catch-all drop.
 *
 * "Final" is by printed order: a later catch-all drop shadows an earlier one, so
 * the last is the operative default-deny and the correct anchor to insert BEFORE
 * (anything placed after it is dead code — the packet is already gone).
 */
export function findFinalUnconditionalDrop(rules: FirewallRule[]): FirewallRule | null {
  let found: FirewallRule | null = null;
  for (const r of rules) {
    if (r.disabled || r.dynamic) continue;
    if (TERMINAL_DROP.has(r.action) && ruleMatchesAll(r)) found = r;
  }
  return found;
}
