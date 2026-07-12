---
name: setup-port-scan-detection
title: Set up port-scan detection (detect + tag, never block)
description: Pick a device, present the six port-scan signatures, let the user choose which to enable, validate the trust list, then install them into a trust-excluding detect-portscan jump-gate — snapshotted and applied under Safe Mode. Detects and tags scanners; never blocks.
arguments:
  - name: device
    description: Which configured device to protect (config key or label from list_mikrotik_devices). Omit to discover the devices and let the user choose.
    required: false
  - name: trusted_list_name
    description: The existing management/trusted address-list on that device (e.g. Trust-IP). Omit to discover it and confirm with the user — it must already exist and contain the address you manage the device from.
    required: false
---

You are setting up **port-scan detection** on a MikroTik router managed by this
MCP server. These rules **detect and tag** a scanning source into an address list
(default `port scanners`) — they **never drop or block** anything. Blocking is a
separate, deliberately out-of-scope concern (see the closing note). The server may
manage several routers, so establish which one first, and **never enable a
signature the user did not explicitly choose.**

Target device: {{device}}
Trusted list: {{trusted_list_name}}

## 0. Discover the device (do this FIRST)

- Call `list_mikrotik_devices` to enumerate the configured routers (key, label,
  transport target, default).
- Resolve `{{device}}` against that inventory. If it doesn't match a known key or
  label, STOP and show the list — never substitute a similar name. If it was
  omitted, present the inventory and **ask which device to protect.** Pass that
  device on every subsequent tool call.

## 1. Present the catalog and get an EXPLICIT selection (mandatory)

- Call `list_port_scan_detection_signatures` (with the chosen `device` so it also
  reports which signatures are already present). Show the user **all six** with
  their one-line descriptions and exact match syntax:
  - `psd_generic` — "Port scanners to list" — RouterOS built-in PSD heuristic;
    catches ordinary `nmap -sT/-sS` sweeps the flag signatures can't see.
  - `nmap_fin_stealth` — "NMAP FIN Stealth scan" — lone FIN (`nmap -sF`).
  - `syn_fin_scan` — "SYN/FIN scan" — impossible SYN+FIN combo.
  - `syn_rst_scan` — "SYN/RST scan" — impossible SYN+RST combo.
  - `fin_psh_urg_scan` — "FIN/PSH/URG scan" — Nmap `-sX` Xmas scan.
  - `nmap_null_scan` — "NMAP NULL scan" — Nmap `-sN`, no flags set.
- **Ask the user which specific signature IDs to enable.** Do NOT infer, do NOT
  default to all six, do NOT default to none. Wait for an explicit list. There is
  no select-all. A good default suggestion to offer (but still confirm): all six,
  since they only tag and don't block — but the choice is the user's.

## 2. Validate the trust list (pre-flight, before any write)

The detection chain is gated by a single `input` jump that EXCLUDES a trusted
address-list, so a trusted source is never tagged. That protection is only real if
the trust list exists and contains your management address:

- Determine `{{trusted_list_name}}` — the actual management/trusted list on THIS
  device (commonly `Trust-IP`, but confirm; there is no default). If omitted, call
  `list_address_lists` (`device=<name>`) and ask the user which list holds their
  trusted management addresses.
- Confirm with `list_address_lists` that the list **exists and is non-empty**. If
  it is missing or empty, STOP: this design protects nothing without it. Guide the
  user to create/populate it with their management address(es) first (e.g.
  `add_address_list_entry list=<trusted_list_name> address=<your-mgmt-IP>`). Do NOT
  auto-create or auto-populate it as part of this flow.
- **Explicitly ask the human to confirm** that the address they are currently
  managing this device from is in that list. The tool cannot know which IP you
  connect from, so this is a human acknowledgement — you will pass it as
  `confirmed_trusted_list_includes_my_ip=true`, and you may only set it after the
  user has said yes.

## 3. Apply (only after the selection + trust confirmation)

- Call `add_port_scan_detection_rules` with:
  - `device` = the chosen device,
  - `rule_types` = **exactly** the signature IDs the user named (non-empty),
  - `trusted_list_name` = the validated list,
  - `address_list_name` (optional, default `"port scanners"`),
  - `address_list_timeout` (optional, default `"2w"`),
  - `confirm=true`,
  - `confirmed_trusted_list_includes_my_ip=true`.
- The tool: captures a config snapshot (returns a `snapshot_id`), creates the
  `detect-portscan` chain if absent, installs the single trust-excluding jump —
  positioned **before** the input default-deny (or appended after the management
  accepts if there is none), inserts only the not-yet-present signatures, and
  applies everything inside **Safe Mode** (auto-reverts if your session drops).
- It is **idempotent**: re-running with the same selection adds nothing and reports
  already-present rules. It will refuse if `rule_types` is empty, contains an
  unknown value, or if the trust list is missing/empty.

## 4. Verify management access (do not skip)

- Present the tool's result: the `snapshot_id`, which signatures were added vs.
  already present, the jump gate's position relative to the default-deny, and the
  final `detect-portscan` chain.
- **Instruct the user to verify their management access (SSH/Winbox/whatever they
  use) from a SEPARATE, FRESH connection now**, before considering the change
  final. Safe Mode's auto-revert is the safety net, but confirm no lockout. If
  anything is wrong, roll back with
  `diff_config_snapshots from=<snapshot_id> to=live` and the snapshot tools.
- If the tool noted this device has **no input default-deny**, mention it as an
  unrelated observation — do not fix it here (out of scope).

## Scope — detection only

These rules only populate the `port scanners` list; they do not block it. To turn
that list into an active drop, use the separate, purpose-built
`enforce_address_list_blocking` (Security Hardening) after confirming your trusted
sources are safely excluded — never fold blocking into this detection step. Do not
enable any signature the user didn't explicitly choose.
