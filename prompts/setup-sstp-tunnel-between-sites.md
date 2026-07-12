---
name: setup-sstp-tunnel-between-sites
title: Build an SSTP (TLS/443) tunnel between two MikroTik devices
description: Configure a MikroTik-to-MikroTik SSTP site-to-site link — server certificate, PPP profile + secret, client, routing, firewall — over TCP 443 so it looks like HTTPS. The go-to transport for bypassing VPN blocks / DPI. Verified end to end.
arguments:
  - name: server_device
    description: The device that will run the SSTP SERVER — the one with a reachable public IP / DDNS and (ideally) a certificate. Config key or label from list_mikrotik_devices.
    required: false
  - name: client_device
    description: The device that will run the SSTP CLIENT (may be behind NAT). Config key or label.
    required: false
  - name: tunnel_subnet
    description: Transit subnet for the PPP link, e.g. 10.255.255.0/30 (server=.1 local, client=.2 remote). Omit to let you pick one that collides with neither LAN.
    required: false
  - name: port
    description: TCP port for SSTP. Default and recommended 443 (looks like HTTPS, survives most DPI). Omit for 443.
    required: false
---

You are building an **SSTP site-to-site tunnel between two MikroTik routers**. SSTP
is **PPP inside TLS over TCP (default 443)** — on the wire it is nearly
indistinguishable from an HTTPS session, which makes it the **best native RouterOS
choice for bypassing VPN blocks and DPI**. It is client↔server (asymmetric): one
device is the **server** (needs a reachable endpoint + a TLS certificate), the other
is the **client** (can be behind NAT). Drive both via the `device` argument. This
touches certificates, PPP, and the firewall — go carefully and confirm before writing.

Server device: {{server_device}}
Client device: {{client_device}}
Transit subnet: {{tunnel_subnet}}
Port: {{port}}

## 0. Discover and assign roles (FIRST)

- `list_mikrotik_devices`; resolve {{server_device}}/{{client_device}} — never
  substitute a similar name; ask which is which if omitted.
- The **server** must be reachable on the chosen TCP `port` (static WAN or DDNS via
  `/ip cloud`). The **client** only needs outbound TCP to that port — NAT-friendly.
  Confirm roles with the user before proceeding.

## 1. Facts (read-only, per device)

Per side (`device=<name>`): `get_system_identity`, `list_ip_addresses`,
`get_routing_table`, `get_ip_cloud`, and on the server `list_certificates`. Record
the server's public address/DDNS, each LAN subnet (must not overlap), and whether a
usable server certificate already exists.

## 2. Server certificate (server side)

SSTP requires a TLS certificate on the server. If none exists:

- `create_certificate` a local CA, then `create_certificate` a server cert (common-
  name = the server's public IP/DDNS the client will connect to), `sign_certificate`
  both (CA self-signed, server signed by the CA). Note the server cert name.
- The client should trust that CA: either `import_certificate` the CA on the client,
  or set the client's `verify_server_certificate=false` (simpler, but skips
  authenticity — acceptable only if the PSK-like PPP credentials are strong; state
  the trade-off). A publicly-trusted (Let's Encrypt) cert avoids this — see
  `manage-certificates`.

## 3. PPP profile + secret (server side)

- `create_ppp_profile` — set `local-address`=server transit IP (e.g. `10.255.255.1`),
  `remote-address`=client transit IP (e.g. `10.255.255.2`) or a small pool. Optionally
  set DNS. This profile defines the tunnel's L3 endpoints.
- `create_ppp_secret` — `name`/`password` (strong), `service=sstp`, `profile`=the
  profile above. These are the client's login credentials.

## 4. Enable the SSTP server (server side)

`set_sstp_server` (`device={{server_device}}`) — `enabled=true`,
`certificate`=<server cert>, `port`={{port}} or 443, `default_profile`=the profile,
`authentication=mschap2` (drop weaker methods), `tls_version=only-1.2`, `pfs=true`,
`force_aes=true`. Strong ciphers + TLS 1.2-only both hardens and makes the flow look
like modern HTTPS.

## 5. Client (client side)

`create_sstp_client` (`device={{client_device}}`) — `name`=`sstp-{{server_device}}`,
`connect_to`/server address = the server's public IP/DDNS, `port`={{port}} or 443,
`user`/`password` = the PPP secret from step 3, `verify_server_certificate` per step 2,
`tls_version=only-1.2`, `pfs=true`, `authentication=mschap2`. The client auto-creates
the PPP interface and gets the transit `remote-address`.

## 6. Route each far LAN

The transit /30 is connected once the PPP link is up. Add routes for the far LANs:

- On the server: `add_route` dst=client-LAN gw=the client's transit IP (or the
  dynamic SSTP interface).
- On the client: `add_route` dst=server-LAN gw=the server's transit IP (or the SSTP
  interface). Or push routes via the PPP profile.

## 7. Firewall — safely

Under Safe Mode per device (`enable_safe_mode`→edits→verify→`commit_safe_mode`):

- Server `input`: accept `protocol=tcp dst-port={{port}}` (443) from anywhere the
  client may source from (dynamic clients ⇒ from any), placed above any default drop.
- Both sides `forward`: allow the two LANs both directions.

## 8. MTU / MSS

SSTP over TCP/TLS adds overhead and is prone to TCP-in-TCP meltdown on lossy links.
Set the client `max_mtu`/`max_mru` conservatively (~1400) and clamp MSS on `forward`.
Prefer this transport for _reachability_, not raw throughput.

## 9. Verify

- Server: `get_sstp_server` enabled; check active PPP (the client should appear as a
  connected session). Client: `get_sstp_client` — status `connected`, transit IP
  assigned.
- `ping` (`device=server`) the client transit IP then a client-LAN host with
  `src_address`=server-LAN IP; repeat from the client. `traceroute` if a path is off.

## Why this is the bypass workhorse (legitimate circumvention)

Lawful privacy/accessibility only; comply with local law and terms. SSTP on TCP 443
**is** the DPI-bypass technique for native RouterOS — it presents as a standard TLS
session to a common HTTPS port, so it passes most "block VPN protocols" filters that
stop WireGuard/IKE/GRE. To maximize blend-in: keep `port=443`, `tls_version=only-1.2`,
strong AES + PFS, and a certificate with a plausible CN. If SSTP itself is
fingerprinted/blocked (active probing, TLS-fingerprint allow-lists), escalate to:
**OpenVPN TCP/443** (`setup-openvpn-tunnel-between-sites`) for a different TLS
signature, or **container-based obfuscation** (XRay/VLESS+Reality, sing-box,
Shadowsocks, obfs4) run in a RouterOS `/container` or a VPS — not native, heaviest,
most robust. You can also run WireGuard _inside_ this SSTP link so the WG handshake
never touches the open internet. Never present obfuscation as a guarantee — it's an
arms race.

---

Report: server cert used, PPP profile/secret, server settings, client status, routes

- firewall added, MTU/MSS, verification results. State which device each change ran
  on. Never apply changes the user hasn't approved.
