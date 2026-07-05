---
name: detect-config-drift
title: Detect and resolve config drift
description: Compare live router config against a golden baseline, identify who changed what and when, then roll back or accept the drift.
arguments:
  - name: action
    description: What to do — "check" (detect drift), "reconcile" (roll back to baseline), or "promote" (accept drift as new baseline). Default is "check".
    required: false
---

Work with the Config Drift Guardian on this MikroTik device. The drift system
compares the live `/export` against a stored golden baseline and reports exactly
what changed, who changed it (from system logs), and scores the severity 0–100.

Requested action: {{action}}

Follow the workflow for the requested action:

**If checking (or no action specified):**

1. **Verify baseline exists.** Call `config_check_drift`. If it reports "no
   baseline set", guide the user to set one first with `config_set_baseline`
   (captures the current config as the known-good reference).

2. **Review the drift report.** Present:
   - Drift score (0–100) and overall status (in-sync or drifted).
   - Per-section breakdown: which RouterOS sections changed and by how much.
   - Change attribution: who made each change and when (from system logs).
   - The unified diff showing exact added/removed lines.

3. **Recommend next steps.** Based on the drift:
   - If changes are intentional → suggest `config_promote_drift` to accept.
   - If changes are unwanted → suggest `config_reconcile` to roll back.

**If reconciling:**

1. Call `config_reconcile` with `confirm=false` first (dry-run). This replays the
   baseline commands in Safe Mode and then rolls back, showing what would change.
2. Review the dry-run output with the user.
3. With approval, call `config_reconcile` with `confirm=true` to commit. Safe Mode
   ensures automatic rollback if the device becomes unreachable.

**If promoting:**

1. Call `config_promote_drift` to accept the current live config as the new golden
   baseline. Optionally provide a `label` and `notes` explaining why the drift is
   being accepted.
2. Confirm the new baseline ID and that the old baseline is preserved in snapshot
   history.

Always explain the consequences before taking action.
