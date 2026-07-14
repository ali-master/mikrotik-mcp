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
  buildChannelPlanCommands,
  buildFixPlan,
  buildFtCommands,
  buildHaCommands,
  buildLoadBalanceCommands,
  buildSteerCommands,
  haGuidance,
  loadBalancePlan,
  proposeChannelPlan,
  reportWeakClients,
  resolveMobilityDomain,
  runCapsmanAudit,
  renderCapsmanReport,
  steerAlreadyPresent,
} from "../core/capsman";
import type { CapsmanCategory, CapsmanState } from "../core/capsman";
import { DANGEROUS, READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { resolveDeviceName } from "../core/runtime";
import { captureSnapshot } from "../snapshots/capture";
import { applyWritesSafely } from "../utils/safe-mode-apply";
import { fetchCapsmanState } from "../utils/wifi-query";

/** Shared apply path: snapshot → Safe-Mode-only (no direct fallback — Wi-Fi can lock out). */
async function applyCapsman(
  ctx: ToolContext,
  device: string,
  commands: string[],
  label: string,
): Promise<string> {
  if (commands.length === 0)
    return "Nothing to apply — already in the desired state (idempotent no-op).";
  const snapshotId = await captureSnapshot(ctx, label);
  const outcome = await applyWritesSafely(ctx, device, commands, { allowDirectFallback: false });
  const lines = [
    `CAPsMAN APPLY — snapshot=${snapshotId}  safe-mode=${outcome.safeMode}`,
    `Applied ${outcome.applied}/${outcome.total} command(s).`,
    ...(outcome.error ? [`FAILED: ${outcome.error}`] : []),
    "",
    ...commands.map((c) => `  ${c}`),
    "",
    `Roll back with: diff_config_snapshots from=${snapshotId} to=live`,
  ];
  return lines.join("\n");
}

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

  defineTool({
    name: "steer_client",
    title: "Steer a Weak-Signal Client",
    annotations: DANGEROUS,
    description:
      "Steers ONE weak client toward a better AP. `mode=hard` installs an access-list signal-range " +
      "REJECT on the client's current radio so it re-associates on a neighbor it hears stronger (can " +
      "briefly disconnect it). `mode=soft` is 802.11k/v-only and installs no rule (advisory — enable " +
      "steering via enable_capsman_ft). ADVISORY: RouterOS has no force-move, so the client ultimately " +
      "decides. DRY RUN unless confirm=true. Snapshots first and applies inside Safe Mode (auto-revert " +
      "on lockout). Idempotent — a re-run for the same MAC adds nothing.",
    inputSchema: {
      mac: z.string().min(1).describe("Client MAC address to steer."),
      mode: z
        .enum(["soft", "hard"])
        .default("hard")
        .describe("hard = signal-range reject; soft = k/v only (no write)."),
      reject_above_dbm: z
        .number()
        .int()
        .max(-1)
        .optional()
        .describe(`dBm ceiling of the reject band for hard mode (default ${DEFAULT_WEAK_DBM}).`),
      confirm: z
        .literal(true)
        .optional()
        .describe("Must be true to write; omit for a dry-run preview."),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      const state: CapsmanState = await fetchCapsmanState(ctx);
      const client = state.clients.find((c) => c.mac.toLowerCase() === a.mac.toLowerCase());
      if (!client) return `Client ${a.mac} is not currently associated to any managed radio.`;
      if (steerAlreadyPresent(state, a.mac)) {
        return `A steer rule for ${a.mac} already exists (idempotent no-op). Remove it manually to change.`;
      }
      const commands = buildSteerCommands(state, a.mac, client.radioId, a.mode, a.reject_above_dbm);
      if (a.mode === "soft") {
        return `Soft steer is advisory-only (802.11k/v hints) — no access-list rule written. Ensure 802.11k/v is enabled with enable_capsman_ft, then the client roams on its own. Current signal ${client.signal} dBm on ${client.radioId}.`;
      }
      if (!a.confirm) {
        return `DRY RUN — steer ${a.mac} (${a.mode}); set confirm=true to apply:\n\n${commands.map((c) => `  ${c}`).join("\n")}`;
      }
      return applyCapsman(ctx, device, commands, `pre-steer_client-${a.mac}`);
    },
  }),

  defineTool({
    name: "apply_capsman_load_balance",
    title: "Apply CAPsMAN Load Balance",
    annotations: DANGEROUS,
    description:
      "Applies a resource-aware rebalance: for each overloaded / CPU-constrained radio that has an " +
      "adjacent radio with spare capacity, installs a connect-priority nudge so NEW clients prefer the " +
      "idle neighbor (gentle — does not disconnect existing clients). ADVISORY. DRY RUN unless " +
      "confirm=true. Snapshots first, applies inside Safe Mode. Idempotent. Preview the plan with " +
      "audit_capsman_load first.",
    inputSchema: {
      confirm: z
        .literal(true)
        .optional()
        .describe("Must be true to write; omit for a dry-run preview."),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      const state = await fetchCapsmanState(ctx);
      const plan = loadBalancePlan(state);
      if (plan.length === 0)
        return "No rebalance needed — no overloaded radio has an idle adjacent neighbor.";
      const commands = buildLoadBalanceCommands(state, plan);
      if (commands.length === 0) return "Load-balance rules already present (idempotent no-op).";
      const preview = plan
        .map((p) => `  ${p.cap}/${p.radioId} → offload toward ${p.targetCap}/${p.targetRadioId}`)
        .join("\n");
      if (!a.confirm) {
        return `DRY RUN — load-balance plan (set confirm=true to apply):\n${preview}\n\nCommands:\n${commands.map((c) => `  ${c}`).join("\n")}`;
      }
      return applyCapsman(ctx, device, commands, "pre-apply_capsman_load_balance");
    },
  }),

  defineTool({
    name: "apply_capsman_channel_plan",
    title: "Apply CAPsMAN Channel Plan",
    annotations: DANGEROUS,
    description:
      "Applies the proposed non-overlapping manual channel plan (from audit_capsman_coverage) to the " +
      "managed radios by setting each radio's frequency — resolving co-channel conflicts. Optionally " +
      "scope to specific radios with `radio_ids`. DRY RUN unless confirm=true. Snapshots first, applies " +
      "inside Safe Mode; idempotent (radios already on the target channel are skipped). v7 " +
      "`/interface wifi` only — on legacy `/caps-man` the channel lives in named channel objects, so " +
      "edit those manually (the audit still shows the plan).",
    inputSchema: {
      radio_ids: z
        .array(z.string())
        .optional()
        .describe("Only re-channel these radio ids. Omit to apply the whole plan."),
      confirm: z
        .literal(true)
        .optional()
        .describe("Must be true to write; omit for a dry-run preview."),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      const state = await fetchCapsmanState(ctx);
      if (state.path === "/caps-man") {
        return "Channel-plan apply targets v7 /interface wifi. This device uses legacy /caps-man — edit the /caps-man channel objects manually; audit_capsman_coverage shows the proposed plan.";
      }
      const only = a.radio_ids ? new Set<string>(a.radio_ids as string[]) : undefined;
      const commands = buildChannelPlanCommands(state, only);
      if (commands.length === 0)
        return "No channel changes needed — every radio is already on its proposed channel (idempotent no-op).";
      if (!a.confirm) {
        return `DRY RUN — channel plan (set confirm=true to apply):\n\n${commands.map((c) => `  ${c}`).join("\n")}`;
      }
      return applyCapsman(ctx, device, commands, "pre-apply_capsman_channel_plan");
    },
  }),

  defineTool({
    name: "enable_capsman_ft",
    title: "Enable CAPsMAN Fast-Roaming (802.11r)",
    annotations: DANGEROUS,
    description:
      "Enables 802.11r fast-transition on the CAPsMAN security configs, converging every one on a " +
      "SINGLE shared `ft-mobility-domain` (so roaming between floors is seamless and consistent) — " +
      "fixing the ft-off and ft-domain-mismatch findings. Scope with `config_names`; set the domain " +
      "with `mobility_domain` (default: the existing domain, else 0001). Note: enabling FT changes the " +
      "SSID's roaming behaviour and briefly re-keys clients. DRY RUN unless confirm=true. Snapshots " +
      "first, applies inside Safe Mode; idempotent. 802.11k/v steering is configured separately.",
    inputSchema: {
      config_names: z
        .array(z.string())
        .optional()
        .describe("Only enable FT on these security configs. Omit for all."),
      mobility_domain: z
        .string()
        .optional()
        .describe(
          "Shared ft-mobility-domain to converge on. Omit to adopt the existing one (or 0001).",
        ),
      confirm: z
        .literal(true)
        .optional()
        .describe("Must be true to write; omit for a dry-run preview."),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      const state = await fetchCapsmanState(ctx);
      if (state.securityConfigs.length === 0) {
        return "No CAPsMAN security configs found — nothing to enable FT on.";
      }
      const commands = buildFtCommands(state, {
        configNames: a.config_names,
        mobilityDomain: a.mobility_domain,
      });
      if (commands.length === 0) {
        return `FT already enabled and consistent (mobility-domain=${resolveMobilityDomain(state, a.mobility_domain)}). Idempotent no-op.`;
      }
      if (!a.confirm) {
        return `DRY RUN — enable FT (set confirm=true to apply):\n\n${commands.map((c) => `  ${c}`).join("\n")}`;
      }
      return applyCapsman(ctx, device, commands, "pre-enable_capsman_ft");
    },
  }),

  defineTool({
    name: "setup_capsman_ha",
    title: "Set Up CAPsMAN High-Availability",
    annotations: DANGEROUS,
    description:
      "Hardens CAPsMAN redundancy. Applies what THIS manager can safely do — enable " +
      "require-peer-certificate (so a rogue manager can't adopt your CAPs) — and returns the exact " +
      "manual, multi-device steps to finish HA (stand up a second manager with the same certificate, " +
      "point every CAP at both managers). Standing up the backup + editing each CAP is inherently " +
      "multi-device, so it is NOT auto-applied. HIGHEST blast radius — DRY RUN unless confirm=true; " +
      "snapshots first, applies inside Safe Mode. Requires a `reason`.",
    inputSchema: {
      backup_manager_address: z
        .string()
        .optional()
        .describe("Address of the (planned) backup manager, woven into the guidance."),
      confirm: z
        .literal(true)
        .optional()
        .describe("Must be true to write; omit for a dry-run preview."),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      const state = await fetchCapsmanState(ctx);
      if (!state.managerEnabled)
        return "This device is not a CAPsMAN manager — HA setup does not apply.";
      const commands = buildHaCommands(state);
      const guidance = haGuidance(state, a.backup_manager_address);
      const guide = `\n\nMANUAL STEPS TO COMPLETE HA (multi-device — not auto-applied):\n${guidance.map((g) => `  • ${g}`).join("\n")}`;
      if (commands.length === 0) {
        return `require-peer-certificate is already enabled on this manager.${guide}`;
      }
      if (!a.confirm) {
        return `DRY RUN — HA hardening on this manager (set confirm=true to apply):\n\n${commands.map((c) => `  ${c}`).join("\n")}${guide}`;
      }
      return (await applyCapsman(ctx, device, commands, "pre-setup_capsman_ha")) + guide;
    },
  }),

  defineTool({
    name: "apply_capsman_fixes",
    title: "Apply CAPsMAN Fixes",
    annotations: DANGEROUS,
    description:
      "Applies specific finding_ids from a prior run_capsman_audit, dispatching each to its remediation " +
      "in a SAFE order (coverage/channel-plan → load-balance → steer → FT → HA), all wrapped in ONE " +
      "snapshot + ONE Safe-Mode session. Returns the applied commands + snapshot id. DRY RUN unless " +
      "confirm=true. NEVER a blanket 'fix everything' — pass explicit finding_ids from an audit. " +
      "Steering/balancing remain advisory; HA require-cert is applied but the multi-device HA steps are not.",
    inputSchema: {
      finding_ids: z
        .array(z.string())
        .min(1)
        .describe("Explicit finding_id(s) from a prior run_capsman_audit. No blanket apply."),
      confirm: z
        .literal(true)
        .optional()
        .describe("Must be true to write; omit for a dry-run preview."),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      const state = await fetchCapsmanState(ctx);
      const commands = buildFixPlan(state, a.finding_ids);
      if (commands.length === 0) {
        return "No applicable automated fix for those finding_ids (already fixed, or manual-only like the HA multi-device steps).";
      }
      if (!a.confirm) {
        return `DRY RUN — ${commands.length} command(s) in safe order (set confirm=true to apply):\n\n${commands.map((c) => `  ${c}`).join("\n")}`;
      }
      return applyCapsman(ctx, device, commands, "pre-apply_capsman_fixes");
    },
  }),
];
