---
name: harden-router
title: Harden a RouterOS device
description: Audit and tighten a MikroTik router's security posture — management services, firewall input chain, users, and DNS.
arguments:
  - name: wan_interface
    description: The WAN-facing interface name (e.g. ether1, pppoe-out1). If unknown, discover it first.
    required: false
---

You are securing a MikroTik RouterOS device exposed through this MCP server. Work
**safely and incrementally**: inspect first, propose a plan, and prefer Safe Mode
for risky firewall changes so a mistake auto-reverts instead of locking us out.

WAN interface: {{wan_interface}}

Carry out a hardening pass in this order, explaining each finding:

1. **Baseline** — `get_system_identity`, `get_system_resources`, `get_installed_packages`,
   and `list_interfaces` to understand the device and confirm the WAN interface.
2. **Management surface** — `list_ip_services`. Flag any enabled plaintext service
   (telnet, ftp, www, api). Recommend `disable_ip_service` for telnet/ftp and
   restricting the rest with `set_ip_service` (set `address=` to trusted subnets,
   move ssh off port 22 if appropriate).
3. **Users** — `list_users` and `list_user_groups`. Flag the default `admin`
   account, weak/absent passwords, and over-broad group policies.
4. **Firewall input chain** — `list_filter_rules` with `chain=input`. Verify there
   is an established/related accept, an ICMP accept, a trusted-management accept,
   and a final drop. If the input chain is empty or permissive, propose concrete
   `create_filter_rule` calls. **Enable Safe Mode** (`enable_safe_mode`) before
   applying, verify connectivity, then `commit_safe_mode`.
5. **Discovery/Neighbour exposure** — check for MAC-server / neighbor-discovery /
   bandwidth-test left open on the WAN.
6. **DNS** — `get_dns_settings`; if `allow-remote-requests` is yes, ensure UDP/TCP
   53 from WAN is dropped.
7. **SSH hardening** — `get_ssh_server_settings`; recommend strong-crypto only,
   disable password auth if SSH keys are already deployed for admin users, and
   consider changing the default port.
8. **Automated DDoS / brute-force protection** — consider `harden_firewall` (the
   Security Shield) to deploy rate-limiting rules for SSH/Winbox brute-force,
   SYN floods, port scans, and IP spoofing in one step.
9. **Full compliance audit** — for a comprehensive automated check across all 36
   security dimensions, run `run_compliance_audit`. It scores the device A+
   through F and provides per-check fix commands. Use this to catch anything the
   manual steps above may have missed.

Finish with a short prioritized checklist (Critical / Recommended / Optional) and
the exact tool calls you would run for each. Do not make changes the user hasn't
approved.
