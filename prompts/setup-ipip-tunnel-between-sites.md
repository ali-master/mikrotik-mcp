---
name: setup-ipip-tunnel-between-sites
title: Build an IPIP tunnel between two MikroTik devices
description: Configure BOTH routers of an IP-in-IP (IPIP) site-to-site tunnel from one conversation — endpoints, addressing, routing, MTU/MSS, and (recommended) IPsec encryption — then verify end to end. Includes DPI/censorship-bypass notes.
arguments:
  - name: device_a
    description: First configured device (config key or label from list_mikrotik_devices), e.g. site-a.
    required: false
  - name: device_b
    description: Second configured device, e.g. site-b.
    required: false
  - name: tunnel_subnet
    description: Small transit subnet for the tunnel link in CIDR, e.g. 10.255.255.0/30 (A=.1, B=.2). Omit to let you pick one that doesn't collide with either LAN.
    required: false
  - name: encrypt
    description: Secure IPIP with IPsec (shared secret). Recommended — IPIP is cleartext. "yes" (default) or "no".
    required: false
---

You are building an **IPIP (IP-in-IP) site-to-site tunnel between two MikroTik
routers** this server can both reach. IPIP is the **leanest L3 tunnel** — it
encapsulates unicast IPv4 in IPv4 with only 20 bytes of overhead (less than GRE),
but it carries **no multicast and no dynamic-routing protocols** (if you need OSPF
or multicast over the tunnel, use GRE instead — `setup-gre-tunnel-between-sites`).
Like GRE, **IPIP is unencrypted**, so secure it with IPsec unless the transport is
already trusted (this flow does by default). Drive **both** routers in one
conversation via the `device` argument. Confirm the plan before any change.

Device A: {{device_a}}
Device B: {{device_b}}
Transit subnet: {{tunnel_subnet}}
Encrypt with IPsec: {{encrypt}}

## 0. Discover and confirm both endpoints (FIRST)

- `list_mikrotik_devices`; resolve {{device_a}}/{{device_b}} against it — never
  substitute a similar name. Ask which two if omitted.
- Both ends need to reach the other's public IP by **protocol 4 (IPIP)**. If a side
  is behind NAT that doesn't forward protocol 4, prefer IPsec-encrypted IPIP (rides
  ESP/UDP 4500) or WireGuard. Flag it.

## 1. Facts (read-only, per device)

For each side (`device=<name>`): `get_system_identity`, `list_interfaces`,
`list_ip_addresses`, `get_routing_table`, `get_ip_cloud`. Record public/WAN
address, WAN MTU, and LAN subnet(s). Confirm the two LANs do **not overlap**.

## 2. Addressing

Transit `{{tunnel_subnet}}` or a /30 that collides with neither LAN (A=.1, B=.2).
If encrypting, generate a strong shared secret to use as `ipsec_secret` on **both**
sides. Confirm interface names (`ipip-<peer>`), transit IPs, advertised LANs.

## 3. Create the IPIP interfaces (symmetric)

- On **A** (`device={{device_a}}`): `create_ipip_tunnel` — `name`=`ipip-{{device_b}}`,
  `remote_address`=**B's** public IP, `local_address`=A's public IP,
  `keepalive`=`10s,3`, `clamp_tcp_mss`=true, `ipsec_secret`=<secret> (if encrypting),
  `mtu`=1480 (20 B overhead; ~1400 when also IPsec-wrapped).
- On **B**: mirror — `remote_address`=**A's** IP, `local_address`=B's IP, identical
  `ipsec_secret`.

## 4. Address, route

- `add_ip_address` the transit IP on each ipip interface (A `10.255.255.1/30`, B `.2`).
- `add_route` far LAN via the tunnel on each side (A: dst=B-LAN gw=ipip iface; B mirror).

## 5. Firewall — safely, per device

Per side under Safe Mode (`enable_safe_mode`→edits→verify→`commit_safe_mode`; per-device):

- Unencrypted: `input` accept `protocol=ipip` from far WAN (cleartext — remind user).
- IPsec-encrypted: `input` accept `udp dst-port=500,4500` + `protocol=ipsec-esp`
  from far WAN, placed high.
- `forward`: accept both LANs both directions. Do not masquerade the transit subnet.

## 6. MTU / MSS

IPIP = 20 B overhead (+ ~50 with IPsec). Set iface MTU ~1480 (~1400 encrypted),
keep `clamp_tcp_mss=true`, and/or a `forward` mangle `change-mss
new-mss=clamp-to-pmtu tcp-flags=syn`. Lower on PPPoE.

## 7. Verify

- `ping` (`device=A`) the transit IP, then a B-LAN host with `src_address`=A-LAN IP;
  repeat from B.
- `get_ipip_tunnel` each side: running=yes. If encrypted, `get_ipsec_active_peers`
  must show an established SA — no SA + tunnel pings ⇒ traffic is in the CLEAR, stop.
- Large payload: ping size 1400 do-not-fragment ⇒ MTU sanity.

## Bypassing country / DPI restrictions (legitimate circumvention)

Lawful privacy/accessibility only; comply with local law. Raw IPIP (protocol 4) is
easily filtered, so:

1. **Encrypt** so it rides IPsec ESP/UDP 4500 (much more likely to pass, payload
   hidden) — the biggest win.
2. If IKE/ESP is also blocked, **wrap in a TLS transport** (SSTP or OpenVPN TCP/443,
   see `setup-sstp-tunnel-between-sites` / `setup-openvpn-tunnel-between-sites`) and
   route the far LANs over that.
3. Advanced: obfuscation (XRay/Reality, sing-box, Shadowsocks, obfs4) in a
   **`/container`** or VPS — not native to RouterOS. Heaviest option.
   IPIP's value is minimal overhead, not stealth — for evasion prefer a TLS transport
   and keep IPIP only inside the protected path. Never present obfuscation as a guarantee.

---

Report per side: interface name, remote/local, transit IP, IPsec SA proof, routes +
firewall added, MTU/MSS, verification results. State which device each change ran on.
Never apply changes the user hasn't approved.
