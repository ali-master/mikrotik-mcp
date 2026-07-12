---
name: setup-tunnel-between-sites
title: Build a tunnel between two MikroTik devices
description: Configure BOTH routers of a site-to-site tunnel from one conversation, then verify it end to end.
arguments:
  - name: device_a
    description: First configured device (config key or label from list_mikrotik_devices), e.g. site-a. Omit to discover and choose.
    required: false
  - name: device_b
    description: Second configured device, e.g. site-b. Omit to discover and choose.
    required: false
  - name: technology
    description: Tunnel type — wireguard, ipsec, gre, ipip, eoip, vxlan, sstp, ovpn, or "recommend" to let you choose. For a deep, tech-specific walkthrough use setup-wireguard-tunnel-between-sites or setup-gre-tunnel-between-sites.
    required: false
---

You are configuring a **site-to-site tunnel between two MikroTik routers** that
this server can both reach. You will drive BOTH devices in one flow by passing
the `device` argument on each tool call. This is the general chooser-and-builder;
for a detailed, tech-specific flow prefer the dedicated per-technology prompts,
which cover keys/certs, MTU/MSS, and DPI-bypass transports in depth:
**`setup-wireguard-tunnel-between-sites`** (WireGuard),
**`setup-gre-tunnel-between-sites`** (GRE + IPsec),
**`setup-ipip-tunnel-between-sites`** (IP-in-IP),
**`setup-eoip-tunnel-between-sites`** (L2 bridgeable),
**`setup-vxlan-tunnel-between-sites`** (L2 overlay / multipoint),
**`setup-ipsec-site-to-site`** (IKEv2 policy-based),
**`setup-sstp-tunnel-between-sites`** and
**`setup-openvpn-tunnel-between-sites`** (TLS/443 — the bypass workhorses).

Device A: {{device_a}}
Device B: {{device_b}}
Requested technology: {{technology}}

Work in this order, confirming the plan before any change:

0. **Discover both endpoints.** Call `list_mikrotik_devices` first and resolve
   {{device_a}} / {{device_b}} against it — never substitute a similar name (these
   are different physical routers). If either was omitted, ask which two devices to
   connect. Note which side (if any) has a reachable public endpoint vs. is behind
   NAT — if **both** are behind NAT with no forward, a direct tunnel can't form
   (use a reachable side or a relay/VPS).

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
5. **MTU / MSS.** Every tunnel shrinks the usable MTU (WireGuard ~60 B, GRE 24 B,
   GRE+IPsec ~70+ B), so small pings pass but large TLS/file flows stall. Set the
   tunnel interface MTU accordingly (WG 1420, GRE 1476, lower on PPPoE / when also
   IPsec-wrapped) and clamp TCP MSS (`clamp-tcp-mss` on the tunnel, or a `forward`
   mangle `change-mss new-mss=clamp-to-pmtu tcp-flags=syn`). Confirm non-overlapping
   LANs before routing — overlap makes the far route ambiguous.
6. **Verify end to end.** From {{device_a}} run `ping` (`device={{device_a}}`) to
   the far tunnel address and a host in B's LAN (set `src_address` to A's LAN IP);
   repeat from {{device_b}}. For IPsec, check `get_ipsec_active_peers` on both.
   Test a large payload (ping size 1400, do-not-fragment) to catch MTU issues. Use
   `traceroute` if a path is wrong.

## Bypassing country / DPI restrictions (legitimate censorship circumvention)

For lawful privacy / accessibility on networks you're authorized to use — comply
with local law and service terms. Escalate only as far as the block requires:

- **Port camouflage** — run the encrypted tunnel on a rarely-filtered port (UDP/443
  for WireGuard, UDP 4500 for IPsec NAT-T). Cheapest; hides the port, not the
  handshake.
- **TLS-looking transport** — where DPI fingerprints WireGuard/IKE, wrap the routed
  tunnel in **SSTP** (PPP-over-TLS, TCP 443 — looks like HTTPS) or **OpenVPN TCP/443**
  (`create_sstp_client` / `create_ovpn_client`) and route the far LANs over that, or
  run WG/GRE inside it. Trades throughput for reachability.
- **Alternate fingerprint** — if one protocol is specifically blocked, switch: WG↔
  IKEv2↔SSTP present different signatures on the wire.
- **Container-based obfuscation (advanced)** — the strongest anti-DPI tools
  (XRay/VLESS+Reality, sing-box, Shadowsocks, obfs4) are **not native** to RouterOS;
  run one in a **`/container`** or on a VPS you control and route the site tunnel
  through it. Confirm container support and spare resources first.

Recommend the lightest option that works; never present obfuscation as a guarantee.
The dedicated `setup-wireguard-tunnel-between-sites` and
`setup-gre-tunnel-between-sites` prompts cover these transports in more depth.

Report the tunnel parameters used on each side, the verification results, and any
follow-ups (e.g. routes still needed). Never apply changes the user hasn't approved.
