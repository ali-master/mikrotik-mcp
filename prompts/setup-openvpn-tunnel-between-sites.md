---
name: setup-openvpn-tunnel-between-sites
title: Build an OpenVPN (TLS) tunnel between two MikroTik devices
description: Configure a MikroTik-to-MikroTik OpenVPN site-to-site link — certificates, PPP profile + secret, server + client, L3 (ip) or L2 (ethernet) mode, routing, firewall — over TCP/UDP 443 for HTTPS-like camouflage. Verified end to end, with DPI/censorship-bypass guidance.
arguments:
  - name: server_device
    description: The device that will run the OpenVPN SERVER — reachable public IP/DDNS + a certificate. Config key or label from list_mikrotik_devices.
    required: false
  - name: client_device
    description: The device that will run the OpenVPN CLIENT (may be behind NAT). Config key or label.
    required: false
  - name: mode
    description: Tunnel mode — "ip" (L3 routed, default) or "ethernet" (L2 TAP, bridgeable across sites). Omit for ip.
    required: false
  - name: protocol
    description: Transport — "tcp" (works with 443 camouflage, survives more DPI) or "udp" (faster). Omit for tcp when bypassing blocks, udp otherwise.
    required: false
  - name: port
    description: Port for OpenVPN. 1194 is default; use 443 to look like HTTPS through restrictive networks. Omit for 1194.
    required: false
---

You are building an **OpenVPN site-to-site tunnel between two MikroTik routers**.
OpenVPN is a mature TLS VPN: it can be **L3 routed (`mode=ip`)** or **L2 bridgeable
(`mode=ethernet`/TAP)**, over **TCP or UDP**, and on **any port** — running it on
**TCP 443** makes it look like HTTPS, a strong DPI-bypass option (a different TLS
fingerprint than SSTP). It is client↔server: one device is the **server** (reachable
endpoint + certificate), the other the **client** (NAT-friendly). Drive both via the
`device` argument. Confirm before writing — this touches certificates, PPP, and the
firewall.

Server device: {{server_device}}
Client device: {{client_device}}
Mode: {{mode}}
Protocol: {{protocol}}
Port: {{port}}

## Back up before the first write

Before your FIRST configuration change in this workflow — the tunnel/interface, keys/peers, addresses, routes, NAT, or any mangle or firewall filter rule — ASK the user "Create a local backup first?" and, on yes, call `create_local_backup` for each device you are about to change. It saves a host-side `.rsc` restore point you can `restore_local_backup` if the change cuts the link. Discovery and the read-only fact-gathering steps below need no backup — do it once, right before you start writing. Tunnel creation always warrants a backup; you may skip it only for a minor, non-critical mangle/filter tweak the user explicitly waves off.

## 0. Discover and assign roles (FIRST)

- `list_mikrotik_devices`; resolve {{server_device}}/{{client_device}} — never
  substitute a similar name; ask which is which if omitted.
- The **server** must be reachable on the chosen `port`/`protocol` (static WAN or
  DDNS). The **client** only needs outbound reach. Confirm roles.
- Choose `mode`: **ip** for routed site-to-site (recommended default — cleaner,
  faster); **ethernet** only if the user needs a stretched L2 domain (then bridge the
  interface at both ends, with the same STP / single-DHCP warnings as EoIP/VXLAN).

## 1. Facts (read-only, per device)

Per side: `get_system_identity`, `list_ip_addresses`, `get_routing_table`,
`get_ip_cloud`, and on the server `list_certificates`. Record server public
address/DDNS, LAN subnets (must not overlap for `mode=ip`), and existing certs.

## 2. Certificates

OpenVPN needs a server certificate; with `require_client_certificate=true` it also
needs a client cert (recommended — stronger than username/password alone):

- If absent: `create_certificate` a CA → `sign_certificate` (self-signed); then a
  **server** cert (CN=server address) and a **client** cert, each `sign_certificate`
  by the CA.
- `import_certificate` the CA (and client cert) onto the client. RouterOS OpenVPN
  historically wants explicit certs on both ends — plan for it rather than relying on
  username/password only.

## 3. PPP profile + secret (server side)

- `create_ppp_profile` — `local-address`=server tunnel IP, `remote-address`=client
  tunnel IP or pool; optional DNS/routes.
- `create_ppp_secret` — strong `name`/`password`, `service=ovpn`, `profile`=above.

## 4. Enable the OpenVPN server (server side)

`add_ovpn_server` (`device={{server_device}}`) — `name`=`ovpn-srv`, `port`={{port}}
or (443 for camouflage / 1194 default), `protocol`={{protocol}} or tcp,
`mode`={{mode}} or ip, `certificate`=<server cert>, `require_client_certificate=true`,
`auth=sha256`, `cipher=aes256-gcm,aes256-cbc`, `tls_version=only-1.2`,
`default_profile`=the profile, `enabled` (or `enable_ovpn_server`). Strong cipher +
TLS 1.2 both hardens and looks like modern HTTPS.

## 5. Client (client side)

`create_ovpn_client` (`device={{client_device}}`) — `name`=`ovpn-{{server_device}}`,
`connect_to`=server public IP/DDNS, `port`={{port}} or match, `protocol`=match,
`mode`=match, `user`/`password`=the PPP secret, `certificate`=<client cert>,
`verify_server_certificate=true`, `cipher`/`auth`/`tls_version` matching the server.
Use `route_nopull=true` if you want to control routing manually (recommended for
site-to-site), else the server can push routes.

## 6. Route (mode=ip) or bridge (mode=ethernet)

- **mode=ip:** transit link is up once connected; `add_route` far LAN on each side
  (server→client-LAN, client→server-LAN) via the tunnel interface / transit IP. Or
  push routes from the server profile.
- **mode=ethernet:** add the OVPN interface as a **bridge port** on each side's LAN
  bridge (one L2 domain) — enable STP, single DHCP authority, watch MTU.

## 7. Firewall — safely

Under Safe Mode per device: server `input` accept `protocol={{protocol}} (tcp)
dst-port={{port}}` (443/1194) from the client's source (any if dynamic), high in the
chain; both sides `forward` allow the two LANs.

## 8. MTU / MSS

OpenVPN adds notable overhead; TCP mode risks TCP-in-TCP stalls. Set the client
`max_mtu` conservatively (~1400), clamp MSS on `forward`. UDP mode is faster where
it isn't blocked; TCP/443 is for reachability.

## 9. Verify

- Server: `list_ovpn_servers`/`get_ovpn_server` running; the client appears as a
  connected session. Client: `get_ovpn_client` status `connected`, address assigned.
- `ping` (`device=server`) client tunnel/LAN (with `src_address`=server-LAN), repeat
  from client. For `mode=ethernet`, prove same-subnet L2 reachability + DHCP. Large-
  payload ping to confirm MTU.

## Bypassing country / DPI restrictions (legitimate circumvention)

Lawful privacy/accessibility only; comply with local law and terms. OpenVPN on
**TCP 443** presents a TLS session on the HTTPS port — a strong native bypass with a
**different fingerprint from SSTP**, so it's the natural second option if SSTP is
blocked. Maximize blend-in: `protocol=tcp`, `port=443`, `tls_version=only-1.2`, AES-
GCM, valid-looking cert. Note: classic OpenVPN has a recognizable TLS handshake that
sophisticated DPI (active probing / TLS-fingerprint allow-lists) can still flag —
if that's the adversary, escalate to **container-based obfuscation** (XRay/VLESS+
Reality, sing-box, Shadowsocks, obfs4) in a RouterOS `/container` or a VPS (not
native, heaviest, most robust), or run WireGuard _inside_ this OpenVPN link. Compare
with `setup-sstp-tunnel-between-sites` and pick the transport the local DPI doesn't
recognize. Never present obfuscation as a guarantee — it's an arms race.

---

Report: certs used, PPP profile/secret, server + client settings (mode/protocol/port),
routing or bridging, firewall added, MTU/MSS, verification results. State which device
each change ran on. Never apply changes the user hasn't approved.
