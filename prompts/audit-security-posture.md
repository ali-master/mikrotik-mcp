---
name: audit-security-posture
title: Run a compliance security audit
description: Comprehensive security audit across SSH, services, firewall, users, DNS, certificates, SNMP, hardening, and VPN — scored A+ through F with actionable fix commands.
arguments:
  - name: categories
    description: Comma-separated categories to audit (e.g. "ssh,firewall,users"). Omit for a full audit across all 9 categories.
    required: false
---

Run a comprehensive security compliance audit on this MikroTik device. The audit
covers 36 checks across 9 categories — SSH, management services, firewall, user
accounts, DNS, certificates, SNMP, system hardening, and VPN — and scores the
device from A+ (excellent) down to F (critical).

Categories to audit: {{categories}}

Follow this workflow:

1. **Run the audit.** Call `run_compliance_audit` (optionally filtered to
   `{{categories}}`). Review the per-check results: each check reports pass, fail,
   or warn with a severity level and a specific fix command.

2. **Present the results.** Organize findings by severity (critical → low):
   - The overall grade (A+ through F) and numeric score.
   - A summary table of failed and warning checks.
   - For each failing check: what it found, why it matters, and the exact fix
     command provided by the audit engine.

3. **Remediate (with user approval).** If the user wants to fix failing checks,
   call `audit_remediate` with `dry_run=true` first to preview what commands would
   run. Then, with approval, call `audit_remediate` with `dry_run=false` to apply.

4. **Re-audit.** After remediation, run `run_compliance_audit` again to confirm
   the score improved and no new issues were introduced.

5. **Fleet-wide (optional).** If multiple devices are configured, offer to run
   `audit_fleet` for a consolidated report with aggregate scores and the most
   common failures across the fleet.

Do not apply any fixes without user approval. Present the audit report first.
