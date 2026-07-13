/**
 * CAPsMAN Orchestrator — read-only tools (Phase 1).
 *
 * Thin layer over the pure engine (`src/core/capsman.ts`): fetch the device's
 * CAPsMAN state via `src/utils/wifi-query.ts`, run a category audit, render the
 * report. No writes this phase (steering/channel/FT/HA apply land in later
 * phases — see docs/capsman-orchestrator-plan.md §10).
 */
import { z } from "zod";
import type { ToolContext } from "../core/context";
import {
  DEFAULT_WEAK_DBM,
  proposeChannelPlan,
  reportWeakClients,
  runCapsmanAudit,
  renderCapsmanReport,
} from "../core/capsman";
import type { CapsmanCategory } from "../core/capsman";
import { READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { resolveDeviceName } from "../core/runtime";
import { fetchCapsmanState } from "../utils/wifi-query";

const weakDbm = z
  .number()
  .int()
  .max(-1)
  .optional()
  .describe(`Weak-signal threshold in dBm (negative; default ${DEFAULT_WEAK_DBM}).`);

/** Fetch + audit a single category, render it. */
async function auditOne(
  ctx: ToolContext,
  category: CapsmanCategory,
  opts: { weakDbm?: number } = {},
): Promise<string> {
  const device = resolveDeviceName(ctx.device);
  const state = await fetchCapsmanState(ctx);
  const report = runCapsmanAudit(state, { categories: [category], weakDbm: opts.weakDbm });
  return renderCapsmanReport(report, device);
}

export const capsmanTools: ToolModule = [
  defineTool({
    name: "run_capsman_audit",
    title: "Run CAPsMAN Audit",
    annotations: READ,
    description:
      "Read-only. Audits the device's CAPsMAN Wi-Fi fabric across coverage/co-channel, weak-signal " +
      "clients, resource-aware load, 802.11r (FT) roaming, and HA (backup-manager) redundancy — one " +
      "severity-ranked report with per-finding id, severity and confidence (proven vs " +
      "needs_live_verification; steering/balancing are advisory since RouterOS has no force-move). " +
      "Supports both the v7 `/interface wifi` CAPsMAN and legacy `/caps-man`. Narrow with `categories`. " +
      "For a single dimension use audit_capsman_coverage / report_weak_signal_clients / " +
      "audit_capsman_load / audit_capsman_ft / audit_capsman_ha.",
    inputSchema: {
      categories: z
        .array(z.enum(["coverage", "weak_signal", "load", "ft", "ha"]))
        .optional()
        .describe("Narrow to specific categories. Omit to audit all five."),
      weak_dbm: weakDbm,
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] run_capsman_audit`);
      const state = await fetchCapsmanState(ctx);
      const report = runCapsmanAudit(state, {
        categories: a.categories as CapsmanCategory[] | undefined,
        weakDbm: a.weak_dbm,
      });
      return renderCapsmanReport(report, device);
    },
  }),

  defineTool({
    name: "audit_capsman_coverage",
    title: "Audit CAPsMAN Coverage & Channels",
    annotations: READ,
    description:
      "Read-only. Inventories every managed CAP radio (band, manual channel/width, tx-power, client " +
      "count), detects CO-CHANNEL overlap between physically-adjacent radios (adjacency inferred from " +
      "clients seen on more than one radio), and proposes a non-overlapping manual channel plan " +
      "(2.4 GHz → 1/6/11; 5 GHz DFS-aware). Preview only — apply is a later, confirm-gated tool.",
    async handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] audit_capsman_coverage`);
      const state = await fetchCapsmanState(ctx);
      const report = runCapsmanAudit(state, { categories: ["coverage"] });
      const plan = proposeChannelPlan(state);
      const planLines = [...plan.entries()]
        .map(([rid, ch]) => {
          const r = state.radios.find((radio) => radio.radioId === rid);
          return `  ${r?.cap ?? "?"}/${rid} (${r?.band ?? "?"}) → channel ${ch}`;
        })
        .join("\n");
      return (
        renderCapsmanReport(report, device) +
        (planLines ? `\n\nPROPOSED MANUAL CHANNEL PLAN (preview):\n${planLines}` : "")
      );
    },
  }),

  defineTool({
    name: "report_weak_signal_clients",
    title: "Report Weak-Signal Clients",
    annotations: READ,
    description:
      "Read-only. Merges every CAP's registration-table and lists clients below the weak-signal " +
      "threshold (default -70 dBm), each with its current AP, signal, band, and — when a neighbor " +
      "radio hears it meaningfully stronger — the recommended AP to steer toward and the dB gain. " +
      "Steering itself is a later, confirm-gated tool (soft 802.11k/v or hard signal-range).",
    inputSchema: { weak_dbm: weakDbm },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] report_weak_signal_clients`);
      const state = await fetchCapsmanState(ctx);
      const weak = reportWeakClients(state, a.weak_dbm ?? DEFAULT_WEAK_DBM);
      if (weak.length === 0) {
        return `WEAK-SIGNAL CLIENTS — ${device}\n\nNone below ${a.weak_dbm ?? DEFAULT_WEAK_DBM} dBm. ✓`;
      }
      const lines = weak
        .map(
          (w) =>
            `  ${w.mac}  ${w.signal} dBm  ${w.band}  on ${w.currentCap}${w.recommendCap ? `  → steer to ${w.recommendCap} (+${w.gainDb} dB)` : "  (coverage gap)"}`,
        )
        .join("\n");
      return `WEAK-SIGNAL CLIENTS — ${device} (${weak.length} below ${a.weak_dbm ?? DEFAULT_WEAK_DBM} dBm):\n\n${lines}`;
    },
  }),

  defineTool({
    name: "audit_capsman_load",
    title: "Audit CAPsMAN Load & Resources",
    annotations: READ,
    description:
      "Read-only. Reports per-radio client load and the owning CAP's CPU/mem, flags overloaded or " +
      "resource-constrained radios that have an adjacent radio with spare capacity, and recommends " +
      "a resource-aware rebalance (offload toward the idle neighbor; steer dual-band clients to 5 GHz). " +
      "Advisory — apply is a later, confirm-gated tool.",
    async handler(_a, ctx) {
      return auditOne(ctx, "load");
    },
  }),

  defineTool({
    name: "audit_capsman_ft",
    title: "Audit CAPsMAN Fast-Roaming (802.11r)",
    annotations: READ,
    description:
      "Read-only. Checks 802.11r fast-transition per SSID: is `ft` enabled, is 802.11k/v steering on, " +
      "and is the `ft-mobility-domain` CONSISTENT across all CAPs (fast roaming only works within one " +
      "domain). Reports roam-readiness. Enabling FT is a later, confirm-gated tool.",
    async handler(_a, ctx) {
      return auditOne(ctx, "ft");
    },
  }),

  defineTool({
    name: "audit_capsman_ha",
    title: "Audit CAPsMAN High-Availability",
    annotations: READ,
    description:
      "Read-only. Checks CAPsMAN redundancy: is there a backup manager, are the CAPs pointed at both " +
      "managers, and is require-peer-certificate on? Flags single points of failure (one manager = the " +
      "whole building's Wi-Fi drops if it reboots). Setting up HA is a later, confirm-gated tool.",
    async handler(_a, ctx) {
      return auditOne(ctx, "ha");
    },
  }),
];
