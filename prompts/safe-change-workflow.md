---
name: safe-change-workflow
title: Safe change workflow (snapshot → plan → verify)
description: Take a local restore point, dry-run a change, apply it safely, and confirm exactly what changed — with zero footprint on the device's disk.
arguments:
  - name: intent
    description: What you want to change, in plain language (e.g. "add a drop rule for inbound WAN on ether1").
    required: false
---

Make a configuration change to this MikroTik device **safely and reversibly**.
Follow these steps in order — never skip the snapshot.

**Goal:** {{intent}}

1. **Take a restore point FIRST (local, no device disk).**
   Call `capture_config_snapshot` before doing anything else. This runs a
   read-only `/export` and stores it in the MCP host's local database
   (`~/.mikrotik-mcp/snapshots.db`). It does **not** create a file on the
   router — there is zero load on the MikroTik device's flash and nothing to
   clean up on the device afterwards. Give it a descriptive `label` (e.g.
   `pre-<change>`). Do **not** use `create_backup` / `create_export` for this —
   those write files to the device's disk; the local snapshot keeps the router
   clean.

2. **Dry-run the change.** Translate the intent into RouterOS CLI commands and
   call `plan_changes` to get a risk-scored, lock-out-aware, safely-ordered plan
   without touching the device. Review the warnings (input-chain drops, removal
   of the management IP, etc.).

3. **Apply in Safe Mode.** Call `apply_plan` with `confirm=false` first — it
   applies every step inside RouterOS Safe Mode, shows the exact before/after
   diff, then rolls everything back (a true dry-run on the live device). When the
   diff looks right, re-run with `confirm=true` to commit; it only persists if
   the device is still reachable, so a change that would lock you out
   auto-reverts.

4. **Verify what changed.** After committing, call `diff_config_snapshots` with
   `from=latest` and `to=live` to confirm the live device matches your intent and
   nothing unexpected drifted.

5. **If something is wrong**, read the pre-change snapshot body with
   `get_config_snapshot` (it returns the full `/export` `.rsc` text) and use it to
   reverse the change.

6. **Set a golden baseline (optional).** If the change is intentional and
   permanent, call `config_set_baseline` to designate the new state as the
   golden-config baseline. Future drift can then be detected automatically with
   `config_check_drift` — it reports exactly what changed, who changed it (from
   system logs), and scores the severity.

Report: the snapshot id you captured, the plan summary, the committed diff, and
the post-change verification result.
