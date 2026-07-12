---
name: setup-gre-tunnel-between-sites
title: Build a GRE tunnel between two MikroTik devices
description: Configure BOTH routers of a GRE site-to-site tunnel from one conversation — endpoints, addressing, routing, MTU/MSS, and (strongly recommended) IPsec encryption — then verify end to end. Includes DPI/censorship-bypass transport options.
arguments:
  - name: device_a
    description: First configured device (config key or label from list_mikrotik_devices), e.g. site-a.
    required: false
  - name: device_b
    description: Second configured device, e.g. site-b.
    required: false
  - name: tunnel_subnet
    description: Small transit subnet for the GRE link itself in CIDR, e.g. 10.255.255.0/30 (A=.1, B=.2). Omit to let you pick one that doesn't collide with either LAN.
    required: false
  - name: encrypt
    description: Whether to secure GRE with IPsec (a shared secret). Strongly recommended — GRE alone is cleartext. "yes" (default) or "no".
    required: false
---

You are building a **GRE (Generic Routing Encapsulation) site-to-site tunnel
between two MikroTik routers** this server can both reach. GRE is a lightweight L3
tunnel: it routes IP (and multicast / dynamic-routing protocols like OSPF, which
plain IPsec can't carry) between two public endpoints. **GRE by itself is
UNENCRYPTED** — anyone on the path sees the inner packets — so unless the transport
is already trusted, secure it with IPsec (this flow does so by default). You will
drive **both** routers in one conversation via the `device` argument. Confirm the
plan before any change; never write without approval.

Device A: {{device_a}}
Device B: {{device_b}}
Transit subnet: {{tunnel_subnet}}
Encrypt with IPsec: {{encrypt}}

## 0. Discover and confirm both endpoints (do this FIRST)

- Call `list_mikrotik_devices` to enumerate the configured routers (key, label,
  transport target, default).
- Resolve `{{device_a}}` / `{{device_b}}` against that inventory. If either is
  missing or ambiguous, STOP and show the list — never substitute a similar name.
  If either was omitted, ask the user which two devices to connect.
- GRE needs each side to reach the **other's public IP** by protocol 47. Both ends
  must have a routable public address (or a DDNS name + a path that permits GRE).
  If a side is behind NAT, GRE only works if the NAT device forwards protocol 47
  (many don't) — in that case prefer IPsec-encrypted GRE on UDP 4500, or switch to
  WireGuard (`setup-wireguard-tunnel-between-sites`). Flag this early.

## 1. Gather the facts (read-only, per device)

For each of {{device_a}} and {{device_b}} with `device=<name>`:
`get_system_identity`, `list_interfaces`, `list_ip_addresses`, `get_routing_table`,
`get_ip_cloud`. Record each side's public/WAN address (or DDNS), WAN MTU, and the
**LAN subnet(s)** to route. Confirm the two LANs do **not overlap** (overlap breaks
routing — NAT or renumber one side and flag it).

## 2. Pick non-colliding addressing

- Transit subnet `{{tunnel_subnet}}` or a /30 that collides with neither LAN
  (e.g. `10.255.255.0/30`); A=`.1`, B=`.2`.
- Decide encryption: if `{{encrypt}}` is empty or "yes", generate a strong shared
  secret (long, random) to pass as `ipsec_secret` on **both** sides — RouterOS then
  auto-creates the IPsec policy that encrypts the GRE. Confirm interface names
  (`gre-<peer>`), transit IPs, and each side's advertised LAN back to the user.

## 3. Create the GRE interfaces (symmetric endpoints)

On **A** (`device={{device_a}}`): `create_gre_tunnel`

- `name` = e.g. `gre-{{device_b}}`
- `remote_address` = **B's** public IP/DDNS
- `local_address` = A's own public IP (pin it if A has multiple WANs)
- `keepalive` = `10s,3` (so the interface goes down fast if the far side dies)
- `clamp_tcp_mss` = true (avoids PMTU black-holing — see step 6)
- `ipsec_secret` = the shared secret (only when encrypting)
- `mtu` = 1476 (GRE overhead is 24 bytes; lower further when also IPsec-wrapped —
  see step 6)

On **B** (`device={{device_b}}`): mirror — `remote_address` = **A's** public IP,
`local_address` = B's public IP, same `keepalive`, `clamp_tcp_mss`, and the
**identical** `ipsec_secret`.

## 4. Address the tunnel

`add_ip_address` the transit IP on each GRE interface (A: `10.255.255.1/30` on
`gre-...`; B: `10.255.255.2/30`). This gives the tunnel a connected route.

## 5. Route each far LAN over the tunnel

- On A: `add_route` (`device={{device_a}}`) `dst-address=<B's LAN>`
  `gateway=<A's gre interface>` (or `gateway=10.255.255.2`).
- On B: mirror with A's LAN.
- For dynamic routing instead of static routes, GRE can carry OSPF — add the GRE
  interface to an OSPF area on both sides (see `setup-ospf-peering`); this is a key
  reason to choose GRE over IPsec-only.

## 6. Firewall — safely, per device

Per side under Safe Mode (`enable_safe_mode` `device=<name>` → edits → verify →
`commit_safe_mode`; per-device, independent commit):

- If **unencrypted GRE**: `input` chain accept `protocol=gre` from the far side's
  WAN. (Reminder to the user: this is cleartext.)
- If **IPsec-encrypted GRE**: `input` chain accept `protocol=udp dst-port=500,4500`
  (IKE + NAT-T) and `protocol=ipsec-esp` from the far WAN; the decrypted GRE is then
  handled internally. Ensure any `action=fasttrack`/`accept` for established traffic
  doesn't bypass the IPsec policy (put the IPsec accepts high).
- `forward` chain: accept traffic between the two LANs both directions.
- Do not masquerade the tunnel/transit subnet (breaks return routing).

## 7. MTU / MSS (the silent-failure trap)

Encapsulation shrinks the usable MTU; small pings pass but large TLS/file flows
stall. GRE = 24 bytes overhead; GRE + IPsec (ESP) = ~70+ bytes. So:

- Set the GRE interface MTU ~1476 (plain) or ~1400 (GRE-over-IPsec); lower on PPPoE.
- Keep `clamp_tcp_mss=true` on the tunnel (set in step 3) and/or add a `forward`
  mangle `change-mss new-mss=clamp-to-pmtu tcp-flags=syn` rule so TCP fits.

## 8. Verify end to end

- From A (`ping` `device={{device_a}}`): the transit IP (`10.255.255.2`), then a
  host in B's LAN with `src_address` = A's LAN IP. Repeat from B.
- `get_gre_tunnel` on each side: interface **running=yes** (keepalive up).
- If encrypted: `get_ipsec_active_peers` on both — an established SA proves the GRE
  is actually protected. If there's no SA but GRE still pings, the traffic is
  flowing in the CLEAR — stop and fix the IPsec policy.
- Large-payload test: ping size 1400 `do-not-fragment`; failure ⇒ revisit MTU/MSS.

## Bypassing country / DPI restrictions (legitimate censorship circumvention)

For lawful privacy / accessibility on networks you're authorized to use — comply
with local law and service terms. GRE is easy for a network to block (protocol 47
is uncommon and frequently filtered), so bypassing usually means **not sending raw
GRE across the hostile path**:

1. **Always encrypt and ride ESP/NAT-T.** Use `ipsec_secret` so the tunnel travels
   as IPsec ESP over **UDP 4500** (NAT-T) rather than bare protocol 47 — 4500 is far
   more likely to pass and the payload is hidden. This is the single biggest win.
2. **IKEv2 over a common UDP port.** IPsec IKEv2 (`setup-ipsec-site-to-site`) on
   500/4500 is widely permitted; move to it if 47 and 4500 alike are throttled.
3. **Wrap the routed tunnel in a TLS-looking transport.** Where DPI blocks IKE/ESP
   too, bring up an **SSTP** tunnel (PPP-over-TLS, **TCP 443** — looks like HTTPS)
   or **OpenVPN TCP/443** between the sites and route the far LANs over that instead
   of GRE, or run GRE _inside_ it. Trades throughput for reachability.
4. **Port/endpoint agility.** Use DDNS (`/ip cloud`) so a dynamic endpoint stays
   reachable, and prefer common ports (443) for whatever encrypted transport carries
   the tunnel.
5. **Advanced obfuscation via a RouterOS container.** The strongest anti-DPI tools
   (XRay/VLESS+Reality, sing-box, Shadowsocks, obfs4) are **not native** to
   RouterOS. Run one in a **`/container`** (or a VPS you control) and route the site
   link through it. Heaviest option; confirm container support and spare resources
   first.

GRE's strength is carrying multicast/dynamic routing, not stealth — if the user's
primary goal is _evading blocks_, recommend WireGuard or an SSTP/OpenVPN-TLS
transport (options above) and use GRE only inside that protected path. Never present
obfuscation as a guarantee — it is an arms race.

---

Report, per side: GRE interface name, remote/local addresses, transit IP, whether
IPsec is active (and proof of the SA), routes and firewall rules added, MTU/MSS
settings, and the verification results. State plainly which device each change ran
on. Never apply changes the user hasn't approved.
