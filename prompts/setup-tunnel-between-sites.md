---
name: setup-tunnel-between-sites
title: Build a tunnel between two MikroTik devices
description: Configure BOTH routers of a site-to-site tunnel from one conversation, then verify it end to end.
arguments:
  - name: device_a
    description: Name of the first configured device (see list_mikrotik_devices), e.g. site-a.
    required: true
  - name: device_b
    description: Name of the second configured device, e.g. site-b.
    required: true
  - name: technology
    description: Tunnel type to use — wireguard, ipsec, gre, eoip, or "recommend" to let you choose.
    required: false
---
You are configuring a **site-to-site tunnel between two MikroTik routers** that
this server can both reach. You will drive BOTH devices in one flow by passing
the `device` argument on each tool call.

Device A: {{device_a}}
Device B: {{device_b}}
Requested technology: {{technology}}

Work in this order, confirming the plan before any change:

1. **Inventory both ends.** Call `list_mikrotik_devices` first. Then, for each of
   {{device_a}} and {{device_b}}, gather facts with `device=<name>`:
   `get_system_identity`, `list_interfaces`, `list_ip_addresses`,
   `get_routing_table`. Note each side's WAN/public address and LAN subnet.
2. **Choose the technology.** If `{{technology}}` is "recommend" or empty, pick
   based on the facts (WireGuard for MikroTik↔MikroTik simplicity; IPsec IKEv2
   for policy-based/interop; GRE/EoIP when you need routed/L2 transport — wrap it
   in IPsec if it must be encrypted). State the choice and why.
3. **Configure side A** (`device={{device_a}}`) then **side B**
   (`device={{device_b}}`), keeping the two ends' parameters consistent:
   - WireGuard: `create_wireguard_interface` on each, exchange the **public keys**
     (read with `get_wireguard_interface`), `add_wireguard_peer` on each pointing
     at the other's endpoint + public key + allowed subnet, and `add_ip_address`
     on each tunnel interface.
   - IPsec: matching `create_ipsec_profile` + `create_ipsec_proposal` on both,
     then `create_ipsec_peer` (`exchange_mode=ike2`) → `create_ipsec_identity`
     (same PSK) → `create_ipsec_policy` (A: src=A-LAN dst=B-LAN; B: mirrored).
   - GRE/EoIP: `create_gre_tunnel`/`create_eoip_tunnel` on each with
     remote-address = the other side's public IP, then address + a route.
4. **Firewall, safely.** On each side, open the tunnel's port/protocol on the
   `input` chain and allow the far LAN in `forward`. Use `enable_safe_mode`
   (`device=<name>`) per device before firewall edits, verify, then
   `commit_safe_mode` — Safe Mode is tracked per device, so each router commits
   independently.
5. **Verify end to end.** From {{device_a}} run `ping` (`device={{device_a}}`) to
   the far tunnel address and a host in B's LAN (set `src_address` to A's LAN IP);
   repeat from {{device_b}}. For IPsec, check `get_ipsec_active_peers` on both.
   Use `traceroute` if a path is wrong.

Report the tunnel parameters used on each side, the verification results, and any
follow-ups (e.g. routes still needed). Never apply changes the user hasn't approved.
