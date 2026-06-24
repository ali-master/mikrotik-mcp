/**
 * Firewall audit & explainer — `firewall_audit`.
 *
 * Pulls the filter (and optionally NAT/mangle) rulesets, runs the pure analysis
 * engine in `src/core/firewall-audit.ts`, and returns a plain-language report
 * plus a structured payload the interactive `firewall-audit` MCP App view renders
 * (findings by severity, each linking the offending rule with a one-click fix).
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import type { ToolContext } from "../core/context";
import { auditFirewall, renderReport, rulesFromRows } from "../core/firewall-audit";
import { READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { resolveDeviceName } from "../core/runtime";
import { isEmpty, looksLikeError } from "../core/routeros";
import { parseRecords } from "../core/routeros-parse";
import { uiViewUri } from "../core/ui-resources";

/** Fetch and parse a `<path> print detail` ruleset into rows (empty on error). */
async function fetchRules(path: string, ctx: ToolContext): Promise<Record<string, string>[]> {
  const out = await executeMikrotikCommand(`${path} print detail`, ctx);
  if (looksLikeError(out) || isEmpty(out)) return [];
  return parseRecords(out).rows;
}

export const firewallAuditTools: ToolModule = [
  defineTool({
    name: "firewall_audit",
    title: "Audit IPv4 Firewall Rulesets",
    annotations: READ,
    ui: { resourceUri: uiViewUri("firewall-audit"), visibility: ["model", "app"] },
    description:
      "Audits IPv4 firewall rulesets (`/ip firewall filter print detail`; optionally " +
      "`/ip firewall nat print detail` when include_nat=true (default on); " +
      "`/ip firewall mangle print detail` when include_mangle=true (default off)) — " +
      "use to review, harden, or understand a router's full firewall posture in one pass. " +
      "Detects unreachable/shadowed rules, overly-broad accepts, a missing default-drop, " +
      "duplicate rules, and dead rules with zero packet hits. " +
      "For browsing individual rules without analysis use list_filter_rules, list_nat_rules; " +
      "for IPv6 filter rules use list_ipv6_filter_rules; for IPv6 NAT use list_ipv6_nat_rules; " +
      "for IPv6 mangle use list_ipv6_mangle_rules. " +
      "Returns a risk score and a prioritised list of plain-language findings with suggested " +
      "per-rule fixes; in MCP App hosts also renders an interactive findings table with " +
      "one-click disable. Scoped to IPv4 paths only — no IPv6 audit twin exists.",
    inputSchema: {
      include_nat: z.boolean().default(true).describe("Also audit `/ip firewall nat`."),
      include_mangle: z.boolean().default(false).describe("Also audit `/ip firewall mangle`."),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`Auditing firewall for '${device}'`);

      const filter = rulesFromRows(await fetchRules("/ip firewall filter", ctx));
      const nat = a.include_nat
        ? rulesFromRows(await fetchRules("/ip firewall nat", ctx))
        : undefined;
      const mangle = a.include_mangle
        ? rulesFromRows(await fetchRules("/ip firewall mangle", ctx))
        : undefined;

      const report = auditFirewall({ filter, nat, mangle });
      const structuredContent = {
        __mikrotikView: "firewall-audit" as const,
        device,
        ...report,
        generatedAt: new Date().toISOString(),
      };

      return { text: renderReport(report, device), structuredContent };
    },
  }),
];
