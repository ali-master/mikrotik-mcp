---
name: setup-eoip-tunnel-between-sites
title: Build an EoIP (Layer-2) tunnel between two MikroTik devices
description: Configure BOTH routers of an EoIP site-to-site tunnel — a bridgeable Ethernet-over-IP link that puts two sites on the SAME L2 broadcast domain — with matching tunnel-id, bridging, MTU/MSS, and (recommended) IPsec encryption, then verify. Includes DPI/censorship-bypass notes.
arguments:
  - name: device_a
    description: First configured device (config key or label from list_mikrotik_devices), e.g. site-a.
    required: false
  - name: device_b
    description: Second configured device, e.g. site-b.
    required: false
  - name: tunnel_id
    description: EoIP tunnel ID (0–65535). MUST be identical on both peers and unique per EoIP tunnel. Omit to let you pick one.
    required: false
  - name: encrypt
    description: Secure EoIP with IPsec (shared secret). Recommended — EoIP is cleartext. "yes" (default) or "no".
    required: false
---

You are building an **EoIP (Ethernet-over-IP) tunnel between two MikroTik routers**
this server can both reach. EoIP is unique among these tunnels: it is **Layer 2** —
it transports Ethernet frames, so bridging the EoIP interface at both sites places
them on **one broadcast domain** (same subnet spans both sites; ARP, DHCP, and
broadcast cross the tunnel). That is powerful and dangerous: a broadcast storm or a
loop now spans both sites. Use it only when you genuinely need shared L2; for routed
L3 connectivity prefer GRE/IPIP/WireGuard. **EoIP is unencrypted** — secure with
IPsec (default here). Drive **both** routers via the `device` argument. Confirm
before any change.

Device A: {{device_a}}
Device B: {{device_b}}
Tunnel ID: {{tunnel_id}}
Encrypt with IPsec: {{encrypt}}

## Back up before the first write

Before your FIRST configuration change in this workflow — the tunnel/interface, keys/peers, addresses, routes, NAT, or any mangle or firewall filter rule — ASK the user "Create a local backup first?" and, on yes, call `create_local_backup` for each device you are about to change. It saves a host-side `.rsc` restore point you can `restore_local_backup` if the change cuts the link. Discovery and the read-only fact-gathering steps below need no backup — do it once, right before you start writing. Tunnel creation always warrants a backup; you may skip it only for a minor, non-critical mangle/filter tweak the user explicitly waves off.

## 0. Discover and confirm (FIRST)

- `list_mikrotik_devices`; resolve {{device_a}}/{{device_b}} — never substitute a
  similar name; ask which two if omitted.
- Both ends need to reach the other's public IP (EoIP uses protocol 47, like GRE).
  Behind NAT ⇒ prefer IPsec-encrypted EoIP (ESP/4500) and flag it.
- **L2 safety check:** confirm the user really wants a single stretched subnet. If a
  DHCP server runs at both sites, decide which one serves the stretched VLAN (two
  servers on one L2 = conflict). Warn about loop/STP risk before bridging.

## 1. Facts (read-only, per device)

Per side (`device=<name>`): `get_system_identity`, `list_interfaces`,
`list_bridges` (or `list_interfaces`), `list_ip_addresses`, `get_routing_table`,
`get_ip_cloud`. Record public/WAN address, WAN MTU, the LAN bridge each site uses,
and the subnet to stretch.

## 2. Plan

Pick `tunnel_id` = `{{tunnel_id}}` (identical both sides, unique per EoIP). Decide
the target bridge on each side. Confirm interface names (`eoip-<peer>`), tunnel-id,
and the stretched subnet/VLAN with the user. If encrypting, generate a strong shared
secret for `ipsec_secret` on both sides.

## 3. Create the EoIP interfaces (symmetric)

- On **A** (`device={{device_a}}`): `create_eoip_tunnel` — `name`=`eoip-{{device_b}}`,
  `remote_address`=**B's** public IP, `local_address`=A's public IP,
  `tunnel_id`={{tunnel_id}} (MUST match), `keepalive`=`10s,3`, `clamp_tcp_mss`=true,
  `ipsec_secret`=<secret> if encrypting, `mtu` per step 6.
- On **B**: mirror — `remote_address`=A's IP, `local_address`=B's IP, **same
  `tunnel_id`**, identical `ipsec_secret`. (A mismatched tunnel_id silently fails.)

## 4. Bridge the tunnel (the L2 step)

On each side add the EoIP interface as a **bridge port** on the LAN bridge that owns
the stretched subnet (bridge/port tools). Now the two LANs are one L2 domain.

- **Strongly recommend enabling STP/RSTP** on both bridges so an accidental parallel
  path can't create a bridging loop across the WAN.
- Do NOT put an IP on the EoIP interface itself — it's a bridge member, not a routed
  link (that's the difference from GRE/IPIP).

## 5. Firewall — safely, per device

Per side under Safe Mode (`enable_safe_mode`→edits→verify→`commit_safe_mode`; per-device):

- Unencrypted: `input` accept `protocol=gre` from far WAN (EoIP rides GRE; cleartext).
- IPsec-encrypted: `input` accept `udp dst-port=500,4500` + `protocol=ipsec-esp`.
- Bridged L2 traffic is `forward`-chain; if `use-ip-firewall` is on, allow it.

## 6. MTU / MSS (critical for L2)

EoIP has GRE-like overhead AND carries full Ethernet frames, so MTU mismatch bites
hard. Set the EoIP `mtu`/`l2mtu` high enough (the WAN path must carry the encapsulated
frame — often needs the WAN to support ~1500+; otherwise lower the guests' effective
MTU), keep `clamp_tcp_mss=true`, and clamp MSS on `forward`. Test large frames
explicitly.

## 7. Verify

- `get_eoip_tunnel` each side: running=yes; tunnel-ids match. If encrypted,
  `get_ipsec_active_peers` shows an established SA (no SA + it works ⇒ CLEAR, stop).
- L2 proof: a host at site A should ARP-resolve and `ping` a host at site B **in the
  same subnet** with no router hop; DHCP from the designated server should reach both.
- Large-frame test to confirm MTU.

## Bypassing country / DPI restrictions (legitimate circumvention)

Lawful privacy/accessibility only. EoIP (protocol 47) is easily filtered:

1. **Encrypt** so it rides IPsec ESP/UDP 4500.
2. If blocked, **carry the bridge over a TLS transport** — OpenVPN in **ethernet
   (TAP) mode** on TCP/443 is L2-capable and looks like HTTPS (see
   `setup-openvpn-tunnel-between-sites`, `mode=ethernet`); bridge that instead of
   EoIP. SSTP is L3/PPP (not L2), so it can't replace EoIP for bridging.
3. Advanced: obfuscation via `/container` (XRay/Reality, sing-box) — not native.
   For evasion, prefer OpenVPN-TAP/443 over raw EoIP. Never present obfuscation as a
   guarantee.

---

Report per side: EoIP interface, remote/local, tunnel-id, which bridge it joined,
IPsec SA proof, STP status, MTU/MSS, verification results. State which device each
change ran on. Never apply changes the user hasn't approved.
