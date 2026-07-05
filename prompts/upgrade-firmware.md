---
name: upgrade-firmware
title: Upgrade RouterOS firmware safely
description: Check for updates, capture a health baseline, stage packages, and apply the upgrade with automatic rollback on failure.
arguments:
  - name: channel
    description: Update channel — "stable", "long-term", or "testing". Default is the device's current channel.
    required: false
---

Upgrade this MikroTik device's RouterOS firmware safely. The upgrade pipeline
captures a health baseline before upgrading so you can verify the device is
healthy afterwards — and RouterOS will automatically fall back to the previous
version if the upgrade fails.

Update channel: {{channel}}

Follow these steps in order:

1. **Check for updates.** Call `firmware_check` to discover available versions,
   compare against the current version, and assess upgrade readiness (CPU load,
   free memory, version jump size). If no update is available, report that and
   stop.

2. **Capture a restore point.** Call `capture_config_snapshot` with
   `label=pre-upgrade` to store the current `/export` locally. This is your
   rollback reference — zero footprint on the device's flash.

3. **Review the upgrade plan.** Present: current version → target version, the
   version jump (major/minor/patch), and any readiness warnings from step 1.
   Confirm with the user before proceeding.

4. **Stage the packages.** Call `firmware_stage` to pre-download the update
   packages without rebooting. This lets you verify the download succeeds before
   committing to the reboot.

5. **Apply the upgrade.** Call `firmware_upgrade` to install and reboot. The
   device will come back on the new version. If it fails to boot, RouterOS
   automatically falls back to the previous version.

6. **Verify post-upgrade health.** Call `firmware_status` — it compares the
   current system health against the pre-upgrade baseline and reports any
   regressions (CPU, memory, package changes, RouterBOARD firmware status).

7. **Confirm.** Report the old version, new version, health comparison, and
   whether the RouterBOARD firmware also needs upgrading (if applicable).

Do not proceed past step 3 without user approval.
