/**
 * DR Drill — Chaos Engineering for routers. Safely rehearse a failure before it
 * happens: inside Safe Mode the tool disables a WAN/tunnel/link, pings a verify
 * host to check whether the backup path actually carries traffic, then rolls the
 * change back (Safe Mode auto-reverts) — proving resilience without waiting for a
 * real 2 a.m. outage.
 *
 * SSH-only (Safe Mode). The `parsePingSummary` helper is unit-tested.
 */
import { z } from "zod";
import { DANGEROUS, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { getDevice, resolveDeviceName } from "../core/runtime";
import { getSafeModeManager } from "../ssh/safe-mode";

/** Sent/received/loss parsed from a RouterOS `/ping` summary. */
export interface PingSummary {
  sent: number;
  received: number;
  lossPct: number;
}

/** Parse the trailing summary of `/ping` output (`sent=5 received=5 packet-loss=0%`). */
export function parsePingSummary(output: string): PingSummary | null {
  const sent = output.match(/sent=(\d+)/)?.[1];
  const received = output.match(/received=(\d+)/)?.[1];
  const loss = output.match(/packet-loss=(\d+)\s*%/)?.[1];
  if (sent == null || received == null) return null;
  return {
    sent: Number(sent),
    received: Number(received),
    lossPct: loss != null ? Number(loss) : received === sent ? 0 : 100,
  };
}

export const drDrillTools: ToolModule = [
  defineTool({
    name: "run_failover_drill",
    title: "Run Failover DR Drill",
    annotations: DANGEROUS,
    description:
      "Rehearses a disaster safely: INSIDE SAFE MODE it disables a target (a WAN/tunnel interface, or " +
      "a route), pings `verify_host` to check the backup path actually carries traffic, then ROLLS " +
      "BACK — Safe Mode auto-reverts, so the change is never committed. Proves your failover works " +
      "without a real outage. Requires `confirm=true` to run (it briefly disrupts traffic on the " +
      "target); with confirm=false it just describes the drill. SSH-only (Safe Mode is unavailable on " +
      "MAC-Telnet). Returns whether connectivity held during the simulated failure.",
    inputSchema: {
      target_type: z.enum(["interface", "route"]).default("interface"),
      target: z
        .string()
        .describe("Interface name (e.g. 'ether1-wan') or, for route, a find expression / .id"),
      verify_host: z
        .string()
        .describe("Host to ping during the outage to confirm the backup path, e.g. '8.8.8.8'"),
      ping_count: z.number().int().min(1).max(50).default(5),
      confirm: z.boolean().default(false).describe("Must be true to actually run the drill"),
    },
    async handler(a, ctx) {
      const disableCmd =
        a.target_type === "interface"
          ? `/interface disable "${a.target}"`
          : `/ip route disable [find ${a.target.startsWith("*") ? `.id=${a.target}` : a.target}]`;

      if (!a.confirm) {
        return `DRY RUN — would, inside Safe Mode: (1) ${disableCmd}; (2) /ping address=${a.verify_host} count=${a.ping_count}; (3) roll back (auto-revert). Set confirm=true to run the drill.`;
      }

      const device = resolveDeviceName(ctx.device);
      if (getDevice(device).mac) {
        return "DR Drill needs Safe Mode, which is SSH-only — this device is reached over MAC-Telnet.";
      }
      const mgr = getSafeModeManager(device);
      const en = await mgr.enable();
      if (en.startsWith("Error")) return `Could not enter Safe Mode: ${en}`;
      try {
        const disableOut = await mgr.execute(disableCmd);
        if (/no such item|failure:|syntax error/i.test(disableOut)) {
          return `Could not disable target '${a.target}': ${disableOut.trim()} (Safe Mode rolled back).`;
        }
        const pingOut = await mgr.execute(`/ping address=${a.verify_host} count=${a.ping_count}`);
        const summary = parsePingSummary(pingOut);
        const held = summary != null && summary.received > 0;
        const detail = summary
          ? `${summary.received}/${summary.sent} replies (${summary.lossPct}% loss)`
          : "could not parse ping result";
        const verdict = held
          ? "✅ Backup path HELD — failover works."
          : "⛔ NO connectivity during the outage — failover did NOT carry traffic.";
        return `DR DRILL — disabled ${a.target_type} '${a.target}', pinged ${a.verify_host}: ${detail}.\n${verdict}\nThe change has been rolled back (Safe Mode); nothing was committed.`;
      } finally {
        await mgr.rollback();
      }
    },
  }),
];
