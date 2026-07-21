---
name: setup-vxlan-tunnel-between-sites
title: Build a VXLAN overlay between two (or more) MikroTik devices
description: Configure a VXLAN L2 overlay across MikroTik routers — VNI, VTEP peering, bridging, MTU — for multi-site / multi-tenant L2. Honest about RouterOS VTEP tooling limits; recommends EoIP for a simple two-site link.
arguments:
  - name: device_a
    description: First configured device (config key or label from list_mikrotik_devices), e.g. site-a.
    required: false
  - name: device_b
    description: Second configured device, e.g. site-b.
    required: false
  - name: vni
    description: VXLAN Network Identifier (VNI, 1–16777215). MUST match on every VTEP in this overlay. Omit to let you pick one.
    required: false
  - name: port
    description: VXLAN UDP port. Default 8472 (Linux/MikroTik); 4789 is the IANA standard. Pick one that suits the path.
    required: false
---

You are building a **VXLAN Layer-2 overlay across MikroTik routers** this server can
reach. VXLAN encapsulates Ethernet in **UDP** and identifies each virtual segment by
a 24-bit **VNI**, so it scales to millions of segments and — unlike EoIP — is
naturally **multipoint** (three+ sites on one overlay) and firewall-friendly (it's
just UDP). Two honest caveats up front, state them to the user:

1. **For a simple TWO-site L2 link, EoIP is usually the better fit** (fewer moving
   parts, built-in keepalive + IPsec option). Use VXLAN when you need **multipoint**
   or many segments. If the user only wants two sites bridged, recommend
   `setup-eoip-tunnel-between-sites` unless they specifically want VXLAN.
2. **RouterOS unicast VXLAN needs per-peer VTEP entries** (`/interface vxlan vteps`).
   This MCP's `create_vxlan_tunnel` builds the VXLAN interface and its options but
   does **not** expose a dedicated add-VTEP tool. So for static-unicast peering you
   will add the remote VTEPs with the raw command tool (`run_routeros_command` /
   the raw-command escape hatch) — call this out and get approval, or use a
   **multicast** group for flood/learn if the WAN path carries multicast (rare across
   the internet).

Drive each device via the `device` argument. Confirm the plan before any change.

Device A: {{device_a}}
Device B: {{device_b}}
VNI: {{vni}}
UDP port: {{port}}

## Back up before the first write

Before your FIRST configuration change in this workflow — the tunnel/interface, keys/peers, addresses, routes, NAT, or any mangle or firewall filter rule — ASK the user "Create a local backup first?" and, on yes, call `create_local_backup` for each device you are about to change. It saves a host-side `.rsc` restore point you can `restore_local_backup` if the change cuts the link. Discovery and the read-only fact-gathering steps below need no backup — do it once, right before you start writing. Tunnel creation always warrants a backup; you may skip it only for a minor, non-critical mangle/filter tweak the user explicitly waves off.

## 0. Discover and confirm (FIRST)

- `list_mikrotik_devices`; resolve the endpoints — never substitute a similar name;
  ask which devices if omitted. VXLAN can span more than two, so ask for the full
  VTEP list if it's a multipoint overlay.
- Because VXLAN is UDP, each VTEP just needs to reach the others' public IP on the
  chosen `port` — NAT-friendly (unlike GRE/EoIP protocol 47). Note each site's
  reachable source IP (the local VTEP address).
- **L2 safety:** as with EoIP, VXLAN stretches a broadcast domain — decide the single
  DHCP authority, enable STP, and warn about loops before bridging.

## 1. Facts (read-only, per device)

Per side (`device=<name>`): `get_system_identity`, `list_interfaces`,
`list_ip_addresses`, `get_routing_table`, `get_ip_cloud`. Record each VTEP's source
IP/interface, WAN MTU, target bridge, and the segment to carry.

## 2. Plan

Pick `vni`={{vni}} (identical on every VTEP), `port`={{port}} or 8472, and the local
source address/interface for each VTEP. Confirm interface names (`vxlan<vni>`) and
the peer VTEP IP list with the user.

## 3. Create the VXLAN interface (each device)

On each device: `create_vxlan_tunnel` — `name`=`vxlan{{vni}}`, `vni`={{vni}},
`port`={{port}}, `local_address`=this site's VTEP source IP (or `interface`=source
interface), `mtu` per step 6. (`vteps_ip_version` if you're doing IPv6 VTEPs.)

## 4. Peer the VTEPs (the multipoint step)

For **static unicast** (internet-friendly): on each device add every OTHER site's
VTEP as a remote VTEP under this VXLAN interface. Since there's no dedicated tool,
use the raw-command tool with the user's approval, e.g.
`/interface vxlan vteps add interface=vxlan{{vni}} remote-ip=<peer VTEP IP>` — repeat
for each peer, on each device (full mesh). For **multicast** flood/learn instead,
set the multicast group on the interface (only viable if the path carries multicast).

## 5. Bridge the overlay (L2 step)

Add the VXLAN interface as a **bridge port** on the LAN bridge that owns the segment,
on every site. Enable **STP/RSTP**. Do not put an IP on the VXLAN interface (it's a
bridge member). One DHCP authority for the stretched segment.

## 6. MTU / MSS (VXLAN eats 50 bytes)

VXLAN adds a **50-byte** header (UDP+VXLAN+inner-Ethernet). If the WAN MTU is 1500,
either raise the underlay MTU/L2MTU to ~1550 (if the path supports jumbo) or lower
the guests' effective MTU / clamp MSS so encapsulated frames don't fragment. This is
the #1 VXLAN gotcha — verify with a large-frame test.

## 7. Firewall — safely, per device

Per side under Safe Mode: `input` accept `protocol=udp dst-port={{port}}` (or 8472)
from each peer VTEP IP. Bridged traffic is `forward` (allow if `use-ip-firewall`).
VXLAN has **no built-in encryption** — if the underlay is untrusted, run VXLAN over
an IPsec transport policy (protect UDP/{{port}} between the VTEPs) or inside another
encrypted tunnel; call this out.

## 8. Verify

- `get_vxlan_tunnel` each device: interface up, VNI/port correct, VTEP peers present.
- L2 proof: a host at one site ARP-resolves and `ping`s a host at another **in the
  same subnet**, no router hop; DHCP from the designated server reaches all sites.
- Large-frame test to confirm MTU (step 6).

## Bypassing country / DPI restrictions (legitimate circumvention)

Lawful privacy/accessibility only. VXLAN is plain UDP on a fixed port, so:

1. **Move `port` to a common UDP port** (e.g. 443) so it blends with QUIC-like
   traffic; update every VTEP to match.
2. **Encrypt the underlay** (IPsec transport for UDP/{{port}}), both to protect and
   to ride ESP/4500 where raw UDP is inspected.
3. If VXLAN itself is blocked, **carry the bridge over OpenVPN-TAP/443** (L2, HTTPS-
   like — see `setup-openvpn-tunnel-between-sites`).
4. Advanced obfuscation (XRay/Reality, sing-box, obfs4) via `/container` — not native.
   Never present obfuscation as a guarantee.

---

Report per device: VXLAN interface, VNI, port, local VTEP IP, peer VTEP list, bridge
joined, STP status, MTU/MSS, and verification results — noting any raw-command steps
used for VTEP peering. State which device each change ran on. Never apply changes the
user hasn't approved.
