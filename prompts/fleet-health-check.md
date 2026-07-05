---
name: fleet-health-check
title: Fleet-wide health and compliance sweep
description: Check reachability, resource usage, firmware currency, security posture, and config drift across all configured devices.
arguments: []
---

Run a comprehensive health and compliance sweep across **all configured MikroTik
devices** accessible through this server. This is a read-only operation — no
changes are made.

Steps:

1. **List all devices.** Call `list_devices` to get every configured device and
   its connection status.

2. **Per-device health check.** For each reachable device (pass `device=<name>`
   on each tool call):
   - **System resources:** `get_system_resources` — CPU load, memory usage, disk
     usage, uptime. Flag any device above 80% CPU or memory.
   - **Firmware currency:** `firmware_check` — is an update available? How far
     behind is the installed version?
   - **Security posture:** `run_compliance_audit` — get the A+ through F grade
     and count of critical/warning findings.
   - **Config drift:** `config_check_drift` — if a golden baseline is set, report
     whether the device has drifted and the severity score. Skip if no baseline.

3. **Fleet summary.** Present a consolidated report:
   - A table with one row per device: name, status, CPU%, memory%, firmware
     version, update available, compliance grade, drift status.
   - **Alerts:** devices with critical resource usage, outdated firmware, poor
     compliance scores, or unresolved drift.
   - **Prioritized actions:** what to address first (e.g. "device-X has an F
     security grade — run the hardening prompt", "device-Y is 3 versions behind —
     run the firmware upgrade prompt").

4. **Unreachable devices.** List any devices that couldn't be reached and suggest
   troubleshooting steps (check SSH connectivity, credentials, network path).

This is a reporting-only sweep. Recommend specific prompts or tools for each
finding but do not make changes.
