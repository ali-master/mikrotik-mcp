/**
 * Small, reusable RouterOS firewall/address-list read helpers.
 *
 * Fetch-and-parse utilities shared by any tool that needs a filter chain's rules,
 * an address-list's size, or a chain's ordered internal `.id`s. Device reads only.
 */
import { executeMikrotikCommand } from "../core/connector";
import type { ToolContext } from "../core/context";
import { rulesFromRows } from "../core/firewall-audit";
import type { FirewallRule } from "../core/firewall-audit";
import { isEmpty } from "../core/routeros";
import { fetchRows } from "./safe-exec";

/** Fetch a `/ip firewall filter` chain's rules, parsed and normalised (empty on error). */
export async function fetchFilterChainRules(
  chain: string,
  ctx: ToolContext,
): Promise<FirewallRule[]> {
  const rows = await fetchRows(`/ip firewall filter print detail where chain=${chain}`, ctx);
  return rulesFromRows(rows);
}

/** Count entries currently in an `/ip firewall address-list` list. */
export async function addressListCount(list: string, ctx: ToolContext): Promise<number> {
  const raw = await executeMikrotikCommand(
    `/ip firewall address-list print count-only where list=${JSON.stringify(list)}`,
    ctx,
  );
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Ordered internal `.id`s of a `/ip firewall filter` chain, in the same order a
 * chain-filtered `print` shows them. Use this to map a rule's array position to a
 * real `.id` for a `place-before` (a chain-filtered print renumbers rows, so the
 * printed ordinal can't be used directly).
 */
export async function filterChainRuleIds(chain: string, ctx: ToolContext): Promise<string[]> {
  const raw = await executeMikrotikCommand(
    `:foreach i in=[/ip firewall filter find chain=${chain}] do={:put $i}`,
    ctx,
  );
  if (isEmpty(raw)) return [];
  return raw
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\*[0-9A-Fa-f]+$/.test(l));
}
