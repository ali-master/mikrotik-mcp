---
name: security-hardening-sweep
title: Security hardening sweep (audit → fix by finding)
description: Run the granular Security Hardening suite — per-category, evidence-based findings with a stable finding_id — then remediate only the findings the user approves, safely (snapshot + Safe Mode).
arguments:
  - name: categories
    description: Comma-separated categories to scope the sweep (e.g. "firewall_default_deny,dns_resolver_exposure"). Omit for all 12 categories.
    required: false
---

You are running a **granular, evidence-based security hardening sweep** on this
MikroTik RouterOS device. Unlike a scored compliance grade, this suite finds each
specific misconfiguration, gives it a stable `finding_id`, and lets you remediate
**exactly the findings the user approves — one at a time, by ID.** Work safely:
audit first, present findings, and never write without explicit approval.

Categories to scope: {{categories}}

Follow this workflow:

1. **Audit (read-only).** Call `run_security_hardening_audit` (optionally scoped to
   `{{categories}}`). It runs every category — firewall default-deny, address-list
   enforcement, kernel IP hardening, IPv6 baseline, SSH, IP service exposure,
   connection-tracking helpers, management-plane exposure, account hygiene,
   certificate CRL policy, network segmentation, and DNS resolver exposure — and
   returns one severity-ranked report. This is pure read: no confirmation needed.

2. **Present the findings.** Organize by severity (critical → low). For each
   finding, show:
   - the `finding_id`, category, and severity;
   - the **confidence**: `proven` (settled by static config) vs
     `needs_live_verification` (latent, or dependent on runtime chain/NAT
     interaction). Call these out separately — never present a speculative finding
     with the same certainty as a proven one.
   - the exact target (`.id`/rule signature), the current value, and the proposed
     action;
   - whether it has an automated fix or is **manual-review only** (e.g. suspicious
     accounts, group policy, and network segmentation are never auto-applied).

3. **Note the two special cases.**
   - **IPv6 baseline (4.4)** surfaces as two _mutually-exclusive_ options with
     distinct finding_ids — bootstrap a safe IPv6 filter, or disable IPv6
     forwarding. Help the user pick exactly one; do not apply both.
   - **Disabled-enforcement drop (the Winbox trap)** — re-enabling a deliberately
     disabled drop is a separate finding_id from inserting a new default-deny.
     Confirm the admin didn't disable it on purpose before re-enabling.

4. **Plan the remediation (with user approval).** Once the user chooses which
   findings to fix, preview first. Call `apply_security_hardening_fixes` with the
   chosen `finding_ids` and `confirm` omitted/false — this returns a **dry run** of
   the exact commands in safe apply order (default-deny and address-list
   enforcement before service exposure before helpers/hygiene). Per-category tools
   (`add_firewall_default_deny`, `enforce_address_list_blocking`,
   `harden_kernel_ip_settings`, `harden_ssh_service`, `harden_dns_resolver_exposure`,
   `fix_password_policy`, …) offer the same dry-run preview for a single category.

5. **Apply (only with explicit approval).** Re-issue the call with `confirm=true`.
   The tool captures a pre-change **snapshot** (returns a `snapshot_id`), wraps any
   lockout-risky change in **Safe Mode** (auto-reverts if your session drops),
   applies each finding's fix, and commits. Report the per-finding results and the
   `snapshot_id`.

6. **Verify.** Re-run `run_security_hardening_audit` to confirm the applied
   findings no longer appear (the suite is idempotent — a re-run of a fixed finding
   is a no-op). If anything looks wrong, roll back with
   `diff_config_snapshots from=<snapshot_id> to=live` and the snapshot tools.

Finish with a short prioritized checklist (Critical / Recommended / Optional /
Manual-review) and the exact `finding_id`s and tool calls for each tier. Never pass
a blanket "fix everything" request — always remediate explicit finding_ids the user
approved. For a scored A+–F posture grade instead, use `run_compliance_audit`; for
shadowed/broad/dead-rule analysis, use `firewall_audit`.
