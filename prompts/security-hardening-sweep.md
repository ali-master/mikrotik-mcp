---
name: security-hardening-sweep
title: Security hardening sweep (pick device → audit → fix by finding)
description: Discover the configured MikroTik devices, let the user choose which one to harden, then run the granular Security Hardening suite — per-category, evidence-based findings with a stable finding_id — and remediate only the findings the user approves, safely (snapshot + Safe Mode).
arguments:
  - name: device
    description: Which configured device to harden (its config key or friendly label from list_mikrotik_devices). Omit to discover the devices and let the user choose.
    required: false
  - name: categories
    description: Comma-separated category slugs to scope the sweep (e.g. "firewall_default_deny,dns_resolver_exposure"). Omit to let the user pick a hardening goal (All / DDoS / port-scanning / remote-management / …), which you translate into these slugs.
    required: false
---

You are running a **granular, evidence-based security hardening sweep** on a
MikroTik RouterOS device managed by this MCP server. This server may manage
**several routers**, so you MUST establish which one to harden before touching
anything. Unlike a scored compliance grade, this suite finds each specific
misconfiguration, gives it a stable `finding_id`, and lets you remediate
**exactly the findings the user approves — one at a time, by ID.** Work safely:
pick the device, audit, present findings, and never write without explicit approval.

Requested device: {{device}}
Categories to scope: {{categories}}

Follow this workflow:

0. **Discover devices and confirm the target (do this FIRST, always).**
   - Call `list_mikrotik_devices` to enumerate every configured router — its
     config key, friendly label, transport target (host/MAC), and which is the
     default.
   - **If `{{device}}` was provided**, resolve it against that inventory. If it
     doesn't match a known key or label, STOP and show the user the available
     devices so they can correct it — never guess or substitute a similar name
     (these are different physical routers).
   - **If `{{device}}` was NOT provided**, present the inventory as a short list
     and **ask the user which device they want to harden.** Do not proceed to the
     audit until they choose. If exactly one device is configured, name it and
     confirm before continuing.
   - Once chosen, pass that device on **every** subsequent tool call via the
     `device` argument (audit, apply, snapshot, and verify calls all target the
     same router). State plainly which device you are operating on.

0.5 **Choose WHAT to harden (do this before the audit).**

- **If `{{categories}}` was provided**, use those slugs directly and skip the menu.
- **Otherwise, offer the user a plain-language goal menu** and let them pick one
  or more. Then translate their choice into the category slugs below and pass
  them as the `categories` argument to the audit. Suggested menu:

| Goal (what to say to the user)                                                               | Category slugs to audit                                                                             |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Everything** (full hardening pass)                                                         | _(omit `categories` — runs all 12)_                                                                 |
| **DDoS protection** (enforce populated DDoS lists, SYN-cookies, close open resolver)         | `address_list_enforcement`, `firewall_default_deny`, `kernel_ip_hardening`, `dns_resolver_exposure` |
| **Prevent port scanning** (nmap etc. — enforce scanner detection lists, close the perimeter) | `address_list_enforcement`, `firewall_default_deny`                                                 |
| **Lock down remote management** (brute-force ladders, exposed services, the Winbox trap)     | `firewall_default_deny`, `ip_service_exposure`, `ssh_hardening`, `management_plane_exposure`        |
| **Close open/unused services** (telnet, reverse-proxy, unused conntrack helpers)             | `ip_service_exposure`, `connection_tracking_helpers`, `management_plane_exposure`                   |
| **Anti-spoofing / kernel hardening** (rp-filter, source-route, redirects)                    | `kernel_ip_hardening`                                                                               |
| **IPv6 safety** (forwarding with no filter)                                                  | `ipv6_firewall_baseline`, `kernel_ip_hardening`                                                     |
| **DNS resolver safety** (open-resolver / amplification)                                      | `dns_resolver_exposure`                                                                             |
| **Account & credential hygiene** (password policy, stray accounts)                           | `account_hygiene`                                                                                   |
| **Certificate hygiene** (CRL checking)                                                       | `certificate_hygiene`                                                                               |
| **Network segmentation review** (flat L2, servers + clients share a domain)                  | `network_segmentation`                                                                              |

- Present these as a short numbered list (goal + one-line "what it covers"), ask
  the user to choose, and confirm the resulting slug set before auditing. The
  user may combine goals — union the slugs.
- **Scope caveat — enforcement vs. detection.** This suite _enforces_ protections
  the config already implies (e.g. it turns an existing-but-unblocked
  `port scanners` / `ddoser` address-list into an active drop, and closes an open
  resolver). It does NOT create brand-new detection rules. If the user wants to
  _add_ fresh DDoS rate-limiting or port-scan (`psd`) detection where none exists,
  point them to `harden_firewall` (Security Shield: `ddos_conn_limit`, `syn_flood`,
  `port_scan` presets) and run this sweep afterwards to confirm the new lists are enforced.

1. **Audit (read-only).** Call `run_security_hardening_audit` with
   `device=<chosen device>` and `categories=<the slugs from step 0.5>` (omit
   `categories` for a full pass). It covers firewall default-deny, address-list
   enforcement, kernel IP hardening, IPv6 baseline, SSH, IP service exposure,
   connection-tracking helpers, management-plane exposure, account hygiene,
   certificate CRL policy, network segmentation, and DNS resolver exposure, and
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
   findings to fix, preview first. Call `apply_security_hardening_fixes` with
   `device=<chosen device>`, the chosen `finding_ids`, and `confirm` omitted/false
   — this returns a **dry run** of the exact commands in safe apply order
   (default-deny and address-list enforcement before service exposure before
   helpers/hygiene). Per-category tools (`add_firewall_default_deny`,
   `enforce_address_list_blocking`, `harden_kernel_ip_settings`,
   `harden_ssh_service`, `harden_dns_resolver_exposure`, `fix_password_policy`, …)
   offer the same dry-run preview for a single category — pass `device=` on those too.

5. **Apply (only with explicit approval).** Re-issue the call with `device=<chosen
device>` and `confirm=true`. The tool captures a pre-change **snapshot** (returns
   a `snapshot_id`), wraps any lockout-risky change in **Safe Mode** (auto-reverts
   if your session drops), applies each finding's fix, and commits. Report the
   per-finding results, the `snapshot_id`, and the device it ran on.

6. **Verify.** Re-run `run_security_hardening_audit` on the same `device=` to
   confirm the applied findings no longer appear (the suite is idempotent — a
   re-run of a fixed finding is a no-op). If anything looks wrong, roll back with
   `diff_config_snapshots device=<chosen device> from=<snapshot_id> to=live` and the
   snapshot tools.

Finish with a short prioritized checklist (Critical / Recommended / Optional /
Manual-review) and the exact `finding_id`s and tool calls for each tier — each
call carrying the `device` argument. Never pass a blanket "fix everything" request
— always remediate explicit finding_ids the user approved on the chosen device.
If the user wants to harden **more than one** router, repeat this whole workflow
per device (each has its own findings, snapshot, and Safe-Mode session); do not
mix finding_ids across devices. For a scored A+–F posture grade instead, use
`run_compliance_audit`; for shadowed/broad/dead-rule analysis, use `firewall_audit`.
