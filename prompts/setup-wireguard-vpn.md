---
name: setup-wireguard-vpn
title: Set up a WireGuard VPN + first peer
description: Stand up a WireGuard server interface on the router and generate a ready-to-use client config for one peer.
arguments:
  - name: vpn_subnet
    description: The VPN tunnel subnet in CIDR, e.g. 10.10.0.0/24.
    required: true
  - name: endpoint
    description: The public hostname/IP clients will connect to (your WAN address or DDNS name).
    required: true
  - name: listen_port
    description: UDP port for WireGuard (default 13231).
    required: false
---

Provision a WireGuard VPN on this MikroTik device and produce a working client
config. Confirm the plan with the user before applying changes.

VPN subnet: {{vpn_subnet}}
Public endpoint: {{endpoint}}
Listen port: {{listen_port}}

## Back up before the first write

Before your FIRST configuration change in this workflow — the tunnel/interface, keys/peers, addresses, routes, NAT, or any mangle or firewall filter rule — ASK the user "Create a local backup first?" and, on yes, call `create_local_backup` for each device you are about to change. It saves a host-side `.rsc` restore point you can `restore_local_backup` if the change cuts the link. Discovery and the read-only fact-gathering steps below need no backup — do it once, right before you start writing. Tunnel creation always warrants a backup; you may skip it only for a minor, non-critical mangle/filter tweak the user explicitly waves off.

Steps:

1. **Server interface** — `create_wireguard_interface` (e.g. name `wg-vpn`,
   listen port {{listen_port}} or 13231). Then `get_wireguard_interface` to read
   back its **public key**.
2. **Tunnel address** — `add_ip_address` on `wg-vpn` using the router's address in
   {{vpn_subnet}} (e.g. the .1).
3. **Firewall** — `create_filter_rule` in `input` to accept UDP on the listen port
   from WAN, and in `forward` to allow the VPN subnet to the LAN/internet as the
   user wants. Use Safe Mode for the firewall edits.
4. **First peer** — `add_wireguard_peer` on `wg-vpn` with the client's allowed
   address (a /32 in {{vpn_subnet}}). If the client keypair is generated on the
   client, collect its public key; otherwise note that the private key must be
   created client-side.
5. **Client config** — call `generate_wireguard_client_config` with the server
   public key, {{endpoint}}, the listen port, and the assigned client address, and
   present the resulting `[Interface]/[Peer]` config for the user to import.

Report the server public key, the peer you added, and the full client config.
