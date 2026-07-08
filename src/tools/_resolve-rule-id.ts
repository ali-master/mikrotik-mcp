/**
 * Shared rule-ID resolver for ordered RouterOS lists (firewall, mangle, etc.).
 *
 * A bare number like `"3"` is the positional row index shown in `print` output,
 * NOT an internal `.id` — RouterOS `.id` values are always `*`-prefixed hex
 * (`*3`, `*1F`), so a bare decimal can only mean a row.  We resolve it by
 * listing all `.id`s in order and picking by index.  (Trying `.id=*N` first
 * would wrongly match whichever stale rule happens to carry that internal id.)
 *
 * Returns `null` when the position is out of range or the id does not exist.
 */
import { executeMikrotikCommand } from "../core/connector";
import { isEmpty } from "../core/routeros";
import type { ToolContext } from "../core/context";

/**
 * Build a resolver for the `.id` of a rule in an ordered RouterOS list.
 *
 * @param scope  The RouterOS menu path, e.g. `/ip firewall nat`.
 * @returns An async function `(ruleId, ctx) => resolvedId | null`.
 */
export function ruleResolver(scope: string) {
  return async function resolveRuleId(ruleId: string, ctx: ToolContext): Promise<string | null> {
    if (/^\d+$/.test(ruleId)) {
      // Positional row index: iterate all .id values in order and pick by
      // index.  `:foreach` + `:put` lists one id per line.
      const idsRaw = await executeMikrotikCommand(
        `:foreach i in=[${scope} find] do={:put $i}`,
        ctx,
      );
      if (isEmpty(idsRaw)) return null;
      const ids = idsRaw
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const pos = Number.parseInt(ruleId, 10);
      return pos >= 0 && pos < ids.length ? ids[pos] : null;
    }

    // Already prefixed (e.g. `*1F`) — verify it exists.
    const count = await executeMikrotikCommand(
      `${scope} print count-only where .id=${ruleId}`,
      ctx,
    );
    return count.trim() !== "0" ? ruleId : null;
  };
}
