/**
 * Security-Hardening tool suite — the device-facing layer over the pure engine
 * in `src/core/security-hardening.ts`.
 *
 * ── Introduction ────────────────────────────────────────────────────────────
 * This module exposes one `audit_*` (read-only) + `harden_*`/`fix_*` (scoped
 * write) tool pair per risk category, plus an orchestrator that runs every
 * category and a single scoped-apply tool. The audits never mutate; the fixes
 * default to a dry run and require an explicit `confirm: true`, always snapshot
 * before writing, and wrap any change that could cut management access in Safe
 * Mode — exactly like the existing `apply_plan` / `harden_firewall` tools.
 *
 * ── Implementation ──────────────────────────────────────────────────────────
 * The audit/fix tool pairs are GENERATED from a single `CATEGORY_TOOLS`
 * descriptor table (DRY) so every category inherits identical safety wiring:
 * dry-run default, `confirm` gate, snapshot capture, Safe-Mode envelope,
 * per-finding success/failure reporting. Fix commands are NOT re-derived here —
 * each {@link Finding} carries its own `fix`, so the fix tools re-run the
 * category's auditor, filter by the caller-supplied `finding_id`s, and execute
 * those commands. A fix tool can never widen its own scope: it only touches the
 * exact findings named, sourced from a prior audit.
 *
 * The audit → plan → confirm → apply → snapshot → Safe-Mode lifecycle:
 *
 *   run_security_hardening_audit / audit_<category>
 *          │  (read-only: print/export only)
 *          ▼
 *     findings[] each with a stable finding_id + fix[]
 *          │
 *          ▼  caller picks finding_ids
 *   apply_security_hardening_fixes(finding_ids, confirm) / harden_<category>(finding_ids, confirm)
 *          │
 *          ├─ confirm=false ─▶ DRY RUN: echo the exact commands, write nothing
 *          │
 *          └─ confirm=true
 *                 │
 *                 ▼  capture_config_snapshot  (pre-change rollback point → snapshot_id)
 *                 │
 *                 ▼  enable Safe Mode         (SSH devices; skipped for MAC-Telnet)
 *                 │
 *                 ▼  execute each finding's fix[] in safe order
 *                 │        │
 *                 │        ├─ any command errors ─▶ rollback Safe Mode, report partial
 *                 │        │
 *                 │        ▼
 *                 ▼  commit Safe Mode
 *                 │        │
 *                 │        └─ commit fails ─▶ changes revert; report NOT saved
 *                 ▼
 *            per-finding results + snapshot_id (diff/rollback with diff_config_snapshots)
 *
 * ── Analysis ────────────────────────────────────────────────────────────────
 * Descriptor-driven generation keeps 25 tools consistent and prevents a fix
 * tool from ever bypassing the snapshot/Safe-Mode envelope by hand. The trade-
 * off is a slightly generic per-tool description; each descriptor therefore
 * carries a rich, category-specific `description` so the model still gets a
 * precise prompt. Fetching the full device state for a single-category audit is
 * mildly wasteful but mirrors the proven `run_compliance_audit` pattern and
 * keeps the fetch logic in one place.
 *
 * ── Testing ─────────────────────────────────────────────────────────────────
 * The engine carries the heavy unit coverage; this layer's contract (dry-run by
 * default, confirm silently ignored when false, unknown finding_id handled,
 * safe order) is exercised through the pure helpers `selectFindings` and
 * `orderFindingsForApply`, which are unit-tested directly.
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import type { ToolContext } from "../core/context";
import { rulesFromRows } from "../core/firewall-audit";
import { DANGEROUS, READ, WRITE_IDEMPOTENT, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { getDevice, resolveDeviceName } from "../core/runtime";
import { looksLikeError } from "../core/routeros";
import {
  HARDENING_CATEGORIES,
  auditCategory,
  emptySecurityState,
  renderHardeningReport,
  runSecurityHardeningAudit,
} from "../core/security-hardening";
import type { DeviceSecurityState, Finding, HardeningCategory } from "../core/security-hardening";
import { getSafeModeManager } from "../ssh/safe-mode";
import { DEFAULT_SNAPSHOT_DB } from "../config";
import { contentSha, countLines, normalizeExport, parseExportMeta } from "../snapshots/format";
import { openSnapshotStore } from "../snapshots/store";
import type { Snapshot, SnapshotStore } from "../snapshots/store";
import { fetchKv as kv, fetchRows as rows, safe } from "../utils/safe-exec";

// ── State fetch ─────────────────────────────────────────────────────────────

/**
 * Fetch and parse every slice the engine needs, in parallel. Missing paths
 * (e.g. `/user-manager` on a router without it) come back empty via `safe()`,
 * so a single-category audit is robust to an absent subsystem.
 */
export async function fetchSecurityState(ctx: ToolContext): Promise<DeviceSecurityState> {
  const [
    filterRows,
    rawRows,
    ipv6FilterRows,
    ipSettings,
    ipv6Settings,
    ipv6Count,
    routes,
    ssh,
    services,
    servicePorts,
    macServer,
    macWinbox,
    bandwidthServer,
    romon,
    discoverySettings,
    snmp,
    snmpCommunity,
    userSettings,
    users,
    pppSecrets,
    userManagerUsers,
    userGroups,
    certSettings,
    ovpnServers,
    ovpnClients,
    sstpClients,
    dns,
    dhcpNetworks,
    ipAddresses,
    bridges,
    vlans,
    bridgeVlans,
    bridgeSettings,
    interfaces,
    pptpServer,
    pptpClients,
  ] = await Promise.all([
    rows("/ip firewall filter print detail", ctx),
    rows("/ip firewall raw print detail", ctx),
    rows("/ipv6 firewall filter print detail", ctx),
    kv("/ip settings print", ctx),
    kv("/ipv6 settings print", ctx),
    safe("/ipv6 address print count-only", ctx),
    rows('/ip route print detail where dst-address="0.0.0.0/0"', ctx),
    kv("/ip ssh print", ctx),
    rows("/ip service print detail", ctx),
    rows("/ip firewall service-port print detail", ctx),
    kv("/tool mac-server print", ctx),
    kv("/tool mac-server mac-winbox print", ctx),
    kv("/tool bandwidth-server print", ctx),
    kv("/tool romon print", ctx),
    kv("/ip neighbor discovery-settings print", ctx),
    kv("/snmp print", ctx),
    rows("/snmp community print detail", ctx),
    kv("/user settings print", ctx),
    rows("/user print detail", ctx),
    rows("/ppp secret print detail", ctx),
    rows("/user-manager user print detail", ctx),
    rows("/user group print detail", ctx),
    kv("/certificate settings print", ctx),
    rows("/interface ovpn-server server print detail", ctx),
    rows("/interface ovpn-client print detail", ctx),
    rows("/interface sstp-client print detail", ctx),
    kv("/ip dns print", ctx),
    rows("/ip dhcp-server network print detail", ctx),
    rows("/ip address print detail", ctx),
    rows("/interface bridge print detail", ctx),
    rows("/interface vlan print detail", ctx),
    rows("/interface bridge vlan print detail", ctx),
    kv("/interface bridge settings print", ctx),
    rows("/interface print detail", ctx),
    kv("/interface pptp-server server print", ctx),
    rows("/interface pptp-client print detail", ctx),
  ]);

  const count = Number.parseInt((ipv6Count || "").trim(), 10);
  return {
    ...emptySecurityState(),
    firewallFilter: rulesFromRows(filterRows),
    firewallRaw: rulesFromRows(rawRows),
    ipv6Filter: rulesFromRows(ipv6FilterRows),
    ipSettings,
    ipv6Settings,
    ipv6AddressCount: Number.isFinite(count) ? count : 0,
    routes,
    ssh,
    services,
    servicePorts,
    macServer,
    macWinbox,
    bandwidthServer,
    romon,
    discoverySettings,
    snmp,
    snmpCommunity,
    userSettings,
    users,
    pppSecrets,
    userManagerUsers,
    userGroups,
    certSettings,
    ovpnServers,
    ovpnClients,
    sstpClients,
    dns,
    dhcpNetworks,
    ipAddresses,
    bridges,
    vlans,
    bridgeVlans,
    bridgeSettings,
    interfaces,
    pptpServer,
    pptpClients,
  };
}

// ── Snapshot + apply plumbing ───────────────────────────────────────────────

let storePromise: Promise<SnapshotStore> | null = null;
function snapshots(): Promise<SnapshotStore> {
  if (!storePromise) storePromise = openSnapshotStore(DEFAULT_SNAPSHOT_DB);
  return storePromise;
}

/**
 * Capture a pre-change configuration snapshot to the local snapshot store (the
 * canonical rollback point in this codebase, same store `capture_config_snapshot`
 * uses) and return its id. Reads the device only (`/export`).
 */
async function captureSnapshot(ctx: ToolContext, label: string): Promise<string> {
  const device = resolveDeviceName(ctx.device);
  const body = await executeMikrotikCommand("/export terse", ctx);
  const meta = parseExportMeta(body);
  const sha = contentSha(normalizeExport(body));
  const ts = Date.now();
  const snap: Snapshot = {
    id: `snap_${ts}_${sha.slice(0, 8)}`,
    device,
    ts,
    label,
    rosVersion: meta.rosVersion,
    body,
    bytes: Buffer.byteLength(body, "utf8"),
    lines: countLines(body),
    sha,
  };
  (await snapshots()).insert(snap);
  return snap.id;
}

export interface ApplyResult {
  finding_id: string;
  ok: boolean;
  commands: string[];
  error?: string;
}

/**
 * Select the findings a fix call may act on: those whose id was requested, that
 * carry an automated `fix`, and (for the narrow `fix_password_policy`) that pass
 * an optional gate. Returns the matched findings plus any unknown ids so the
 * caller can report them without crashing.
 */
export function selectFindings(
  found: Finding[],
  requestedIds: string[],
  gate: (f: Finding) => boolean = () => true,
): { selected: Finding[]; unknown: string[]; skippedManual: string[] } {
  const byId = new Map(found.map((f) => [f.finding_id, f]));
  const selected: Finding[] = [];
  const unknown: string[] = [];
  const skippedManual: string[] = [];
  for (const id of requestedIds) {
    const f = byId.get(id);
    if (!f || !gate(f)) {
      unknown.push(id);
      continue;
    }
    if (!f.fix || f.fix.length === 0) {
      skippedManual.push(id);
      continue;
    }
    selected.push(f);
  }
  return { selected, unknown, skippedManual };
}

/** Safe apply order across categories (default-deny/address-list first). */
const APPLY_ORDER: HardeningCategory[] = [
  "firewall_default_deny",
  "address_list_enforcement",
  "ipv6_firewall_baseline",
  "kernel_ip_hardening",
  "dns_resolver_exposure",
  "ip_service_exposure",
  "ssh_hardening",
  "connection_tracking_helpers",
  "management_plane_exposure",
  "certificate_hygiene",
  "account_hygiene",
  "network_segmentation",
];

/** Order findings so structural firewall fixes land before service/hygiene fixes. */
export function orderFindingsForApply(findings: Finding[]): Finding[] {
  const rank = new Map(APPLY_ORDER.map((c, i) => [c, i]));
  return [...findings].sort((a, b) => (rank.get(a.category) ?? 99) - (rank.get(b.category) ?? 99));
}

/** Categories whose writes can cut management access → wrap in Safe Mode. */
const SAFE_MODE_CATEGORIES = new Set<HardeningCategory>([
  "firewall_default_deny",
  "address_list_enforcement",
  "ipv6_firewall_baseline",
  "ip_service_exposure",
  "ssh_hardening",
  "dns_resolver_exposure",
]);

/**
 * Apply the selected findings' fix commands inside one snapshot + Safe-Mode
 * envelope. Safe Mode is used when any selected finding is in a lockout-risky
 * category and the device is reachable over SSH (MAC-Telnet has no Safe Mode).
 */
async function applyFindings(
  ctx: ToolContext,
  findings: Finding[],
  label: string,
): Promise<{ results: ApplyResult[]; snapshotId: string; safeMode: string; committed: boolean }> {
  const ordered = orderFindingsForApply(findings);
  const deviceName = resolveDeviceName(ctx.device);
  const snapshotId = await captureSnapshot(ctx, label);

  const wantSafe =
    ordered.some((f) => SAFE_MODE_CATEGORIES.has(f.category)) && !getDevice(deviceName).mac;
  const mgr = getSafeModeManager(deviceName);
  let safeMode = "not used";
  if (wantSafe) {
    const en = await mgr.enable();
    if (en.startsWith("Error")) {
      return {
        results: ordered.map((f) => ({
          finding_id: f.finding_id,
          ok: false,
          commands: f.fix ?? [],
          error: `Safe Mode unavailable: ${en}`,
        })),
        snapshotId,
        safeMode: `failed to enable: ${en}`,
        committed: false,
      };
    }
    safeMode = "enabled";
  }

  const results: ApplyResult[] = [];
  for (const f of ordered) {
    const commands = f.fix ?? [];
    let ok = true;
    let error: string | undefined;
    for (const cmd of commands) {
      // Routes through the Safe-Mode session automatically when active.
      const out = await executeMikrotikCommand(cmd, ctx).catch(
        (e: unknown) => `error: ${String(e)}`,
      );
      if (looksLikeError(out) || out.startsWith("error:")) {
        ok = false;
        error = out.trim().split("\n")[0];
        break;
      }
    }
    results.push({ finding_id: f.finding_id, ok, commands, error });
    if (!ok && wantSafe) {
      // Mid-remediation failure under Safe Mode → revert everything.
      await mgr.rollback();
      return {
        results,
        snapshotId,
        safeMode: "rolled back (a fix failed — no changes kept)",
        committed: false,
      };
    }
  }

  let committed = true;
  if (wantSafe) {
    const c = await mgr.commit();
    committed = c.ok;
    safeMode = c.ok ? "committed" : `commit FAILED — changes revert: ${c.message}`;
  }
  return { results, snapshotId, safeMode, committed };
}

/** Render an apply outcome as text. */
function renderApply(
  results: ApplyResult[],
  unknown: string[],
  skippedManual: string[],
  snapshotId: string,
  safeMode: string,
): string {
  const lines: string[] = [];
  const applied = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  lines.push(`SECURITY HARDENING FIXES — snapshot=${snapshotId}  safe-mode=${safeMode}`);
  lines.push(`Applied ${applied}, failed ${failed} of ${results.length} finding(s).`);
  lines.push("");
  for (const r of results) {
    lines.push(`  ${r.ok ? "OK  " : "ERR "} ${r.finding_id}`);
    for (const c of r.commands) lines.push(`         ${c}`);
    if (r.error) lines.push(`         → ${r.error}`);
  }
  if (skippedManual.length) {
    lines.push("");
    lines.push(`Skipped (manual-review / no automated fix): ${skippedManual.join(", ")}`);
  }
  if (unknown.length) {
    lines.push("");
    lines.push(`Unknown finding_id(s) — not from a current audit: ${unknown.join(", ")}`);
  }
  lines.push("");
  lines.push(`Roll back or inspect with: diff_config_snapshots from=${snapshotId} to=live`);
  return lines.join("\n");
}

// ── Descriptor-driven tool generation ───────────────────────────────────────

interface CategoryTool {
  category: HardeningCategory;
  auditName: string;
  auditTitle: string;
  auditDescription: string;
  fix?: {
    name: string;
    title: string;
    description: string;
    /** Restrict which findings this fix tool may apply (default: any with a fix). */
    gate?: (f: Finding) => boolean;
  };
}

const CATEGORY_TOOLS: CategoryTool[] = [
  {
    category: "firewall_default_deny",
    auditName: "audit_firewall_default_deny",
    auditTitle: "Audit Firewall Default-Deny",
    auditDescription:
      "Read-only. Walks `/ip firewall filter` input and forward chains and reports whether each " +
      "chain ends in an ENFORCED default-deny (a final unconditional drop/reject). Separately flags " +
      "the field trap where an accept is followed by a matching drop that is disabled=yes — the chain " +
      "looks protected but everything falls through (severity critical, its own finding_id). " +
      "Remediate with add_firewall_default_deny.",
    fix: {
      name: "add_firewall_default_deny",
      title: "Add Firewall Default-Deny",
      description:
        "Applies default-deny remediations by finding_id from a prior audit_firewall_default_deny run: " +
        "inserts the canonical safe tail (accept established/related/untracked → drop invalid → final " +
        "unconditional drop), and/or re-enables a specific disabled catch-all drop (a separate finding_id, " +
        "since re-enabling a deliberately-disabled rule is a different risk than inserting a new tail). " +
        "DRY RUN unless confirm=true. Snapshots first and runs inside Safe Mode (auto-revert on lockout). " +
        "Idempotent: a re-run finds nothing to add.",
    },
  },
  {
    category: "address_list_enforcement",
    auditName: "audit_address_list_enforcement",
    auditTitle: "Audit Address-List Enforcement",
    auditDescription:
      "Read-only. Cross-references every address-list that is WRITTEN by an add-src/dst-to-address-list " +
      "rule against every list READ by a drop/reject (or escalation) rule, across `/ip firewall filter` " +
      "and `/ip firewall raw`. Flags lists that are populated but never blocked (the classic 'we detect " +
      "scanners/DDoS but never drop them' gap). Correctly does NOT flag staged escalation ladders " +
      "(stage1→stage2→stage3→blacklist) whose final list is enforced. Folds in a low-severity note when " +
      "detection lives entirely in filter with nothing in raw. Remediate with enforce_address_list_blocking.",
    fix: {
      name: "enforce_address_list_blocking",
      title: "Enforce Address-List Blocking",
      description:
        "For each unenforced-list finding_id from a prior audit_address_list_enforcement run, inserts a " +
        "drop rule matching that list (src- or dst- as appropriate) positioned before the chain's " +
        "default-deny tail. DRY RUN unless confirm=true. Snapshots first and runs inside Safe Mode.",
    },
  },
  {
    category: "kernel_ip_hardening",
    auditName: "audit_kernel_ip_hardening",
    auditTitle: "Audit Kernel IP Hardening",
    auditDescription:
      "Read-only. Checks `/ip settings` (and `/ipv6 settings`) for tcp-syncookies, rp-filter " +
      "(recommends strict on single-WAN, loose on multi-WAN — detected by counting default routes), " +
      "accept-source-route, and accept-redirects. Remediate with harden_kernel_ip_settings.",
    fix: {
      name: "harden_kernel_ip_settings",
      title: "Harden Kernel IP Settings",
      description:
        "Applies `/ip settings set` (and `/ipv6 settings set`) corrections for the kernel-hardening " +
        "finding_ids from a prior audit_kernel_ip_hardening run. DRY RUN unless confirm=true. Snapshots first.",
    },
  },
  {
    category: "ipv6_firewall_baseline",
    auditName: "audit_ipv6_firewall_baseline",
    auditTitle: "Audit IPv6 Firewall Baseline",
    auditDescription:
      "Read-only. When IPv6 is enabled and/or forwarding with no default-deny in `/ipv6 firewall filter`, " +
      "surfaces the exposure as TWO mutually-exclusive remediation options (distinct finding_ids): " +
      "Option A bootstrap a minimal safe IPv6 filter (accept established/related, keep RFC 4890 ICMPv6, " +
      "default-deny); Option B disable IPv6 forwarding when no IPv6 address is in use. Marks " +
      "needs_live_verification when zero IPv6 addresses are assigned (latent exposure). " +
      "Apply exactly one option via bootstrap_ipv6_firewall_baseline.",
    fix: {
      name: "bootstrap_ipv6_firewall_baseline",
      title: "Bootstrap IPv6 Firewall Baseline",
      description:
        "Applies ONE of the two mutually-exclusive IPv6 baseline finding_ids from a prior " +
        "audit_ipv6_firewall_baseline run (bootstrap filter, or disable forwarding). Pass exactly one " +
        "option's finding_id. DRY RUN unless confirm=true. Snapshots first and runs inside Safe Mode.",
    },
  },
  {
    category: "ssh_hardening",
    auditName: "audit_ssh_hardening",
    auditTitle: "Audit SSH Hardening",
    auditDescription:
      "Read-only. Checks `/ip ssh`: strong-crypto (auto-fixable), RSA host-key below 2048 bits and " +
      "host-key-type (report-only recommendation to migrate to ed25519 — regeneration invalidates " +
      "known_hosts, so never auto-applied), and always-allow-password-login. Remediate the auto-fixable " +
      "parts with harden_ssh_service.",
    fix: {
      name: "harden_ssh_service",
      title: "Harden SSH Service",
      description:
        "Applies the auto-fixable SSH finding_ids from a prior audit_ssh_hardening run (currently " +
        "strong-crypto=yes). Host-key regeneration is NEVER auto-applied (report-only). DRY RUN unless " +
        "confirm=true. Snapshots first and runs inside Safe Mode.",
    },
  },
  {
    category: "ip_service_exposure",
    auditName: "audit_ip_service_exposure",
    auditTitle: "Audit IP Service Exposure",
    auditDescription:
      'Read-only. For every enabled `/ip service` with address="" (unrestricted), checks whether an ' +
      "input firewall rule already scopes its port to trusted sources — if so it is NOT flagged (avoids " +
      "the Winbox false positive). Always flags telnet if enabled (cleartext). Flags a 7.15+ reverse-proxy " +
      'enabled with address="" and warns about multi-WAN reachability. Remediate with harden_ip_service_exposure.',
    fix: {
      name: "harden_ip_service_exposure",
      title: "Harden IP Service Exposure",
      description:
        "For the service-exposure finding_ids from a prior audit_ip_service_exposure run, restricts the " +
        "service address or disables it (telnet/reverse-proxy default to disable). DRY RUN unless " +
        "confirm=true. Snapshots first and runs inside Safe Mode.",
    },
  },
  {
    category: "connection_tracking_helpers",
    auditName: "audit_connection_tracking_helpers",
    auditTitle: "Audit Connection-Tracking Helpers",
    auditDescription:
      "Read-only. Flags enabled `/ip firewall service-port` helpers (h323, sip, pptp, irc, rtsp, udplite, " +
      "dccp, sctp, tftp) with no corresponding active service (e.g. pptp helper on with no pptp-server/" +
      "client). Most are needs_manual_review (static config can't fully prove non-use); pptp with no " +
      "server/client is auto-fixable. Remediate with harden_connection_tracking_helpers.",
    fix: {
      name: "harden_connection_tracking_helpers",
      title: "Harden Connection-Tracking Helpers",
      description:
        "Disables the auto-fixable helper finding_ids from a prior audit_connection_tracking_helpers run, " +
        "one at a time. DRY RUN unless confirm=true. Snapshots first.",
    },
  },
  {
    category: "management_plane_exposure",
    auditName: "audit_management_plane_exposure",
    auditTitle: "Audit Management-Plane Exposure",
    auditDescription:
      "Read-only. Bundles the smaller management-plane checks: mac-server / mac-winbox " +
      "allowed-interface-list=all, bandwidth-server unrestricted, romon enabled, neighbor discovery " +
      "scope, and default-named SNMP communities with open addresses. Most are report-only (the correct " +
      "LAN interface-list is site-specific); bandwidth-server disable is auto-fixable. Remediate the " +
      "auto-fixable parts with harden_management_plane_exposure.",
    fix: {
      name: "harden_management_plane_exposure",
      title: "Harden Management-Plane Exposure",
      description:
        "Applies the auto-fixable management-plane finding_ids from a prior audit run (e.g. disabling an " +
        "unused bandwidth-server). Site-specific restrictions remain report-only. DRY RUN unless " +
        "confirm=true. Snapshots first.",
    },
  },
  {
    category: "account_hygiene",
    auditName: "audit_account_hygiene",
    auditTitle: "Audit Account Hygiene",
    auditDescription:
      "Read-only, audit-only by design. Checks `/user settings` password policy (minimum-password-length, " +
      "minimum-categories), flags enabled accounts with obviously-temporary names (test/demo/temp/guest/" +
      "admin) across /user, /ppp secret and /user-manager, and flags read-tier groups granted broad " +
      "protocol access. Account deletion and group policy are manual decisions (needs_manual_review). " +
      "The password-policy settings can be applied with the narrow fix_password_policy tool.",
    fix: {
      name: "fix_password_policy",
      title: "Fix Password Policy",
      description:
        "Narrow companion to audit_account_hygiene: applies ONLY the `/user settings` password-policy " +
        "finding_ids (minimum-password-length, minimum-categories). Touches nothing else — account " +
        "deletion and group policy are never automated. DRY RUN unless confirm=true. Snapshots first.",
      gate: (f) => f.finding_id.startsWith("account:min-"),
    },
  },
  {
    category: "certificate_hygiene",
    auditName: "audit_certificate_hygiene",
    auditTitle: "Audit Certificate Hygiene (CRL)",
    auditDescription:
      "Read-only. Adds the CRL-policy check that cert_expiry_audit does not cover: flags " +
      "`/certificate settings` crl-use=no / crl-download=no when certificate-based services (OpenVPN " +
      "with client/server cert verification, SSTP with a certificate) are in active use. Remediate with " +
      "fix_certificate_crl_policy.",
    fix: {
      name: "fix_certificate_crl_policy",
      title: "Fix Certificate CRL Policy",
      description:
        "Sets crl-use=yes / crl-download=yes for the certificate finding_id from a prior " +
        "audit_certificate_hygiene run. Note: CRL download needs outbound reachability to the CRL " +
        "distribution point (may need a firewall allowance). DRY RUN unless confirm=true. Snapshots first.",
    },
  },
  {
    category: "network_segmentation",
    auditName: "audit_network_segmentation",
    auditTitle: "Audit Network Segmentation",
    auditDescription:
      "Read-only, report-only (no fix — this is architecture, not a bug). Flags a single PHYSICAL " +
      "interface carrying multiple non-overlapping subnets where one is a DHCP client pool and another " +
      "hosts server-like (NAT-target) addresses — a proxy for 'servers and clients share one L2 domain " +
      "with no VLAN isolation'. Reports the topology fact as proven and the isolation-absence claim as " +
      "needs_live_verification, and includes a concrete suggested VLAN plan. Never auto-applied.",
  },
  {
    category: "dns_resolver_exposure",
    auditName: "audit_dns_resolver_exposure",
    auditTitle: "Audit DNS Resolver Exposure",
    auditDescription:
      "Read-only. Flags `/ip dns allow-remote-requests=yes` when port 53 is not restricted to trusted " +
      "sources on BOTH TCP and UDP by an input firewall rule (catches the field trap where a rule covers " +
      "only one transport). Remediate with harden_dns_resolver_exposure.",
    fix: {
      name: "harden_dns_resolver_exposure",
      title: "Harden DNS Resolver Exposure",
      description:
        "For the DNS finding_id from a prior audit_dns_resolver_exposure run, either restricts input " +
        "port 53 (TCP+UDP) or disables allow-remote-requests (when the resolver only serves the router's " +
        "own DHCP clients). DRY RUN unless confirm=true. Snapshots first and runs inside Safe Mode.",
    },
  },
];

// ── Shared audit/fix handlers ───────────────────────────────────────────────

function auditToolFor(spec: CategoryTool) {
  return defineTool({
    name: spec.auditName,
    title: spec.auditTitle,
    annotations: READ,
    description: spec.auditDescription,
    async handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] ${spec.auditName}`);
      const state = await fetchSecurityState(ctx);
      const findings = auditCategory(spec.category, state);
      const report = { findings, summary: countSev(findings), total: findings.length };
      return renderHardeningReport(report, device);
    },
  });
}

function fixToolFor(spec: CategoryTool) {
  const fix = spec.fix!;
  return defineTool({
    name: fix.name,
    title: fix.title,
    annotations: SAFE_MODE_CATEGORIES.has(spec.category) ? DANGEROUS : WRITE_IDEMPOTENT,
    description: fix.description,
    inputSchema: {
      finding_ids: z
        .array(z.string())
        .min(1)
        .describe(`Specific finding_id(s) from a prior ${spec.auditName} run to remediate.`),
      confirm: z
        .boolean()
        .default(false)
        .describe(
          "Must be true to write. false (default) returns a dry-run preview and changes nothing.",
        ),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      const state = await fetchSecurityState(ctx);
      const found = auditCategory(spec.category, state);
      const { selected, unknown, skippedManual } = selectFindings(found, a.finding_ids, fix.gate);

      if (selected.length === 0) {
        return `No applicable findings for ${fix.name}.\n${
          unknown.length ? `Unknown/ineligible finding_id(s): ${unknown.join(", ")}\n` : ""
        }${
          skippedManual.length ? `Manual-review (no auto-fix): ${skippedManual.join(", ")}\n` : ""
        }Run ${spec.auditName} to get current finding_ids.`;
      }

      if (!a.confirm) {
        const preview = selected
          .map(
            (f) =>
              `# ${f.finding_id} [${f.severity}] ${f.title}\n${(f.fix ?? []).map((c) => `  ${c}`).join("\n")}`,
          )
          .join("\n\n");
        return `DRY RUN — ${selected.length} finding(s) would be applied (set confirm=true to apply):\n\n${preview}${
          unknown.length ? `\n\nUnknown finding_id(s): ${unknown.join(", ")}` : ""
        }${skippedManual.length ? `\n\nManual-review (no auto-fix): ${skippedManual.join(", ")}` : ""}`;
      }

      ctx.info(`[${device}] ${fix.name}: applying ${selected.length} finding(s)`);
      const { results, snapshotId, safeMode } = await applyFindings(
        ctx,
        selected,
        `pre-${fix.name}`,
      );
      return renderApply(results, unknown, skippedManual, snapshotId, safeMode);
    },
  });
}

/** Severity tally over a finding list (local mirror of the engine's summary). */
function countSev(findings: Finding[]): {
  critical: number;
  high: number;
  medium: number;
  low: number;
} {
  const s = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) s[f.severity]++;
  return s;
}

// ── Orchestrator tools ──────────────────────────────────────────────────────

const orchestratorTools: ToolModule = [
  defineTool({
    name: "run_security_hardening_audit",
    title: "Run Full Security Hardening Audit",
    annotations: READ,
    description:
      "Runs EVERY security-hardening category against the device in one pass (firewall default-deny, " +
      "address-list enforcement, kernel IP hardening, IPv6 baseline, SSH, IP service exposure, " +
      "connection-tracking helpers, management-plane exposure, account hygiene, certificate CRL policy, " +
      "network segmentation, DNS resolver exposure) and returns a single severity-ranked report. Every " +
      "finding carries a stable finding_id, category, severity, confidence (proven vs " +
      "needs_live_verification) and — where safe — an automated fix. Pure read, no confirm needed. " +
      "Feed the finding_ids you choose into apply_security_hardening_fixes. Narrow to one category with " +
      "the audit_* tools; for the broader firewall analysis use firewall_audit, and for the scored " +
      "compliance grade use run_compliance_audit.",
    inputSchema: {
      categories: z
        .array(z.enum(HARDENING_CATEGORIES as unknown as [string, ...string[]]))
        .optional()
        .describe(
          `Narrow to specific categories. Available: ${HARDENING_CATEGORIES.join(", ")}. Omit for all.`,
        ),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`[${device}] run_security_hardening_audit`);
      const state = await fetchSecurityState(ctx);
      const cats = (a.categories as HardeningCategory[] | undefined) ?? [...HARDENING_CATEGORIES];
      const report = runSecurityHardeningAudit(state, cats);
      return renderHardeningReport(report, device);
    },
  }),

  defineTool({
    name: "apply_security_hardening_fixes",
    title: "Apply Security Hardening Fixes",
    annotations: DANGEROUS,
    description:
      "Applies specific finding_ids from a prior run_security_hardening_audit, dispatching each to its " +
      "category's remediation in a SAFE ORDER (firewall default-deny and address-list enforcement before " +
      "service-exposure before helper/hygiene), all wrapped in ONE Safe-Mode session with ONE pre-change " +
      "snapshot. Returns a per-finding success/failure result plus the snapshot id (roll back with " +
      "diff_config_snapshots). DRY RUN unless confirm=true. NEVER accepts a blanket 'fix everything' flag — " +
      "you must pass explicit finding_ids sourced from an audit.",
    inputSchema: {
      finding_ids: z
        .array(z.string())
        .min(1)
        .describe(
          "Explicit finding_id(s) from a prior run_security_hardening_audit. No blanket apply.",
        ),
      confirm: z
        .boolean()
        .default(false)
        .describe(
          "Must be true to write. false (default) returns a dry-run preview and changes nothing.",
        ),
    },
    async handler(a, ctx) {
      const device = resolveDeviceName(ctx.device);
      const state = await fetchSecurityState(ctx);
      // Run every category so any requested finding_id can be resolved.
      const found = runSecurityHardeningAudit(state).findings;
      const { selected, unknown, skippedManual } = selectFindings(found, a.finding_ids);

      if (selected.length === 0) {
        return `No applicable findings.\n${
          unknown.length ? `Unknown/ineligible finding_id(s): ${unknown.join(", ")}\n` : ""
        }${
          skippedManual.length ? `Manual-review (no auto-fix): ${skippedManual.join(", ")}\n` : ""
        }Run run_security_hardening_audit to get current finding_ids.`;
      }

      if (!a.confirm) {
        const preview = orderFindingsForApply(selected)
          .map(
            (f) =>
              `# ${f.finding_id} [${f.severity}] ${f.category}: ${f.title}\n${(f.fix ?? []).map((c) => `  ${c}`).join("\n")}`,
          )
          .join("\n\n");
        return `DRY RUN — ${selected.length} finding(s) would be applied in safe order (set confirm=true to apply):\n\n${preview}${
          unknown.length ? `\n\nUnknown finding_id(s): ${unknown.join(", ")}` : ""
        }${skippedManual.length ? `\n\nManual-review (no auto-fix): ${skippedManual.join(", ")}` : ""}`;
      }

      ctx.info(`[${device}] apply_security_hardening_fixes: ${selected.length} finding(s)`);
      const { results, snapshotId, safeMode } = await applyFindings(
        ctx,
        selected,
        "pre-apply_security_hardening_fixes",
      );
      return renderApply(results, unknown, skippedManual, snapshotId, safeMode);
    },
  }),
];

// ── Module export ───────────────────────────────────────────────────────────

/** Sanity: keep the descriptor table in lockstep with the category list. */
const _coveredCategories = new Set(CATEGORY_TOOLS.map((c) => c.category));
for (const c of HARDENING_CATEGORIES) {
  if (!_coveredCategories.has(c))
    throw new Error(`security-hardening: category ${c} has no tool descriptor`);
}

export const securityHardeningTools: ToolModule = [
  ...CATEGORY_TOOLS.map(auditToolFor),
  ...CATEGORY_TOOLS.filter((c) => c.fix).map(fixToolFor),
  ...orchestratorTools,
];
