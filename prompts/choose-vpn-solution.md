---
name: choose-vpn-solution
title: Choose the right MikroTik VPN
description: Recommend the best MikroTik VPN/tunnel technology for a given requirement, then outline the build.
arguments:
  - name: use_case
    description: What you need — e.g. "connect two offices", "remote access for laptops & phones", "site-to-site over the internet with another vendor's firewall", "L2 bridge between sites".
    required: true
  - name: clients
    description: What connects — e.g. "iOS/Android/Windows built-in clients", "other MikroTik routers", "a Cisco/Fortinet device", "our laptops only". Optional.
    required: false
---

Act as a MikroTik VPN architect. Recommend the single best tunneling technology
for the requirement below, justify it against the alternatives, then sketch the
build using this server's tools. Be decisive.

Use case: {{use_case}}
Clients / peers: {{clients}}

Decision guidance — weigh these MikroTik options:

- **WireGuard** — fastest, simplest, modern. Best for MikroTik↔MikroTik and
  laptops/phones with the WireGuard app. No built-in OS client on older systems.
  Tools: `create_wireguard_interface`, `add_wireguard_peer`, `generate_wireguard_client_config`.
  For **3+ sites** (full-mesh or hub-spoke): `build_wireguard_mesh`.
  For **user onboarding** (generate config, add peer, revoke later):
  `onboard_wireguard_user`, `revoke_wireguard_user`.
- **IPsec (IKEv2)** — the interoperability choice for site-to-site with
  _other vendors_ (Cisco/Fortinet/pfSense) and for native iOS/Windows IKEv2
  road-warrior. Most config surface. Tools: `create_ipsec_*` (profile/peer/
  identity/proposal/policy), `get_ipsec_active_peers`.
- **L2TP/IPsec** — best when clients must use the **built-in** VPN client on
  Windows/macOS/iOS/Android with no app install. Tools: `set_l2tp_server`
  (`use_ipsec=required`), `create_ppp_secret`, `create_ppp_profile`.
- **SSTP** — when you must traverse restrictive firewalls/proxies (TLS over 443).
  Needs a certificate. Tools: `set_sstp_server`, `create_ppp_secret`.
- **OpenVPN** — cross-platform with the OpenVPN client; RouterOS 7 adds UDP.
  Tools: `set_ovpn_server`, `create_ovpn_client`.
- **PPTP** — legacy/weak; only if a legacy device demands it. Recommend against.
- **GRE / IPIP / EoIP / VXLAN** — _unencrypted_ transport tunnels for routing or
  L2 bridging between sites (often run **over** an IPsec policy for encryption).
  EoIP/VXLAN bridge layer-2; GRE/IPIP carry layer-3. Tools: `create_gre_tunnel`,
  `create_eoip_tunnel`, `create_vxlan_tunnel`.

Deliver: (1) the recommendation in one sentence, (2) a short "why not the others"
table, (3) an ordered build plan referencing the exact tools and the firewall
rules required (use Safe Mode for firewall edits), and (4) what the client side
needs. Confirm the plan before making changes.
