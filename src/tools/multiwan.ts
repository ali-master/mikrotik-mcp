/**
 * Multi-WAN Conductor — builds resilient multi-WAN routing from a simple intent,
 * handling the default-route wiring for you.
 *
 *   • setup_wan_failover    — active-passive: health-checked default routes with
 *                             ascending distances, so traffic fails over when a
 *                             link dies and fails back when it recovers.
 *   • setup_wan_loadbalance — ECMP: one default route with multiple gateways,
 *                             balancing per-connection across the links.
 *
 * Both DEFAULT TO A DRY RUN (changing default routing can cut your own access),
 * returning the exact commands they would run so the plan can be reviewed first.
 * For sticky per-source/per-connection balancing (PCC) use the firewall mangle +
 * routing-table tools.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { DANGEROUS, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, Cmd } from "../core/routeros";

/** Run a built list of commands (or preview them), returning a report. */
async function runOrPreview(
  commands: string[],
  apply: boolean,
  ctx: Parameters<typeof executeMikrotikCommand>[1],
  what: string,
): Promise<string> {
  if (!apply) {
    const plan = commands.map((c, i) => `${i + 1}. ${c}`).join("\n");
    return `DRY RUN — ${what}; ${commands.length} command(s) would run (set apply=true to execute):\n\n${plan}`;
  }
  const done: string[] = [];
  for (const cmd of commands) {
    const result = await executeMikrotikCommand(cmd, ctx);
    if (looksLikeError(result)) {
      return `Applied ${done.length}/${commands.length} commands, then FAILED: ${result}\nRan: ${done.join(" | ") || "none"}`;
    }
    done.push(cmd);
  }
  const routes = await executeMikrotikCommand('/ip route print where dst-address="0.0.0.0/0"', ctx);
  return `${what} applied (${done.length} command(s)).\n\nDEFAULT ROUTES:\n\n${routes}`;
}

export const multiwanTools: ToolModule = [
  defineTool({
    name: "setup_wan_failover",
    title: "Set Up Multi-WAN Failover",
    annotations: DANGEROUS,
    description:
      "Builds ACTIVE-PASSIVE multi-WAN failover by adding health-checked default routes with ascending " +
      "distances (primary=1, each backup +1). RouterOS uses the lowest-distance reachable route; " +
      "`check-gateway` withdraws a route when its gateway stops answering, so traffic fails over to " +
      "the next WAN — and fails back automatically when the primary recovers. DEFAULTS TO A DRY RUN " +
      "(`apply=false`) so you can review before changing default routing (which can cut your own " +
      "access); set `apply=true` to execute. Does NOT remove existing 0.0.0.0/0 routes — clear " +
      "conflicting ones first with the route tools. For load balancing instead of failover use " +
      "setup_wan_loadbalance. Returns the plan or the resulting default routes.",
    inputSchema: {
      primary_gateway: z.string().describe("Primary WAN gateway IP (or interface name)"),
      backup_gateways: z
        .array(z.string())
        .min(1)
        .describe("One or more backup WAN gateways, in failover order"),
      check: z.enum(["ping", "arp"]).default("ping").describe("Gateway health-check method"),
      comment_prefix: z.string().default("wan-failover"),
      apply: z.boolean().default(false).describe("false = preview only (default); true = execute"),
    },
    async handler(a, ctx) {
      const backups = a.backup_gateways as string[];
      ctx.info(`Multi-WAN failover: primary + ${backups.length} backup(s), apply=${a.apply}`);
      const route = (gw: string, distance: number, label: string): string =>
        new Cmd("/ip route add")
          .set("dst-address", "0.0.0.0/0")
          .set("gateway", gw)
          .set("distance", distance)
          .set("check-gateway", a.check)
          .set("comment", `${a.comment_prefix}: ${label}`)
          .build();
      const commands = [
        route(a.primary_gateway, 1, "primary"),
        ...backups.map((gw, i) => route(gw, i + 2, `backup-${i + 1}`)),
      ];
      return runOrPreview(commands, a.apply, ctx, "active-passive WAN failover");
    },
  }),

  defineTool({
    name: "setup_wan_loadbalance",
    title: "Set Up Multi-WAN Load Balancing (ECMP)",
    annotations: DANGEROUS,
    description:
      "Builds ECMP (equal-cost multi-path) load balancing across multiple WANs by adding ONE default " +
      "route whose `gateway` lists every WAN — RouterOS then spreads connections across the links " +
      "(per-connection, so a single flow stays on one WAN). `check-gateway` drops a dead link from " +
      "the set. DEFAULTS TO A DRY RUN (`apply=false`); set `apply=true` to execute. Does NOT remove " +
      "existing 0.0.0.0/0 routes — clear conflicting ones first. ECMP is simple but balances by " +
      "connection-hash, not by bandwidth; for sticky per-source balancing (PCC) use the firewall " +
      "mangle + routing-table tools. For failover instead of balancing use setup_wan_failover. " +
      "Returns the plan or the resulting default route.",
    inputSchema: {
      gateways: z.array(z.string()).min(2).describe("Two or more WAN gateways to balance across"),
      check: z.enum(["ping", "arp"]).default("ping").describe("Gateway health-check method"),
      comment: z.string().default("wan-ecmp"),
      apply: z.boolean().default(false).describe("false = preview only (default); true = execute"),
    },
    async handler(a, ctx) {
      const gateways = a.gateways as string[];
      ctx.info(`Multi-WAN ECMP across ${gateways.length} gateways, apply=${a.apply}`);
      const cmd = new Cmd("/ip route add")
        .set("dst-address", "0.0.0.0/0")
        .set("gateway", gateways.join(","))
        .set("check-gateway", a.check)
        .set("comment", a.comment)
        .build();
      return runOrPreview([cmd], a.apply, ctx, `ECMP balancing across ${gateways.length} WANs`);
    },
  }),
];
