---
name: disaster-recovery-drill
title: Rehearse a disaster recovery scenario
description: Simulate a failure in Safe Mode, verify the backup/restore path works, then auto-revert — proving your DR plan without risk.
arguments:
  - name: scenario
    description: What failure to simulate (e.g. "lose WAN interface", "delete all firewall rules", "disable OSPF", "remove default route"). If omitted, a sensible scenario will be chosen.
    required: false
---

Rehearse a disaster recovery scenario on this MikroTik device **without any
lasting impact**. The drill uses RouterOS Safe Mode to simulate a failure, verify
the backup and restore path works, then auto-revert everything. This proves your
DR plan actually works — safely.

Scenario to simulate: {{scenario}}

Follow these steps:

1. **Take a restore point.** Call `capture_config_snapshot` with
   `label=pre-dr-drill` so you have a reference even outside Safe Mode.

2. **Run the drill.** Call `run_failover_drill` with the scenario description.
   The drill will:
   - Enter Safe Mode (all changes auto-revert if something goes wrong).
   - Apply the simulated failure (e.g. disable the WAN interface).
   - Assess the impact: what broke, what services are affected.
   - Verify the recovery path: can the backup restore the state?
   - Auto-revert all changes — the device returns to its pre-drill state.

3. **Review the drill report.** Present:
   - What was simulated and what broke as a result.
   - Whether the backup/restore path would have recovered the device.
   - Time to recovery (how long the revert took).
   - Any gaps in the DR plan (e.g. no backup exists, restore would miss X).

4. **Recommendations.** Based on the drill results, suggest improvements:
   - Missing backups or snapshots to create.
   - Configuration changes that would improve resilience.
   - Monitoring or alerting to add (e.g. netwatch for the WAN link).

The drill is **non-destructive** — Safe Mode ensures everything reverts. Report
the full drill outcome and recommendations.
