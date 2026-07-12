---
name: harden-against-bruteforce
title: Harden a router under SSH/Telnet brute-force attack
description: Stop an active SSH/Telnet/Winbox brute-force flood on a MikroTik — block the attacking IPs, install an auto-ban ladder + management lock-down, disable telnet — WITHOUT locking the operator out (trusted-IP gate, snapshot, Safe Mode, preview-then-confirm), then check for a compromised admin account.
arguments:
  - name: device
    description: Which configured device is under attack (config key or label from list_mikrotik_devices). Omit to discover and choose.
    required: false
  - name: management_ip
    description: The IP or CIDR you manage this router from (e.g. 203.0.113.5 or 203.0.113.0/24). This is the anti-lockout gate — it is accepted before any drop. Omit and you will be asked; never proceed without it.
    required: false
  - name: attacker_ips
    description: Comma-separated source IPs already known to be attacking (optional). Leave empty — this workflow reads the device's own error/critical/security logs and extracts the attacking IPs itself; anything you pass here is added on top.
    required: false
  - name: trusted_list_name
    description: Name of the existing trusted/management address-list on this device (e.g. Trust-IP). Omit to use/create a list named "trusted".
    required: false
---

You have MCP access to a MikroTik RouterOS device that is under an **active
SSH/Telnet/Winbox brute-force attack**. Harden it against the attack **without
locking the operator out**. Anti-lockout is the top priority: the operator's own
management access must be accepted BEFORE any drop, every write goes through a
snapshot + Safe Mode, and you PREVIEW then wait for explicit approval before
applying anything.

Target device: {{device}}
Management IP/CIDR (anti-lockout gate): {{management_ip}}
Trusted address-list: {{trusted_list_name}}
Extra attacker IPs (optional): {{attacker_ips}}

## 0. Discover the device (do this FIRST)

- Call `list_mikrotik_devices`; resolve `{{device}}` against it — never substitute
  a similar name. If it was omitted, present the inventory and ask which router is
  under attack. Pass that `device` on every subsequent call.

## 1. Read and PRINT the attack logs, then extract the attacking IPs

- Pull the device's own logs and show them to the operator:
  - `get_security_logs` — login failures and auth events, and
  - `get_logs_by_severity` with severity `critical` and again with `error` — the
    critical/error lines (e.g. `login failure for user … from <IP> via ssh/telnet`,
    `ssh-cmd:admin@<IP> …`, service malfunctions).
- **Print those error + critical/security lines back to the operator** so they can
  see the attack, then **extract every distinct source IP** from them (the address
  after `from ` on login-failure lines and after `ssh-cmd:<user>@` on script lines).
  Add any IPs given in `{{attacker_ips}}`. Present the deduplicated candidate
  blocklist to the operator with a one-line reason per IP (which log lines it came
  from). Do not write anything yet.

## 2. Anti-lockout gate — make sure YOU are trusted (before any drop)

- Read the trusted list: `list_address_lists` filtered to `{{trusted_list_name}}`
  (default `trusted`). Determine whether it exists and which IPs/CIDRs it contains.
- Decide the operator's whitelist:
  - If `{{management_ip}}` was provided, `add_address_list_entry` it into the trusted
    list (clear comment), then re-read and confirm it is present.
  - If `{{management_ip}}` is empty AND the trusted list is missing or empty,
    **STOP and ASK the operator**: "Which IP/CIDR do you manage this router from? I
    must whitelist it before dropping anything, or you could be locked out." Do NOT
    proceed to any drop until a trusted entry exists. If their IP is dynamic, ask for
    the ISP CIDR block, or advise connecting from a fixed IP / VPN first.
- Confirm the trusted list now contains at least the operator's own address.

## 3. Block the attacking IPs — but NEVER an entry that is trusted

- Cross-check the candidate blocklist from step 1 against the trusted list from
  step 2. **Remove from the blocklist any IP that is in — or is covered by a CIDR in —
  the trusted list**, plus the operator's `{{management_ip}}` and any RFC1918/LAN
  address. NEVER blacklist a trusted or management IP (that is a self-inflicted
  lockout). Show the operator the final block list and what was excluded and why.
- For each remaining IP, `add_address_list_entry` into the `security-shield-blacklist`
  list (the list `harden_firewall`'s drop rule matches) with a long timeout (e.g. `4w`).

## 4. Snapshot (rollback point)

- `capture_config_snapshot` and report the returned **snapshot_id**. Everything
  after this is reversible via `diff_config_snapshots from=<snapshot_id> to=live`.

## 5. PREVIEW the hardening (no writes) — then wait for approval

- Call `harden_firewall` with **`apply: false`** and:
  - `preset: "standard"` (accept established/related, drop invalid, SSH/Winbox
    brute-force auto-ban ladder, DDoS connection cap, SYN-flood + ICMP rate limits,
    port-scan detection, anti-spoof),
  - `protections: { raw_drops: true, mgmt_lockdown: true }` (drop blacklisted
    sources before connection tracking, and restrict management ports to trusted),
  - `trusted_sources: "{{trusted_list_name}}"` (the trusted address-list name — or
    the operator's `{{management_ip}}` directly),
  - `ssh_ports: "22"`, `mgmt_ports: "22,8291,8728"`,
  - `safe_mode: true`.
- Show the operator the exact rules it will add, and confirm the safety accepts
  (established/related + trusted) come BEFORE any drop. Do not proceed until the
  operator approves.

## 6. Apply (only after explicit approval)

- Re-issue the same `harden_firewall` call with **`apply: true`, `safe_mode: true`**.
  Safe Mode auto-reverts if a rule cuts the operator's own access. Report what was
  applied and on which device.

## 7. Kill telnet and harden SSH

- `disable_ip_service` name=`telnet` — telnet is cleartext and a top brute-force
  target; disable it outright (check `list_ip_services` first).
- Enable strong SSH crypto: `harden_ssh_service` (or set `strong-crypto=yes` on
  `/ip ssh`; read the current state with `get_ssh_settings` first).

## 8. Verify — and tell the operator to reconnect fresh

- `audit_firewall_hardening` (or `run_security_hardening_audit`) — confirm the
  brute-force ladder, drop-blacklisted, raw drops and management lock-down are
  present, and that the trusted/established accepts sit ABOVE the drops.
- **Instruct the operator to reconnect from a SEPARATE, FRESH session now** to
  confirm they are not locked out. If anything is wrong, roll back with
  `diff_config_snapshots from=<snapshot_id> to=live` and the snapshot tools.

## 9. Check for a compromised admin (if the log showed logins, not just failures)

Brute-force logs that show a source actually _executing commands_ as a user (e.g.
`ssh-cmd:admin@<ip>` running an unexpected command) can mean the account was
guessed — a known RouterOS botnet pattern. If so:

- `list_users` — flag any account the operator doesn't recognise.
- `list_schedulers` and `list_scripts` — flag anything they didn't create (botnet
  backdoors hide here). Do NOT delete anything without the operator's explicit say-so.
- Recommend rotating the admin password to a long random one and renaming the
  `admin` user. Consider enabling management-from-trusted-only (already covered by
  `mgmt_lockdown` in step 5) so brute-force can't reach SSH/Winbox at all.

---

Hard rules: read and show the logs before deciding anything; **never blacklist an IP
that is in the trusted list or is the operator's own management IP** — cross-check
every candidate against the trusted list first; never apply a firewall drop unless
the operator's IP is in the trusted list (ask for it if unknown, don't guess); always
snapshot + Safe Mode before writes; preview then wait for explicit approval; state
plainly which device each change ran on; never delete accounts, schedulers or scripts
without the operator's confirmation.
