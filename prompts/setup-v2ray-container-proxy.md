---
name: setup-v2ray-container-proxy
title: Run V2Ray/Xray (VLESS·Reality·VMess·Trojan·Shadowsocks) in a MikroTik container and route traffic through it
description: Deploy an Xray / V2Ray / sing-box client inside a RouterOS /container, wire its VETH into the router, and selectively (or fully) route LAN traffic through the encrypted VLESS-Reality / VMess / Trojan / Shadowsocks / Hysteria tunnel — with device-mode, disk, MTU, DNS-leak and kill-switch handling. For lawful privacy / censorship circumvention on networks you are authorized to use.
arguments:
  - name: device
    description: Which configured MikroTik to run the proxy container on (config key or label from list_mikrotik_devices). Omit to discover and choose.
    required: false
  - name: protocol
    description: V2Ray-family protocol the tunnel will use — vless-reality (recommended), vless-vision, vmess, trojan, shadowsocks, or (sing-box) hysteria2/tuic. This is configured INSIDE the container image, not on RouterOS.
    required: false
  - name: image
    description: Container image to run (e.g. gritsenko/xray-mikrotik:latest, or a sing-box image). Omit to let you recommend one matching the device architecture and chosen protocol.
    required: false
  - name: scope
    description: What to route through the tunnel — "selective" (only domains/IPs on an address-list, default and recommended) or "all" (default route via the tunnel, with a kill-switch).
    required: false
---

You are deploying a **V2Ray / Xray-core (or sing-box) client inside a MikroTik
RouterOS `/container`** and routing LAN traffic through its encrypted tunnel. This
is the _native-RouterOS_ way to run the modern censorship-resistant protocols —
**VLESS (+Vision/XTLS), VLESS + Reality, VMess, Trojan, Shadowsocks**, and (with a
sing-box image) **Hysteria2 / TUIC** — that RouterOS has no built-in support for.
The router runs the client; a remote V2Ray/Xray **server (a VPS you control)** is
the other end. This flow configures the RouterOS side; the tunnel's crypto
parameters live in the container image's config/env.

**Legality & scope.** This is for **lawful privacy and accessibility** on networks
and services you are authorized to use — comply with local law and provider terms.
Confirm the user understands this before proceeding. Treat the remote server
address, UUIDs, keys and short-ids as **secrets** — never log or echo them back in
full; mask them in your reports.

Target device: {{device}}
Protocol: {{protocol}}
Image: {{image}}
Routing scope: {{scope}}

---

## Back up before the first write

Before your FIRST configuration change in this workflow — the tunnel/interface, keys/peers, addresses, routes, NAT, or any mangle or firewall filter rule — ASK the user "Create a local backup first?" and, on yes, call `create_local_backup` for each device you are about to change. It saves a host-side `.rsc` restore point you can `restore_local_backup` if the change cuts the link. Discovery and the read-only fact-gathering steps below need no backup — do it once, right before you start writing. Tunnel creation always warrants a backup; you may skip it only for a minor, non-critical mangle/filter tweak the user explicitly waves off.

## 0. Discover the device and confirm it CAN run containers (do this FIRST)

- Call `list_mikrotik_devices`; resolve `{{device}}` (never substitute a similar
  name). If omitted, present the inventory and ask which router. Pass `device=` on
  every subsequent call.
- **Prerequisite check (read-only)** — containers have hard requirements; verify all
  before proposing changes:
  - `get_system_resources` (`device=<name>`) — confirm **architecture** is `arm`,
    `arm64`, or `x86` (**MIPS/SMIPS cannot run containers** — stop and say so), and
    that there is spare **RAM/CPU**.
  - `list_containers` — if it errors, the **`container` package isn't installed**.
  - Confirm an **external disk** (USB/NVMe, ext4) exists for the container root-dir —
    running container images off internal flash wears it out fast. Check with
    `run_routeros_command` `/disk print`.
- **Two prerequisites need out-of-band action — flag, do NOT silently attempt:**
  1. **device-mode = container=yes.** Enabling it (`/system/device-mode/update
mode=advanced container=yes`) requires **physical confirmation** (press the
     reset button or power-cycle within the timeout). You cannot complete this
     remotely — tell the user they must do the physical step.
  2. **Installing the `container` package** requires uploading the `.npk` and
     `/system/package/apply-changes` (7.18+) which **reboots** the router. Get
     explicit approval; note the device will drop offline during reboot.

  Do not proceed to container creation until architecture, disk, package, and
  device-mode are all satisfied.

## 1. Choose image and protocol

- **Protocol** (`{{protocol}}`): recommend **VLESS + Reality** as the default —
  Reality forges the TLS handshake of a real public site (no certificate to obtain,
  no domain to burn, strongest anti-DPI of the family). VLESS+Vision/XTLS, VMess,
  Trojan, and Shadowsocks are alternatives; sing-box images add Hysteria2/TUIC
  (QUIC-based, good on lossy/throttled links). The choice is realised in the
  container's config — RouterOS just carries the encapsulated traffic.
- **Image** (`{{image}}`): pick one matching the device architecture (map:
  `arm→linux/arm/v7`, `arm64→linux/arm64`, `x86→linux/amd64`). Community images
  (e.g. `gritsenko/xray-mikrotik`) bundle **xray-core + tun2socks** so the
  container's VETH acts directly as a routable gateway — simplest. Otherwise the
  **two-container** pattern (below) is the general form. **Read the specific image's
  README for its exact env-var names** — they differ per image; do not assume.
- **RouterOS local-import caveat:** `add_container remote_image=` pulls from a
  registry (needs `set_container_config registry-url=... tmpdir=disk1/pull` and
  internet). A local `.tar` must be **single-layer, uncompressed, Docker-v1** — most
  people pull from a registry.

## 2. Two deployment shapes (pick one, explain to the user)

**A — All-in-one image (recommended, simplest).** One container running xray-core +
tun2socks. Its VETH IP becomes the gateway you route through. Example env schema
(gritsenko/xray-mikrotik — verify against the image):
`SERVER_ADDRESS`, `SERVER_PORT`, `USER_ID`, `ENCRYPTION`, `FINGERPRINT_FP`,
`SERVER_NAME_SNI`, `PUBLIC_KEY_PBK`, `SHORT_ID_SID`.

**B — Two-container (general, more control).** Container 1 = xray-core exposing a
**SOCKS5** inbound (e.g. `172.17.0.2:1080`); Container 2 = **tun2socks /
hev-socks5-tunnel** turning that SOCKS5 into a routable gateway on its own VETH.
Typical env — xray: `REMOTE_ADDRESS,REMOTE_PORT,ID,FLOW,PUBLIC_KEY,SHORT_ID,
SERVER_NAME`; tun: `SOCKS5_ADDR=172.17.0.2,SOCKS5_PORT=1080,LOCAL_ROUTE` (so LAN
subnets return via the router, not the tunnel). _Note: original tun2socks has arm64
issues — use an arm64-built image._

## 3. Container networking (VETH + NAT + DNS)

There is **no dedicated VETH tool** — create it with `run_routeros_command`
(approve each raw command). Example for shape A on a /30:

- `/interface veth add name=veth-xray address=172.18.20.6/30 gateway=172.18.20.5`
- `add_ip_address` `address=172.18.20.5/30 interface=veth-xray` (router side).
- `create_nat_rule` `chain=srcnat action=masquerade out-interface=veth-xray` (so the
  container reaches the internet / the remote server).
- Container `dns` = the router's veth IP (`172.18.20.5`) or a resolver you trust.
  (Shape B: put both VETHs on a `containers` bridge, `172.17.0.1/24` gateway.)

## 4. Create and start the container

- If pulling from a registry: `set_container_config` `registry-url=https://registry-1.docker.io tmpdir=disk1/pull`.
- Env vars: either inline via `add_container` `env="SERVER_ADDRESS=...,USER_ID=..."`
  (7.21+) or as a named list with `add_container_env` (`envlists=`). **Mask the
  secret values in anything you print back.**
- `add_container` (`device=<name>`) — `remote_image={{image}}`, `interface=veth-xray`,
  `root_dir=disk1/xray`, `dns=172.18.20.5`, `logging=yes`, `start_on_boot=yes`,
  `hostname=xray`, and the env.
- `start_container`; then `get_container` / `list_containers` until it shows
  **running**, and read startup output with the container-log (it must show a
  successful outbound handshake to your server before routing anything through it).

## 5. Route traffic through the tunnel

**Selective (`scope=selective`, recommended)** — only chosen destinations go through
the proxy; everything else uses the normal WAN (fast, low-risk, defeats geo-blocks
for the sites that need it):

1. `add_address_list_entry` — build a list `via_proxy` of the domains/IPs to tunnel
   (RouterOS resolves domain entries to IPs automatically).
2. `add_routing_table` — `name=proxy fib`.
3. `create_mangle_rule` — `chain=prerouting action=mark-routing
new-routing-mark=proxy dst-address-list=via_proxy passthrough=no`
   (add `src-address=<LAN>` to scope to LAN clients; exclude the router's own/ the
   container subnet to avoid loops).
4. `add_route` — `dst-address=0.0.0.0/0 gateway=172.18.20.6 routing-table=proxy`
   (gateway = the container's VETH IP, shape A; the tun container's IP, shape B).

**All traffic (`scope=all`)** — default route via the tunnel. Same routing table but
mark all LAN traffic (or set the container gateway as the main default). **Mandatory
kill-switch:** add a low-priority `forward` **drop** for the LAN when the tunnel
interface is down, so a container crash can't silently leak traffic out the clear
WAN. Also pin a **higher-priority route to the remote server's IP via the real WAN**
so the tunnel's own packets don't recurse into itself.

## 6. DNS-leak & MTU handling

- **DNS leaks:** if clients query a public resolver directly, the destination is
  exposed even though the payload is tunnelled. Redirect LAN DNS (dst-nat UDP/TCP 53
  to the router or the container's resolver) so lookups for proxied domains resolve
  through the tunnel, or run the resolver inside/behind the container.
- **MTU/MSS:** encapsulation shrinks usable MTU — add a `create_mangle_rule`
  `chain=forward action=change-mss new-mss=clamp-to-pmtu tcp-flags=syn` (and/or lower
  the veth MTU). This is the #1 "handshake works, big pages hang" cause.

## 7. Firewall — safely

Under Safe Mode (`enable_safe_mode` `device=<name>` → edits → verify →
`commit_safe_mode`): allow the container subnet outbound, keep the masquerade from
step 3, and (scope=all) install the kill-switch drop. Do not expose the container's
SOCKS5 port to the WAN.

## 8. Verify end to end

- `get_container` shows **running**; the container log shows a completed handshake to
  your server (no repeated dial errors).
- From a **marked** LAN source, check the **egress IP** changed: fetch an "what is my
  IP" service from a proxied client (or `run_routeros_command` a `/tool fetch` bound
  to the proxy path) — it should show the **VPS** IP, not the local WAN IP.
- Confirm a **non-proxied** destination still exits the normal WAN (selective scope).
- `ping`/`traceroute` a proxied target; test a large HTTPS page (MTU sanity).
- Reboot-persistence: `start_on_boot=yes` and the routing rules survive a reboot.

## 9. Family notes, hardening & honest caveats

- **VLESS + Reality**: no cert/domain needed; set a believable `SERVER_NAME_SNI`
  (a real, unrelated HTTPS site the censor won't block) and matching public-key/
  short-id from the server. Strongest default against active-probing DPI.
- **VMess/Trojan/Shadowsocks**: pair with TLS/WebSocket/gRPC transports on 443 for
  camouflage; plain Shadowsocks is weaker against modern DPI.
- **Hysteria2/TUIC** (sing-box image): QUIC/UDP — great on lossy or throttled links,
  but blocked where UDP is throttled.
- **Trust**: you are running a third-party image with your keys and all your traffic.
  Prefer images you can inspect/build; pin a digest; keep it updated.
- **Reality/DPI is an arms race** — never present it as a guarantee. Keep a fallback
  (a second protocol/port, or an SSTP/OpenVPN-443 transport per
  `setup-sstp-tunnel-between-sites`).
- **Resource reality**: containers are RAM/CPU/disk heavy on small routers; on very
  low-end boards run the client on a VPS/box and point the router at it instead.

---

Report: device, architecture, image + protocol, VETH/NAT, container status, the
routing-table + mangle + route rules and the address-list scope, DNS/MTU/kill-switch
handling, and the verification results (egress-IP proof) — with **all secrets
masked**, and a note of every `run_routeros_command` step used (VETH, device-mode).
Flag the physical device-mode step and any reboot explicitly. Never apply changes the
user hasn't approved.
