---
name: setup-l2tp-ipsec-roadwarrior
title: Set up L2TP/IPsec remote access (road warrior)
description: Configure an L2TP-over-IPsec server so laptops and phones can connect with their built-in VPN client.
arguments:
  - name: vpn_pool
    description: The address range handed to VPN clients, e.g. 192.168.89.10-192.168.89.254.
    required: true
  - name: local_gateway
    description: The router's address on the VPN/LAN side that clients use as gateway/DNS, e.g. 192.168.89.1.
    required: true
---
Configure **L2TP/IPsec** remote access — the right choice when users must connect
with the **built-in** VPN client on Windows, macOS, iOS, and Android (no app to
install). Plan first, then apply (firewall under Safe Mode).

Client address pool: {{vpn_pool}}
Gateway / DNS for clients: {{local_gateway}}

Build order:

1. **IP pool** — `create_ip_pool` for {{vpn_pool}} (e.g. name `l2tp-pool`).
2. **PPP profile** — `create_ppp_profile` (name `l2tp-profile`,
   `local_address={{local_gateway}}`, `remote_address=l2tp-pool`,
   `dns_server={{local_gateway}}`, `change_tcp_mss=yes`).
3. **User accounts** — `create_ppp_secret` per user with
   `service=l2tp` and `profile=l2tp-profile`. Use strong passwords.
4. **Enable the server** — `set_l2tp_server` with `enabled=true`,
   `default_profile=l2tp-profile`, `use_ipsec=required`, and a strong
   `ipsec_secret` (this is the IPsec pre-shared key clients enter).
   `authentication=mschap2`.
5. **Firewall** — accept UDP 500, UDP 4500, UDP 1701, and IP protocol 50 (ESP)
   on the input chain from the internet; allow the {{vpn_pool}} range to reach the
   LAN/internet in the forward chain as required. Apply under `enable_safe_mode`,
   verify you can still reach the router, then `commit_safe_mode`.
6. **Verify** — `get_l2tp_server`, then `get_ppp_active` after a test client
   connects.

Finish with a short **client setup card**: server address, the IPsec pre-shared
key (treat as a secret), the username/password, and the per-OS steps (type =
"L2TP over IPsec"). Confirm before applying changes.
