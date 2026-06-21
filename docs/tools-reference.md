# Tool Reference

> **Generated** from source by `scripts/gen-tool-docs.ts` (`bun run gen:docs`) for v1.0.0. Do not edit by hand.

**649 tools** across **87 modules**. A `*` marks a required parameter.

Risk legend: 🟢 read · 🟡 write · 🔴 destructive (removes config) · ⛔ dangerous (high blast radius / not repeatable).

## Modules

| Module | Group | Tools | Scope |
|--------|-------|------:|-------|
| [Interfaces](#interfaces) | Interfaces | 4 | Generic interface listing and enable/disable (`/interface`). |
| [VLAN](#vlan) | Interfaces | 5 | 802.1Q VLAN interfaces (`/interface vlan`). |
| [Bridge](#bridge) | Interfaces | 11 | Bridges, ports, host table and bridge VLANs (`/interface bridge`). |
| [Wireless](#wireless) | Interfaces | 18 | Wireless interfaces, security profiles and access lists (legacy + wifiwave2). |
| [PoE](#poe) | Interfaces | 3 | Power-over-Ethernet status and configuration (`/interface ethernet poe`). |
| [Switch — Settings](#switch-settings) | Switch | 3 | Hardware switch chips: mirroring, CPU flow control (`/interface ethernet switch`). |
| [Switch — Ports](#switch-port) | Switch | 3 | Per-port switch chip VLAN settings (`/interface ethernet switch port`). |
| [Switch — Port Isolation](#switch-port-isolation) | Switch | 5 | Hardware port isolation / forwarding overrides (`/interface ethernet switch port-isolation`). |
| [Switch — Rules](#switch-rule) | Switch | 7 | Hardware switch ACL/redirect rules (`/interface ethernet switch rule`). |
| [IP Addresses](#ip-address) | Addressing & Routing | 4 | Interface IP addressing (`/ip address`). |
| [IP Pools](#ip-pool) | Addressing & Routing | 7 | Address pools for DHCP/PPP (`/ip pool`). |
| [Routing — Static](#routes) | Addressing & Routing | 14 | Static routes, routing table, route checks and cache (`/ip route`). |
| [DHCP](#dhcp) | Addressing & Routing | 6 | DHCP servers, networks and pools (`/ip dhcp-server`). |
| [DNS](#dns) | Addressing & Routing | 15 | DNS settings, static records, cache and regexp (`/ip dns`). |
| [IPv6 Addresses](#ipv6-address) | IPv6 | 4 | Interface IPv6 addressing (`/ipv6 address`). |
| [DHCPv6 Client](#ipv6-dhcp-client) | IPv6 | 6 | DHCPv6 client: address/prefix delegation requests (`/ipv6 dhcp-client`). |
| [DHCPv6 Relay](#ipv6-dhcp-relay) | IPv6 | 6 | DHCPv6 relay: forward client requests to upstream servers (`/ipv6 dhcp-relay`). |
| [DHCPv6 Server](#ipv6-dhcp-server) | IPv6 | 10 | DHCPv6 server, static bindings and custom options (`/ipv6 dhcp-server`). |
| [IPv6 Firewall — Filter](#ipv6-firewall-filter) | IPv6 | 8 | IPv6 filter rules (`/ipv6 firewall filter`). |
| [IPv6 Firewall — NAT](#ipv6-firewall-nat) | IPv6 | 8 | IPv6 NAT rules: src-nat, dst-nat, masquerade, netmap (`/ipv6 firewall nat`). |
| [IPv6 Firewall — Mangle](#ipv6-firewall-mangle) | IPv6 | 8 | IPv6 mangle rules: connection/packet/routing marks, DSCP, hop-limit (`/ipv6 firewall mangle`). |
| [IPv6 Firewall — Raw](#ipv6-firewall-raw) | IPv6 | 8 | IPv6 raw rules: pre-conntrack accept/drop/notrack (`/ipv6 firewall raw`). |
| [IPv6 Firewall — Address List](#ipv6-firewall-address-list) | IPv6 | 6 | IPv6 firewall address-lists (`/ipv6 firewall address-list`). |
| [IPv6 ND](#ipv6-nd) | IPv6 | 8 | Neighbor Discovery / Router Advertisement config and advertised prefixes (`/ipv6 nd`). |
| [IPv6 Neighbors](#ipv6-neighbor) | IPv6 | 3 | IPv6 neighbor cache (ND-discovered addresses), read + flush (`/ipv6 neighbor`). |
| [IPv6 Pool](#ipv6-pool) | IPv6 | 6 | IPv6 address/prefix pools for delegation and addressing (`/ipv6 pool`). |
| [IPv6 Routes](#ipv6-route) | IPv6 | 7 | Static IPv6 routes, incl. default and blackhole/unreachable (`/ipv6 route`). |
| [IPv6 Settings](#ipv6-settings) | IPv6 | 2 | Global IPv6 settings: forwarding, RA/redirect acceptance, neighbor table (`/ipv6 settings`). |
| [Router ID](#routing-id) | Dynamic Routing | 6 | Router-ID instances for OSPF/BGP (`/routing id`). |
| [Routing Settings](#routing-settings) | Dynamic Routing | 2 | Global routing settings: ECMP hash policy, VRF-as-interface (`/routing settings`). |
| [Routing Tables](#routing-table) | Dynamic Routing | 6 | Named routing tables / FIBs (`/routing table`). |
| [Routing Rules](#routing-rule) | Dynamic Routing | 6 | Policy routing rules selecting a table by src/dst/interface/mark (`/routing rule`). |
| [Next-hops](#routing-nexthop) | Dynamic Routing | 2 | Resolved recursive next-hop table, read-only diagnostics (`/routing nexthop`). |
| [Routing Filters](#routing-filter) | Dynamic Routing | 9 | Route filter rules, select-rules and num-lists (`/routing filter`). |
| [BFD](#routing-bfd) | Dynamic Routing | 6 | Bidirectional Forwarding Detection config + sessions (`/routing bfd`). |
| [BGP](#routing-bgp) | Dynamic Routing | 11 | BGP connections, templates, sessions and advertisements (`/routing bgp`). |
| [OSPF](#routing-ospf) | Dynamic Routing | 15 | OSPF instances, areas, ranges, interface-templates, neighbors and LSAs (`/routing ospf`). |
| [RIP](#routing-rip) | Dynamic Routing | 11 | RIP instances, interface-templates, static + dynamic neighbors (`/routing rip`). |
| [PIM-SM](#routing-pimsm) | Dynamic Routing | 10 | PIM Sparse-Mode instances, interface-templates, RPs and neighbors (`/routing pimsm`). |
| [IGMP Proxy](#routing-igmp-proxy) | Dynamic Routing | 8 | IGMP proxy settings, interfaces and forwarding cache (`/routing igmp-proxy`). |
| [GMP](#routing-gmp) | Dynamic Routing | 2 | Group Management Protocol (IGMP/MLD) interfaces and memberships (`/routing gmp`). |
| [RPKI](#routing-rpki) | Dynamic Routing | 5 | RPKI validator sessions for BGP origin validation (`/routing rpki`). |
| [Firewall — Filter](#firewall-filter) | Security | 9 | Filter rules and a guided basic setup (`/ip firewall filter`). |
| [Firewall — NAT](#firewall-nat) | Security | 8 | NAT rules: src/dst-nat, masquerade, redirect (`/ip firewall nat`). |
| [Address Lists](#address-list) | Security | 6 | Firewall address-lists (`/ip firewall address-list`). |
| [Certificates](#certificate) | Security | 6 | X.509 certificate management (`/certificate`). |
| [IP Services](#ip-service) | Security | 5 | Management service ports — ssh/www/api/telnet (`/ip service`). |
| [802.1X — Server](#dot1x-server) | Security | 5 | 802.1X authenticator: port-based access control via RADIUS (`/interface dot1x server`). |
| [802.1X — Client](#dot1x-client) | Security | 5 | 802.1X supplicant: authenticate the device to an upstream port (`/interface dot1x client`). |
| [WireGuard](#wireguard) | VPN & Tunneling | 15 | WireGuard interfaces, peers and client-config generation. |
| [IPsec](#ipsec) | VPN & Tunneling | 25 | IPsec IKEv1/IKEv2: profiles, peers, identities, proposals, policies, SAs (`/ip ipsec`). |
| [PPP](#ppp) | VPN & Tunneling | 12 | Shared PPP backend: profiles, secrets, active sessions (`/ppp`). |
| [L2TP](#l2tp) | VPN & Tunneling | 8 | L2TP server + clients, incl. L2TP/IPsec (`/interface l2tp-*`). |
| [PPTP](#pptp) | VPN & Tunneling | 6 | PPTP server + clients (legacy) (`/interface pptp-*`). |
| [SSTP](#sstp) | VPN & Tunneling | 6 | SSTP (TLS) server + clients (`/interface sstp-*`). |
| [OpenVPN](#openvpn) | VPN & Tunneling | 8 | OpenVPN server + clients (`/interface ovpn-*`). |
| [Tunnels](#tunnels) | VPN & Tunneling | 16 | GRE, IPIP, EoIP and VXLAN tunnels (`/interface gre|ipip|eoip|vxlan`). |
| [RADIUS](#radius) | AAA | 10 | RADIUS client servers, incoming CoA, counters (`/radius`). |
| [User Manager](#user-manager) | AAA | 19 | Built-in RADIUS server: users, profiles, routers (NAS), limitations, sessions (`/user-manager`). |
| [Queues / QoS](#queue) | QoS | 19 | Queue types, queue trees and simple queues (`/queue`). |
| [Queues — Interface](#queue-interface) | QoS | 3 | Per-interface queue-type assignment (`/queue interface`). |
| [Devices](#devices) | System & Ops | 1 | List the configured MikroTik devices the AI can target via the `device` argument. |
| [System](#system) | System & Ops | 14 | Identity, resources, health, clock/NTP, packages, reboot/shutdown. |
| [System Config](#system-config) | System & Ops | 18 | Console, LEDs, license, note, NTP server, password, ports, regulatory, reset, special-login, watchdog. |
| [Network Tools](#network-tools) | System & Ops | 8 | ping, traceroute, bandwidth-test, DNS resolve, netwatch (`/tool`). |
| [Btest Server](#tool-bandwidth-server) | Tools | 3 | Bandwidth-test server settings and sessions (`/tool bandwidth-server`). |
| [Flood Ping](#tool-flood-ping) | Tools | 1 | ICMP flood ping with summary statistics (`/tool flood-ping`). |
| [Graphing](#tool-graphing) | Tools | 5 | Interface/queue/resource graphing rules (`/tool graphing`). |
| [IP Scan](#tool-ip-scan) | Tools | 1 | Discover live hosts on a range or interface (`/tool ip-scan`). |
| [MAC Server](#tool-mac-server) | Tools | 7 | MAC-Telnet/MAC-Winbox/MAC-ping servers and sessions (`/tool mac-server`). |
| [Packet Sniffer](#tool-sniffer) | Tools | 9 | Packet capture: settings, start/stop/save, captured hosts/protocols/packets (`/tool sniffer`). |
| [Profile](#tool-profile) | Tools | 1 | CPU usage profiler by subsystem (`/tool profile`). |
| [RoMON](#tool-romon) | Tools | 5 | Router Management Overlay Network settings and ports (`/tool romon`). |
| [SMS](#tool-sms) | Tools | 4 | Send/receive SMS over an LTE modem (`/tool sms`). |
| [Speed Test](#tool-speed-test) | Tools | 1 | Latency/throughput test to another RouterOS (`/tool speed-test`). |
| [Traffic Generator](#tool-traffic-generator) | Tools | 8 | Synthetic traffic: ports, streams and run control (`/tool traffic-generator`). |
| [Traffic Monitor](#tool-traffic-monitor) | Tools | 7 | Run scripts when interface traffic crosses a threshold (`/tool traffic-monitor`). |
| [Wake-on-LAN](#tool-wol) | Tools | 1 | Send Wake-on-LAN magic packets (`/tool wol`). |
| [Scheduler / Scripts](#scheduler) | System & Ops | 10 | Scheduled jobs and scripts (`/system scheduler`, `/system script`). |
| [Users](#users) | System & Ops | 18 | Users, groups, active sessions and SSH keys (`/user`). |
| [Logs](#logs) | System & Ops | 10 | Log retrieval, search, statistics and export (`/log`). |
| [Logging Config](#logging) | System & Ops | 6 | Logging rules + actions: where each topic is logged (`/system logging`). |
| [Backup](#backup) | System & Ops | 10 | Binary backups, text exports, file transfer and restore. |
| [S3 Backup](#s3-backup) | System & Ops | 6 | Optional: ship device backups/exports to S3-compatible storage, organised per device (`/tool fetch` + Bun S3). |
| [Disk](#disk) | System & Ops | 3 | Storage devices: list/get disks and format-drive (`/disk`). |
| [Safe Mode](#safe-mode) | System & Ops | 4 | Transactional config window with auto-revert (Ctrl+X session). |
| [Apps — Dashboards](#app-views) | MCP Apps | 3 | Tools that render interactive UI views inline (MCP Apps): the device dashboard, the interfaces overview and the firewall-rules table. Every read tool (list_*/get_*) additionally renders in the generic records viewer. |

## Interfaces

<a id="interfaces"></a>Generic interface listing and enable/disable (`/interface`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_interfaces` | 🟢 read | `type_filter`, `name_filter`, `running_only`*, `disabled_only`* | Lists all interfaces on the MikroTik device (ethernet, bridge, WireGuard, PPPoE, VLAN, WiFi, SFP, LTE, loopback, and any other type). |
| `get_interface` | 🟢 read | `name`* | Gets detailed information about a specific interface by name. |
| `enable_interface` | 🟡 write·idem | `name`* | Enables an interface on the MikroTik device. |
| `disable_interface` | 🟡 write·idem | `name`* | Disables an interface on the MikroTik device. |

## VLAN

<a id="vlan"></a>802.1Q VLAN interfaces (`/interface vlan`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_vlan_interface` | 🟡 write | `name`*, `vlan_id`*, `interface`*, `comment`, `disabled`*, `mtu`, `use_service_tag`*, `arp`*, `arp_timeout` | Creates a VLAN interface on the MikroTik device with the given VLAN ID and parent interface. |
| `list_vlan_interfaces` | 🟢 read | `name_filter`, `vlan_id_filter`, `interface_filter`, `disabled_only`* | Lists VLAN interfaces on the MikroTik device. |
| `get_vlan_interface` | 🟢 read | `name`* | Gets detailed information about a specific VLAN interface. |
| `update_vlan_interface` | 🟡 write·idem | `name`*, `new_name`, `vlan_id`, `interface`, `comment`, `disabled`, `mtu`, `use_service_tag`, `arp`, `arp_timeout` | Updates an existing VLAN interface's settings on the MikroTik device. |
| `remove_vlan_interface` | 🔴 destructive | `name`* | Removes a VLAN interface from the MikroTik device. |

## Bridge

<a id="bridge"></a>Bridges, ports, host table and bridge VLANs (`/interface bridge`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_bridge` | 🟡 write | `name`*, `comment`, `vlan_filtering`*, `protocol_mode`, `disabled`*, `mtu` | Creates a bridge interface on the MikroTik device. |
| `list_bridges` | 🟢 read | `name_filter` | Lists bridge interfaces on the MikroTik device. |
| `get_bridge` | 🟢 read | `name`* | Gets detailed information about a specific bridge. |
| `update_bridge` | 🟡 write·idem | `name`*, `new_name`, `comment`, `vlan_filtering`, `protocol_mode`, `disabled`, `mtu` | Updates an existing bridge's settings on the MikroTik device. |
| `remove_bridge` | 🔴 destructive | `name`* | Removes a bridge interface from the MikroTik device. |
| `add_bridge_port` | 🟡 write | `bridge`*, `interface`*, `pvid`, `comment`, `hw` | Adds an interface as a port to a bridge on the MikroTik device. |
| `list_bridge_ports` | 🟢 read | `bridge_filter`, `interface_filter` | Lists bridge ports on the MikroTik device. |
| `remove_bridge_port` | 🔴 destructive | `interface`* | Removes a port (interface) from its bridge on the MikroTik device. |
| `list_bridge_hosts` | 🟢 read | `bridge_filter` | Lists the bridge host (MAC address) table on the MikroTik device. |
| `add_bridge_vlan` | 🟡 write | `bridge`*, `vlan_ids`*, `tagged`, `untagged` | Adds a VLAN entry to a bridge's VLAN table (requires vlan-filtering on the bridge). |
| `list_bridge_vlans` | 🟢 read | `bridge_filter` | Lists the bridge VLAN table on the MikroTik device. |

## Wireless

<a id="wireless"></a>Wireless interfaces, security profiles and access lists (legacy + wifiwave2).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_wireless_interface` | 🟡 write | `name`*, `ssid`, `disabled`*, `comment`, `radio_name`, `mode`, `frequency`, `band`, `channel_width`, `security_profile` | Creates a wireless interface on the MikroTik device (auto-detects RouterOS v6/v7 syntax). |
| `list_wireless_interfaces` | 🟢 read | `name_filter`, `disabled_only`*, `running_only`* | Lists wireless interfaces on the MikroTik device. |
| `get_wireless_interface` | 🟢 read | `name`* | Gets detailed information about a specific wireless interface. |
| `remove_wireless_interface` | 🔴 destructive | `name`* | Removes a wireless interface from the MikroTik device. |
| `enable_wireless_interface` | 🟡 write·idem | `name`* | Enables a wireless interface. |
| `disable_wireless_interface` | 🟡 write·idem | `name`* | Disables a wireless interface. |
| `scan_wireless_networks` | 🟢 read | `interface`*, `duration`* | Scans for nearby wireless networks using the specified interface. |
| `get_wireless_registration_table` | 🟢 read | `interface` | Gets the wireless registration table (connected clients) from the MikroTik device. |
| `check_wireless_support` | 🟢 read | _none_ | Checks if the device supports wireless and reports the RouterOS version and wireless interface type. |
| `create_wireless_security_profile` | 🟡 write | `name`* | Legacy function - not supported in RouterOS v7.x |
| `list_wireless_security_profiles` | 🟢 read | _none_ | Legacy function - not supported in RouterOS v7.x |
| `get_wireless_security_profile` | 🟢 read | `name`* | Legacy function - not supported in RouterOS v7.x |
| `remove_wireless_security_profile` | 🔴 destructive | `name`* | Legacy function - not supported in RouterOS v7.x |
| `set_wireless_security_profile` | 🟡 write | `interface_name`*, `security_profile`* | Legacy function - not supported in RouterOS v7.x |
| `create_wireless_access_list` | 🟡 write | _none_ | Legacy function - different in RouterOS v7.x |
| `list_wireless_access_list` | 🟢 read | _none_ | Legacy function - different in RouterOS v7.x |
| `remove_wireless_access_list_entry` | 🔴 destructive | `entry_id`* | Legacy function - different in RouterOS v7.x |
| `update_wireless_interface` | 🟡 write·idem | `name`*, `new_name`, `ssid`, `disabled`, `comment` | Updates an existing wireless interface's settings (name, SSID, enabled state, etc.). |

## PoE

<a id="poe"></a>Power-over-Ethernet status and configuration (`/interface ethernet poe`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_poe_monitor` | 🟢 read | `interfaces`* | Reads real-time Power-over-Ethernet (PoE) monitor data for one or more ethernet interfaces — PoE-out status, voltage, current, and power. Runs `/interface ethernet poe monitor <interfaces> once`. |
| `list_poe` | 🟢 read | `interface_filter` | Lists the Power-over-Ethernet (PoE) configuration of PoE-capable ethernet interfaces (PoE-out mode, priority). Runs `/interface ethernet poe print`. |
| `get_poe_settings` | 🟢 read | `name`* | Gets the detailed PoE-out settings of a specific ethernet interface (mode, priority, voltage, thresholds). Runs `/interface ethernet poe print detail where name=<name>`. |

## Switch — Settings

<a id="switch-settings"></a>Hardware switch chips: mirroring, CPU flow control (`/interface ethernet switch`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_switches` | 🟢 read | `name_filter`, `type_filter` | Lists the hardware switch chips on the MikroTik device (`/interface ethernet switch`). |
| `get_switch` | 🟢 read | `switch_id`* | Gets detailed settings for a specific switch chip by name or '.id'. |
| `update_switch` | 🟡 write·idem | `switch_id`*, `name`, `cpu_flow_control`, `mirror_source`, `mirror_target`, `mirror_egress` | Updates settings for a switch chip on the MikroTik device. |

## Switch — Ports

<a id="switch-port"></a>Per-port switch chip VLAN settings (`/interface ethernet switch port`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_switch_ports` | 🟢 read | `name_filter`, `switch_filter` | Lists switch chip ports on the MikroTik device (`/interface ethernet switch port`). |
| `get_switch_port` | 🟢 read | `port_id`* | Gets detailed settings for a specific switch port by name or '.id'. |
| `update_switch_port` | 🟡 write·idem | `port_id`*, `default_vlan_id`, `vlan_mode`, `vlan_header`, `force_vlan_id` | Updates a switch port's hardware VLAN settings on the MikroTik device. |

## Switch — Port Isolation

<a id="switch-port-isolation"></a>Hardware port isolation / forwarding overrides (`/interface ethernet switch port-isolation`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_switch_port_isolation` | 🟡 write | `port`*, `forwarding_override_ports`*, `comment` | Adds a switch port-isolation entry on the MikroTik device, overriding which ports a given port may forward traffic to (hardware private-VLAN style isolation). |
| `list_switch_port_isolation` | 🟢 read | `port_filter` | Lists switch port-isolation entries on the MikroTik device. |
| `get_switch_port_isolation` | 🟢 read | `isolation_id`* | Gets a specific switch port-isolation entry by source port or '.id'. |
| `update_switch_port_isolation` | 🟡 write·idem | `isolation_id`*, `forwarding_override_ports`, `comment` | Updates a switch port-isolation entry (by source port or '.id'). Pass comment="" to clear the comment. |
| `remove_switch_port_isolation` | 🔴 destructive | `isolation_id`* | Removes a switch port-isolation entry by source port or '.id' from the MikroTik device. |

## Switch — Rules

<a id="switch-rule"></a>Hardware switch ACL/redirect rules (`/interface ethernet switch rule`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_switch_rule` | 🟡 write | `switch`*, `ports`*, `src_address`, `dst_address`, `src_mac_address`, `dst_mac_address`, `src_port`, `dst_port`, `protocol`, `mac_protocol`, `vlan_id`, `vlan_priority`, `dscp`, `flow_label`, `new_dst_ports`, `new_vlan_id`, `new_vlan_priority`, `redirect_to_cpu`, `copy_to_cpu`, `mirror`, `rate`, `comment`, `disabled`* | Adds a switch ACL/redirect rule on the MikroTik device (`/interface ethernet switch rule`). Rules match traffic in hardware on the listed source ports and apply an action. |
| `list_switch_rules` | 🟢 read | `switch_filter`, `ports_filter`, `disabled_only`* | Lists switch ACL/redirect rules on the MikroTik device. |
| `get_switch_rule` | 🟢 read | `rule_id`* | Gets a specific switch rule by '.id'. |
| `update_switch_rule` | 🟡 write·idem | `rule_id`*, `switch`, `ports`, `src_address`, `dst_address`, `src_mac_address`, `dst_mac_address`, `src_port`, `dst_port`, `protocol`, `mac_protocol`, `vlan_id`, `vlan_priority`, `dscp`, `flow_label`, `new_dst_ports`, `new_vlan_id`, `new_vlan_priority`, `redirect_to_cpu`, `copy_to_cpu`, `mirror`, `rate`, `comment`, `disabled` | Updates an existing switch rule on the MikroTik device. Pass "" to clear an optional matcher/action field. |
| `remove_switch_rule` | 🔴 destructive | `rule_id`* | Removes a switch rule by '.id' from the MikroTik device. |
| `enable_switch_rule` | 🟡 write·idem | `rule_id`* | Enables a switch rule by '.id'. |
| `disable_switch_rule` | 🟡 write·idem | `rule_id`* | Disables a switch rule by '.id'. |

## IP Addresses

<a id="ip-address"></a>Interface IP addressing (`/ip address`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_ip_address` | 🟡 write | `address`*, `interface`*, `network`, `broadcast`, `comment`, `disabled`* | Adds an IP address to an interface on the MikroTik device. |
| `list_ip_addresses` | 🟢 read | `interface_filter`, `address_filter`, `network_filter`, `disabled_only`*, `dynamic_only`* | Lists IP addresses on the MikroTik device. |
| `get_ip_address` | 🟢 read | `address_id`* | Gets detailed information about a specific IP address by ID or address value. |
| `remove_ip_address` | 🔴 destructive | `address_id`* | Removes an IP address from the MikroTik device by ID or address value. |

## IP Pools

<a id="ip-pool"></a>Address pools for DHCP/PPP (`/ip pool`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_ip_pool` | 🟡 write | `name`*, `ranges`*, `next_pool`, `comment` | Creates an IP pool with the given address ranges on the MikroTik device. |
| `list_ip_pools` | 🟢 read | `name_filter`, `ranges_filter`, `include_used`* | Lists IP pools on the MikroTik device. |
| `get_ip_pool` | 🟢 read | `name`* | Gets detailed information about a specific IP pool including used address count. |
| `update_ip_pool` | 🟡 write·idem | `name`*, `new_name`, `ranges`, `next_pool`, `comment` | Updates an existing IP pool's name, ranges, or next-pool reference. Pass "" for next_pool to clear it. |
| `remove_ip_pool` | 🔴 destructive | `name`* | Removes an IP pool from the MikroTik device (fails if pool is in use). |
| `list_ip_pool_used` | 🟢 read | `pool_name`, `address_filter`, `mac_filter`, `info_filter` | Lists currently used (allocated) addresses from IP pools. |
| `expand_ip_pool` | 🟡 write·idem | `name`*, `additional_ranges`* | Expands an existing IP pool by appending additional address ranges. |

## Routing — Static

<a id="routes"></a>Static routes, routing table, route checks and cache (`/ip route`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_route` | 🟡 write | `dst_address`*, `gateway`*, `distance`, `scope`, `target_scope`, `routing_mark`, `comment`, `disabled`*, `vrf_interface`, `pref_src`, `check_gateway` | Adds a route to the routing table. |
| `list_routes` | 🟢 read | `dst_filter`, `gateway_filter`, `routing_mark_filter`, `distance_filter`, `active_only`*, `disabled_only`*, `dynamic_only`*, `static_only`* | Lists routes in MikroTik routing table. |
| `get_route` | 🟢 read | `route_id`* | Gets detailed information about a specific route. |
| `update_route` | 🟡 write·idem | `route_id`*, `dst_address`, `gateway`, `distance`, `scope`, `target_scope`, `routing_mark`, `comment`, `disabled`, `vrf_interface`, `pref_src`, `check_gateway` | Updates a route. Pass "" to routing_mark, vrf_interface, or pref_src to clear them. |
| `remove_route` | 🔴 destructive | `route_id`* | Removes a route. |
| `enable_route` | 🟡 write·idem | `route_id`* | Enables a route. |
| `disable_route` | 🟡 write·idem | `route_id`* | Disables a route. |
| `get_routing_table` | 🟢 read | `table_name`*, `protocol_filter`, `active_only`* | Gets a specific routing table. |
| `check_route_path` | 🟢 read | `destination`*, `source`, `routing_mark` | Checks the route path to a destination. |
| `get_route_cache` | 🟢 read | _none_ | Shows the route/forwarding cache. Version-aware: on RouterOS v6 it reads the real route cache (`/ip route cache`); on v7+ — which removed the separate cache — it returns the active forwarding table (FIB), i.e. `/ip route` entries with active=yes, the closest equivalent. |
| `flush_route_cache` | 🔴 destructive | _none_ | Flushes the route cache (`/ip route cache flush`). Version-aware: on RouterOS v6 it flushes the cache; on v7+ there is no separate cache, so it reports a no-op (the FIB is rebuilt from /ip route directly). |
| `add_default_route` | 🟡 write | `gateway`*, `distance`*, `comment`, `check_gateway`* | Adds a default route. |
| `add_blackhole_route` | 🟡 write | `dst_address`*, `distance`*, `comment` | Adds a blackhole route. |
| `get_route_statistics` | 🟢 read | _none_ | Gets routing table statistics. |

## DHCP

<a id="dhcp"></a>DHCP servers, networks and pools (`/ip dhcp-server`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_dhcp_server` | 🟡 write | `name`*, `interface`*, `lease_time`*, `address_pool`, `disabled`*, `authoritative`*, `delay_threshold`, `comment` | Creates a DHCP server bound to the specified interface on the MikroTik device. |
| `list_dhcp_servers` | 🟢 read | `name_filter`, `interface_filter`, `disabled_only`*, `invalid_only`* | Lists DHCP servers on the MikroTik device. |
| `get_dhcp_server` | 🟢 read | `name`* | Gets detailed information about a specific DHCP server. |
| `create_dhcp_network` | 🟡 write | `network`*, `gateway`*, `netmask`, `dns_servers`, `domain`, `wins_servers`, `ntp_servers`, `dhcp_option`, `comment` | Creates a DHCP network configuration (gateway, DNS, domain, etc.) on the MikroTik device. |
| `create_dhcp_pool` | 🟡 write | `name`*, `ranges`*, `next_pool`, `comment` | Creates a DHCP address pool with the given IP ranges on the MikroTik device. |
| `remove_dhcp_server` | 🔴 destructive | `name`* | Removes a DHCP server from the MikroTik device. |

## DNS

<a id="dns"></a>DNS settings, static records, cache and regexp (`/ip dns`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `set_dns_servers` | 🟡 write | `servers`*, `allow_remote_requests`*, `max_udp_packet_size`, `max_concurrent_queries`, `cache_size`, `cache_max_ttl`, `use_doh`*, `doh_server`, `verify_doh_cert`* | Sets DNS server configuration. |
| `get_dns_settings` | 🟢 read | _none_ | Gets current DNS configuration. |
| `add_dns_static` | 🟡 write | `name`*, `address`, `cname`, `mx_preference`, `mx_exchange`, `text`, `srv_priority`, `srv_weight`, `srv_port`, `srv_target`, `ttl`, `comment`, `disabled`*, `regexp` | Adds a static DNS entry. |
| `list_dns_static` | 🟢 read | `name_filter`, `address_filter`, `type_filter`, `disabled_only`*, `regexp_only`* | Lists static DNS entries. |
| `get_dns_static` | 🟢 read | `entry_id`* | Gets details of a specific static DNS entry. |
| `update_dns_static` | 🟡 write·idem | `entry_id`*, `name`, `address`, `cname`, `mx_preference`, `mx_exchange`, `text`, `srv_priority`, `srv_weight`, `srv_port`, `srv_target`, `ttl`, `comment`, `disabled`, `regexp` | Updates a static DNS entry. |
| `remove_dns_static` | 🔴 destructive | `entry_id`* | Removes a static DNS entry. |
| `enable_dns_static` | 🟡 write·idem | `entry_id`* | Enables a static DNS entry. |
| `disable_dns_static` | 🟡 write·idem | `entry_id`* | Disables a static DNS entry. |
| `get_dns_cache` | 🟢 read | _none_ | Gets the current DNS cache. |
| `flush_dns_cache` | 🔴 destructive | _none_ | Flushes the DNS cache. |
| `get_dns_cache_statistics` | 🟢 read | _none_ | Gets DNS cache statistics — cache size/used/max-ttl (from `/ip dns print`) and the number of cached entries. Works on RouterOS v6 and v7 (there is no `/ip dns cache print stats` command). |
| `add_dns_regexp` | 🟡 write | `regexp`*, `address`*, `ttl`*, `comment`, `disabled`* | Adds a DNS regexp entry. |
| `test_dns_query` | 🟢 read | `name`*, `server`, `type`* | Tests a DNS query. |
| `export_dns_config` | 🟢 read | `filename` | Exports DNS configuration to a file. |

## IPv6 Addresses

<a id="ipv6-address"></a>Interface IPv6 addressing (`/ipv6 address`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_ipv6_address` | 🟡 write | `address`*, `interface`*, `advertise`, `eui_64`, `from_pool`, `no_dad`, `comment`, `disabled`* | Adds an IPv6 address to an interface on the MikroTik device. |
| `list_ipv6_addresses` | 🟢 read | `interface_filter`, `address_filter`, `disabled_only`*, `dynamic_only`*, `link_local_only`* | Lists IPv6 addresses on the MikroTik device. |
| `get_ipv6_address` | 🟢 read | `address_id`* | Gets detailed information about a specific IPv6 address by ID or address value. |
| `remove_ipv6_address` | 🔴 destructive | `address_id`* | Removes an IPv6 address from the MikroTik device by ID or address value. |

## DHCPv6 Client

<a id="ipv6-dhcp-client"></a>DHCPv6 client: address/prefix delegation requests (`/ipv6 dhcp-client`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_ipv6_dhcp_client` | 🟡 write | `interface`*, `request`*, `pool_name`, `pool_prefix_length`, `prefix_hint`, `add_default_route`, `default_route_distance`, `use_peer_dns`, `rapid_commit`, `dhcp_options`, `comment`, `disabled`* | Adds a DHCPv6 client on an interface on the MikroTik device. |
| `list_ipv6_dhcp_clients` | 🟢 read | `interface_filter`, `status_filter`, `disabled_only`*, `invalid_only`* | Lists DHCPv6 clients on the MikroTik device. |
| `get_ipv6_dhcp_client` | 🟢 read | `client_id`* | Gets detailed information about a specific DHCPv6 client by ID or interface. |
| `release_ipv6_dhcp_client` | 🟡 write·idem | `client_id`* | Releases the current DHCPv6 lease/prefix for a client (by ID or interface). |
| `renew_ipv6_dhcp_client` | 🟡 write·idem | `client_id`* | Renews the DHCPv6 lease/prefix for a client (by ID or interface). |
| `remove_ipv6_dhcp_client` | 🔴 destructive | `client_id`* | Removes a DHCPv6 client from the MikroTik device by ID or interface. |

## DHCPv6 Relay

<a id="ipv6-dhcp-relay"></a>DHCPv6 relay: forward client requests to upstream servers (`/ipv6 dhcp-relay`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_ipv6_dhcp_relay` | 🟡 write | `name`*, `interface`*, `dhcp_server`*, `delay_time`, `comment`, `disabled`* | Adds a DHCPv6 relay on the MikroTik device, forwarding client requests from a local interface to upstream DHCPv6 server(s). |
| `list_ipv6_dhcp_relays` | 🟢 read | `name_filter`, `interface_filter`, `disabled_only`* | Lists DHCPv6 relays on the MikroTik device. |
| `get_ipv6_dhcp_relay` | 🟢 read | `name`* | Gets detailed information about a specific DHCPv6 relay. |
| `enable_ipv6_dhcp_relay` | 🟡 write·idem | `name`* | Enables a DHCPv6 relay on the MikroTik device. |
| `disable_ipv6_dhcp_relay` | 🟡 write·idem | `name`* | Disables a DHCPv6 relay on the MikroTik device. |
| `remove_ipv6_dhcp_relay` | 🔴 destructive | `name`* | Removes a DHCPv6 relay from the MikroTik device. |

## DHCPv6 Server

<a id="ipv6-dhcp-server"></a>DHCPv6 server, static bindings and custom options (`/ipv6 dhcp-server`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_ipv6_dhcp_server` | 🟡 write | `name`*, `interface`*, `address_pool`*, `lease_time`*, `binding_script`, `rapid_commit`, `preference`, `route_distance`, `dhcp_option`, `comment`, `disabled`* | Creates a DHCPv6 server bound to an interface on the MikroTik device. |
| `list_ipv6_dhcp_servers` | 🟢 read | `name_filter`, `interface_filter`, `disabled_only`*, `invalid_only`* | Lists DHCPv6 servers on the MikroTik device. |
| `get_ipv6_dhcp_server` | 🟢 read | `name`* | Gets detailed information about a specific DHCPv6 server. |
| `remove_ipv6_dhcp_server` | 🔴 destructive | `name`* | Removes a DHCPv6 server from the MikroTik device. |
| `add_ipv6_dhcp_binding` | 🟡 write | `address`, `prefix`, `duid`*, `iaid`, `server`, `life_time`, `comment`, `disabled`* | Adds a DHCPv6 server binding (static prefix/address assignment) on the MikroTik device. |
| `list_ipv6_dhcp_bindings` | 🟢 read | `server_filter`, `duid_filter`, `dynamic_only`* | Lists DHCPv6 server bindings on the MikroTik device. |
| `remove_ipv6_dhcp_binding` | 🔴 destructive | `binding_id`* | Removes a DHCPv6 server binding by ID or DUID from the MikroTik device. |
| `add_ipv6_dhcp_option` | 🟡 write | `name`*, `code`*, `value`*, `comment` | Adds a custom DHCPv6 option on the MikroTik device. |
| `list_ipv6_dhcp_options` | 🟢 read | `name_filter` | Lists custom DHCPv6 options on the MikroTik device. |
| `remove_ipv6_dhcp_option` | 🔴 destructive | `name`* | Removes a custom DHCPv6 option by name from the MikroTik device. |

## IPv6 Firewall — Filter

<a id="ipv6-firewall-filter"></a>IPv6 filter rules (`/ipv6 firewall filter`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_ipv6_filter_rule` | 🟡 write | `chain`*, `action`*, `src_address`, `dst_address`, `src_port`, `dst_port`, `protocol`, `in_interface`, `out_interface`, `in_interface_list`, `out_interface_list`, `connection_state`, `src_address_list`, `dst_address_list`, `hop_limit`, `limit`, `tcp_flags`, `comment`, `disabled`*, `log`*, `log_prefix`, `place_before` | Creates an IPv6 firewall filter rule in the specified chain on the MikroTik device. connection_state: comma-separated e.g. "established,related,new,invalid". hop_limit: RouterOS hop-limit expression e.g. "equal:1" or "less:64". limit: RouterOS rate/burst string e.g. "10,5:packet". tcp_flags: RouterOS flag expression e.g. "syn,!ack". place_before: rule number or ID (*N) to insert before e.g. "0" or "*3". |
| `list_ipv6_filter_rules` | 🟢 read | `chain_filter`, `action_filter`, `src_address_filter`, `dst_address_filter`, `protocol_filter`, `interface_filter`, `disabled_only`*, `invalid_only`*, `dynamic_only`* | Lists IPv6 firewall filter rules on the MikroTik device. |
| `get_ipv6_filter_rule` | 🟢 read | `rule_id`* | Gets detailed information about a specific IPv6 firewall filter rule. rule_id: use the ID from list output e.g. "*1" or "0". |
| `update_ipv6_filter_rule` | 🟡 write·idem | `rule_id`*, `chain`, `action`, `src_address`, `dst_address`, `src_port`, `dst_port`, `protocol`, `in_interface`, `out_interface`, `in_interface_list`, `out_interface_list`, `connection_state`, `src_address_list`, `dst_address_list`, `hop_limit`, `limit`, `tcp_flags`, `comment`, `disabled`, `log`, `log_prefix` | Updates an existing IPv6 firewall filter rule on the MikroTik device. rule_id: use the ID from list output e.g. "*1" or "0". Pass "" to clear an optional field (e.g. src_address=""). |
| `remove_ipv6_filter_rule` | 🔴 destructive | `rule_id`* | Removes an IPv6 firewall filter rule from the MikroTik device. rule_id: use the ID from list output e.g. "*1" or "0". |
| `move_ipv6_filter_rule` | 🟡 write·idem | `rule_id`*, `destination`* | Moves an IPv6 firewall filter rule to a different position in the chain. destination: 0-based target position index. |
| `enable_ipv6_filter_rule` | 🟡 write·idem | `rule_id`* | Enables an IPv6 firewall filter rule. |
| `disable_ipv6_filter_rule` | 🟡 write·idem | `rule_id`* | Disables an IPv6 firewall filter rule. |

## IPv6 Firewall — NAT

<a id="ipv6-firewall-nat"></a>IPv6 NAT rules: src-nat, dst-nat, masquerade, netmap (`/ipv6 firewall nat`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_ipv6_nat_rule` | 🟡 write | `chain`*, `action`*, `src_address`, `dst_address`, `src_port`, `dst_port`, `protocol`, `in_interface`, `out_interface`, `to_address`, `to_ports`, `src_address_list`, `dst_address_list`, `comment`, `disabled`*, `log`*, `log_prefix`, `place_before` | Creates an IPv6 firewall NAT rule on the MikroTik device. chain: 'srcnat' (after routing) or 'dstnat' (before routing). action: masquerade/src-nat/dst-nat/netmap/redirect/accept/etc. to_address: rewrite target for src-nat/dst-nat/netmap. place_before: rule number or ID (*N) to insert before. |
| `list_ipv6_nat_rules` | 🟢 read | `chain_filter`, `action_filter`, `src_address_filter`, `dst_address_filter`, `disabled_only`*, `invalid_only`*, `dynamic_only`* | Lists IPv6 firewall NAT rules on the MikroTik device. |
| `get_ipv6_nat_rule` | 🟢 read | `rule_id`* | Gets detailed information about a specific IPv6 firewall NAT rule. |
| `update_ipv6_nat_rule` | 🟡 write·idem | `rule_id`*, `chain`, `action`, `src_address`, `dst_address`, `src_port`, `dst_port`, `protocol`, `in_interface`, `out_interface`, `to_address`, `to_ports`, `src_address_list`, `dst_address_list`, `comment`, `disabled`, `log`, `log_prefix` | Updates an existing IPv6 firewall NAT rule. Pass "" to clear an optional field (e.g. to_address=""). |
| `remove_ipv6_nat_rule` | 🔴 destructive | `rule_id`* | Removes an IPv6 firewall NAT rule from the MikroTik device. |
| `move_ipv6_nat_rule` | 🟡 write·idem | `rule_id`*, `destination`* | Moves an IPv6 firewall NAT rule to a different position in the chain. |
| `enable_ipv6_nat_rule` | 🟡 write·idem | `rule_id`* | Enables an IPv6 firewall NAT rule. |
| `disable_ipv6_nat_rule` | 🟡 write·idem | `rule_id`* | Disables an IPv6 firewall NAT rule. |

## IPv6 Firewall — Mangle

<a id="ipv6-firewall-mangle"></a>IPv6 mangle rules: connection/packet/routing marks, DSCP, hop-limit (`/ipv6 firewall mangle`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_ipv6_mangle_rule` | 🟡 write | `chain`*, `action`*, `src_address`, `dst_address`, `src_port`, `dst_port`, `protocol`, `in_interface`, `out_interface`, `connection_mark`, `packet_mark`, `routing_mark`, `new_connection_mark`, `new_packet_mark`, `new_routing_mark`, `new_dscp`, `new_hop_limit`, `passthrough`, `comment`, `disabled`*, `log`*, `log_prefix`, `place_before` | Creates an IPv6 firewall mangle rule on the MikroTik device. chain: prerouting/input/forward/output/postrouting. action: mark-connection/mark-packet/mark-routing/change-dscp/change-hop-limit/change-mss/accept/etc. Set the matching new-*-mark field for mark-* actions and keep passthrough=true to let later rules also match. |
| `list_ipv6_mangle_rules` | 🟢 read | `chain_filter`, `action_filter`, `connection_mark_filter`, `packet_mark_filter`, `disabled_only`*, `invalid_only`*, `dynamic_only`* | Lists IPv6 firewall mangle rules on the MikroTik device. |
| `get_ipv6_mangle_rule` | 🟢 read | `rule_id`* | Gets detailed information about a specific IPv6 firewall mangle rule. |
| `update_ipv6_mangle_rule` | 🟡 write·idem | `rule_id`*, `chain`, `action`, `src_address`, `dst_address`, `src_port`, `dst_port`, `protocol`, `in_interface`, `out_interface`, `connection_mark`, `packet_mark`, `routing_mark`, `new_connection_mark`, `new_packet_mark`, `new_routing_mark`, `new_dscp`, `new_hop_limit`, `passthrough`, `comment`, `disabled`, `log`, `log_prefix` | Updates an existing IPv6 firewall mangle rule. Pass "" to clear an optional field. |
| `remove_ipv6_mangle_rule` | 🔴 destructive | `rule_id`* | Removes an IPv6 firewall mangle rule from the MikroTik device. |
| `move_ipv6_mangle_rule` | 🟡 write·idem | `rule_id`*, `destination`* | Moves an IPv6 firewall mangle rule to a different position in the chain. |
| `enable_ipv6_mangle_rule` | 🟡 write·idem | `rule_id`* | Enables an IPv6 firewall mangle rule. |
| `disable_ipv6_mangle_rule` | 🟡 write·idem | `rule_id`* | Disables an IPv6 firewall mangle rule. |

## IPv6 Firewall — Raw

<a id="ipv6-firewall-raw"></a>IPv6 raw rules: pre-conntrack accept/drop/notrack (`/ipv6 firewall raw`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_ipv6_raw_rule` | 🟡 write | `chain`*, `action`*, `src_address`, `dst_address`, `src_port`, `dst_port`, `protocol`, `in_interface`, `out_interface`, `src_address_list`, `dst_address_list`, `comment`, `disabled`*, `log`*, `log_prefix`, `place_before` | Creates an IPv6 firewall raw rule on the MikroTik device. The raw table runs before connection tracking — use it to bypass tracking (notrack) or drop traffic cheaply. chain: 'prerouting' or 'output'. |
| `list_ipv6_raw_rules` | 🟢 read | `chain_filter`, `action_filter`, `src_address_filter`, `dst_address_filter`, `disabled_only`*, `invalid_only`*, `dynamic_only`* | Lists IPv6 firewall raw rules on the MikroTik device. |
| `get_ipv6_raw_rule` | 🟢 read | `rule_id`* | Gets detailed information about a specific IPv6 firewall raw rule. |
| `update_ipv6_raw_rule` | 🟡 write·idem | `rule_id`*, `chain`, `action`, `src_address`, `dst_address`, `src_port`, `dst_port`, `protocol`, `in_interface`, `out_interface`, `src_address_list`, `dst_address_list`, `comment`, `disabled`, `log`, `log_prefix` | Updates an existing IPv6 firewall raw rule. Pass "" to clear an optional field. |
| `remove_ipv6_raw_rule` | 🔴 destructive | `rule_id`* | Removes an IPv6 firewall raw rule from the MikroTik device. |
| `move_ipv6_raw_rule` | 🟡 write·idem | `rule_id`*, `destination`* | Moves an IPv6 firewall raw rule to a different position in the chain. |
| `enable_ipv6_raw_rule` | 🟡 write·idem | `rule_id`* | Enables an IPv6 firewall raw rule. |
| `disable_ipv6_raw_rule` | 🟡 write·idem | `rule_id`* | Disables an IPv6 firewall raw rule. |

## IPv6 Firewall — Address List

<a id="ipv6-firewall-address-list"></a>IPv6 firewall address-lists (`/ipv6 firewall address-list`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_ipv6_address_list_entry` | 🟡 write | `list`*, `address`*, `timeout`, `comment`, `disabled`* | Adds an IPv6 address/prefix to an IPv6 firewall address-list. |
| `list_ipv6_address_lists` | 🟢 read | `list_filter`, `address_filter`, `dynamic_only`* | Lists IPv6 firewall address-list entries with optional filters. |
| `get_ipv6_address_list_entry` | 🟢 read | `entry_id`* | Gets detailed information about a specific IPv6 address-list entry by its internal id. |
| `remove_ipv6_address_list_entry` | 🔴 destructive | `entry_id`* | Removes an IPv6 address-list entry by its internal id. |
| `enable_ipv6_address_list_entry` | 🟡 write·idem | `entry_id`* | Enables an IPv6 address-list entry by its internal id. |
| `disable_ipv6_address_list_entry` | 🟡 write·idem | `entry_id`* | Disables an IPv6 address-list entry by its internal id. |

## IPv6 ND

<a id="ipv6-nd"></a>Neighbor Discovery / Router Advertisement config and advertised prefixes (`/ipv6 nd`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_ipv6_nd` | 🟡 write | `interface`*, `ra_interval`, `ra_delay`, `ra_lifetime`, `ra_preference`, `hop_limit`, `mtu`, `reachable_time`, `retransmit_interval`, `managed_address_configuration`, `other_configuration`, `advertise_dns`, `advertise_mac_address`, `comment`, `disabled`* | Adds a per-interface IPv6 Neighbor Discovery / Router Advertisement configuration on the MikroTik device. |
| `list_ipv6_nd` | 🟢 read | `interface_filter`, `disabled_only`* | Lists IPv6 Neighbor Discovery interface configurations on the MikroTik device. |
| `get_ipv6_nd` | 🟢 read | `nd_id`* | Gets detailed IPv6 ND configuration for an interface (or '.id'). |
| `update_ipv6_nd` | 🟡 write·idem | `nd_id`*, `ra_interval`, `ra_delay`, `ra_lifetime`, `ra_preference`, `hop_limit`, `mtu`, `reachable_time`, `retransmit_interval`, `managed_address_configuration`, `other_configuration`, `advertise_dns`, `advertise_mac_address`, `comment`, `disabled` | Updates an existing IPv6 ND interface configuration (by interface name or '.id'). Also use this to configure the built-in 'all' entry. |
| `remove_ipv6_nd` | 🔴 destructive | `nd_id`* | Removes a per-interface IPv6 ND configuration (the built-in 'all' entry cannot be removed). |
| `add_ipv6_nd_prefix` | 🟡 write | `prefix`*, `interface`, `valid_lifetime`, `preferred_lifetime`, `autonomous`, `comment`, `disabled`* | Adds an advertised IPv6 ND prefix on the MikroTik device. |
| `list_ipv6_nd_prefixes` | 🟢 read | `interface_filter`, `prefix_filter`, `dynamic_only`* | Lists advertised IPv6 ND prefixes on the MikroTik device. |
| `remove_ipv6_nd_prefix` | 🔴 destructive | `prefix_id`* | Removes an advertised IPv6 ND prefix by ID or prefix value from the MikroTik device. |

## IPv6 Neighbors

<a id="ipv6-neighbor"></a>IPv6 neighbor cache (ND-discovered addresses), read + flush (`/ipv6 neighbor`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_ipv6_neighbors` | 🟢 read | `interface_filter`, `address_filter`, `mac_filter`, `status_filter`, `router_only`* | Lists IPv6 neighbor cache entries (discovered via Neighbor Discovery) on the MikroTik device. |
| `get_ipv6_neighbor` | 🟢 read | `neighbor_id`* | Gets detailed information about a specific IPv6 neighbor by ID or address. |
| `remove_ipv6_neighbor` | 🔴 destructive | `neighbor_id`* | Flushes an IPv6 neighbor cache entry by ID or address. The entry may be re-learned automatically via Neighbor Discovery. |

## IPv6 Pool

<a id="ipv6-pool"></a>IPv6 address/prefix pools for delegation and addressing (`/ipv6 pool`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_ipv6_pool` | 🟡 write | `name`*, `prefix`*, `prefix_length`*, `comment` | Creates an IPv6 pool on the MikroTik device. |
| `list_ipv6_pools` | 🟢 read | `name_filter`, `prefix_filter` | Lists IPv6 pools on the MikroTik device. |
| `get_ipv6_pool` | 🟢 read | `name`* | Gets detailed information about a specific IPv6 pool. |
| `list_ipv6_pool_used` | 🟢 read | `pool_filter` | Lists the currently delegated prefixes taken from IPv6 pools (`/ipv6 pool used`). |
| `update_ipv6_pool` | 🟡 write·idem | `name`*, `new_name`, `prefix`, `prefix_length`, `comment` | Updates an existing IPv6 pool on the MikroTik device. Pass comment="" to clear the comment. |
| `remove_ipv6_pool` | 🔴 destructive | `name`* | Removes an IPv6 pool from the MikroTik device. |

## IPv6 Routes

<a id="ipv6-route"></a>Static IPv6 routes, incl. default and blackhole/unreachable (`/ipv6 route`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_ipv6_route` | 🟡 write | `dst_address`*, `gateway`, `type`, `distance`, `scope`, `target_scope`, `routing_table`, `pref_src`, `check_gateway`, `vrf_interface`, `comment`, `disabled`* | Adds a static IPv6 route on the MikroTik device. |
| `add_ipv6_default_route` | 🟡 write | `gateway`*, `distance`, `check_gateway`, `routing_table`, `comment`, `disabled`* | Adds a default IPv6 route (::/0) via the given gateway on the MikroTik device. |
| `list_ipv6_routes` | 🟢 read | `dst_filter`, `gateway_filter`, `routing_table_filter`, `active_only`*, `disabled_only`*, `dynamic_only`* | Lists IPv6 routes on the MikroTik device. |
| `get_ipv6_route` | 🟢 read | `route_id`* | Gets detailed information about a specific IPv6 route by ID or destination. |
| `remove_ipv6_route` | 🔴 destructive | `route_id`* | Removes a static IPv6 route by ID from the MikroTik device. Use the .id from list output (e.g. '*5') to avoid ambiguity when multiple routes share a destination. |
| `enable_ipv6_route` | 🟡 write·idem | `route_id`* | Enables an IPv6 route by .id. |
| `disable_ipv6_route` | 🟡 write·idem | `route_id`* | Disables an IPv6 route by .id. |

## IPv6 Settings

<a id="ipv6-settings"></a>Global IPv6 settings: forwarding, RA/redirect acceptance, neighbor table (`/ipv6 settings`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_ipv6_settings` | 🟢 read | _none_ | Gets the global IPv6 settings of the MikroTik device (`/ipv6 settings`). |
| `update_ipv6_settings` | 🟡 write·idem | `disable_ipv6`, `forward`, `accept_redirects`, `accept_router_advertisements`, `max_neighbor_entries` | Updates the global IPv6 settings of the MikroTik device. |

## Router ID

<a id="routing-id"></a>Router-ID instances for OSPF/BGP (`/routing id`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_routing_ids` | 🟢 read | `name_filter` | Lists Router-ID instances (`/routing id`). Each instance assigns a stable 32-bit router identifier to a routing process (OSPF/BGP) and can auto-select the ID from a chosen interface or loopback. |
| `get_routing_id` | 🟢 read | `name`* | Gets detailed information about a specific Router-ID instance by name. |
| `add_routing_id` | 🟡 write | `name`*, `id`, `select_dynamic_id`, `comment`, `disabled`* | Adds a Router-ID instance. Either pin a fixed `id` (an IPv4 address) or let RouterOS pick one dynamically from an interface/loopback via `select_dynamic_id`. |
| `update_routing_id` | 🟡 write·idem | `name`*, `id`, `select_dynamic_id`, `comment`, `disabled` | Updates a Router-ID instance. Pass "" to `id` or `select_dynamic_id` to clear that property. |
| `remove_routing_id` | 🔴 destructive | `name`* | Removes a Router-ID instance by name. |
| `set_routing_id_enabled` | 🟡 write·idem | `name`*, `enabled`* | Enables or disables a Router-ID instance by name. |

## Routing Settings

<a id="routing-settings"></a>Global routing settings: ECMP hash policy, VRF-as-interface (`/routing settings`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_routing_settings` | 🟢 read | _none_ | Shows global routing settings (`/routing settings`): ECMP/multipath hash policy for IPv4 and IPv6 and whether VRFs are treated as interfaces. |
| `update_routing_settings` | 🟡 write·idem | `ipv4_multipath_hash_policy`, `ipv6_multipath_hash_policy`, `ipv4_vrf_as_interface` | Updates global routing settings. `*_multipath_hash_policy` controls how ECMP next-hops are chosen (l3 = src/dst IP, l3-inner = inner header for tunnels, l4 = include L4 ports). `ipv4_vrf_as_interface` exposes VRFs as interfaces to the rest of the config. |

## Routing Tables

<a id="routing-table"></a>Named routing tables / FIBs (`/routing table`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_routing_tables` | 🟢 read | `name_filter` | Lists routing tables (`/routing table`). Each named table is a separate RIB; set `fib` on a table to also install its routes into the forwarding plane (FIB). The built-in `main` table is always present. |
| `get_routing_table_def` | 🟢 read | `name`* | Gets detailed information about a specific routing table definition by name. |
| `add_routing_table` | 🟡 write | `name`*, `fib`*, `comment`, `disabled`* | Adds a named routing table. Enable `fib` to install the table's routes into the forwarding plane (otherwise the table is RIB-only and used purely for lookups by routing rules/marks). |
| `update_routing_table` | 🟡 write·idem | `name`*, `fib`, `comment`, `disabled` | Updates a routing table's fib flag, comment, or disabled state. |
| `remove_routing_table` | 🔴 destructive | `name`* | Removes a routing table by name. The built-in `main` table cannot be removed. |
| `set_routing_table_enabled` | 🟡 write·idem | `name`*, `enabled`* | Enables or disables a routing table by name. |

## Routing Rules

<a id="routing-rule"></a>Policy routing rules selecting a table by src/dst/interface/mark (`/routing rule`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_routing_rules` | 🟢 read | `table_filter`, `disabled_only`* | Lists policy routing rules (`/routing rule`). Rules are evaluated top-down and pick which routing table a packet is looked up in based on source/destination, interface or routing-mark. |
| `get_routing_rule` | 🟢 read | `rule_id`* | Gets detailed information about a specific routing rule by its internal id. |
| `add_routing_rule` | 🟡 write | `action`*, `table`, `src_address`, `dst_address`, `routing_mark`, `interface`, `min_prefix`, `max_prefix`, `comment`, `disabled`*, `place_before` | Adds a policy routing rule. Match on source/destination prefix, incoming interface and/or routing-mark; `action=lookup` resolves in `table` (and continues to lower-priority tables if no match), `lookup-only-in-table` stops at that table, `drop`/`unreachable` discard the packet. |
| `update_routing_rule` | 🟡 write·idem | `rule_id`*, `action`, `table`, `src_address`, `dst_address`, `routing_mark`, `interface`, `comment`, `disabled` | Updates a routing rule by id. Pass "" to src_address, dst_address, routing_mark, interface or table to clear. |
| `remove_routing_rule` | 🔴 destructive | `rule_id`* | Removes a routing rule by id. |
| `set_routing_rule_enabled` | 🟡 write·idem | `rule_id`*, `enabled`* | Enables or disables a routing rule by id. |

## Next-hops

<a id="routing-nexthop"></a>Resolved recursive next-hop table, read-only diagnostics (`/routing nexthop`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_routing_nexthops` | 🟢 read | `gateway_filter`, `active_only`* | Lists resolved routing next-hops (`/routing nexthop`). This is the recursive next-hop resolution table: it shows how each gateway resolves to a concrete interface + immediate gateway, which routes reference it, and whether it is currently active. Read-only and diagnostic — useful for debugging recursive/BGP next-hops. |
| `get_routing_nexthop_stats` | 🟢 read | _none_ | Summarises the routing next-hop table: total vs active next-hop count. |

## Routing Filters

<a id="routing-filter"></a>Route filter rules, select-rules and num-lists (`/routing filter`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_routing_filter_rules` | 🟢 read | `chain_filter` | Lists routing filter rules (`/routing filter rule`). Rules belong to a named chain and are written as a script-like expression, e.g. `if (dst in 10.0.0.0/8) { set distance 30; accept }`. Chains are referenced by BGP/OSPF as input/output filters and by `select-rule` matchers. |
| `add_routing_filter_rule` | 🟡 write | `chain`*, `rule`*, `comment`, `disabled`*, `place_before` | Adds a routing filter rule to a chain. `rule` is the full match/action expression; create the chain implicitly by naming it here, then reference it from a BGP/OSPF input/output filter. |
| `update_routing_filter_rule` | 🟡 write·idem | `rule_id`*, `chain`, `rule`, `comment`, `disabled` | Updates a routing filter rule's chain, expression, comment, or disabled state by id. |
| `remove_routing_filter_rule` | 🔴 destructive | `rule_id`* | Removes a routing filter rule by id. |
| `set_routing_filter_rule_enabled` | 🟡 write·idem | `rule_id`*, `enabled`* | Enables or disables a routing filter rule by id. |
| `list_routing_filter_select_rules` | 🟢 read | _none_ | Lists routing filter select-rules (`/routing filter select-rule`). Select-rules choose which filter `chain` to jump into based on prefix/length conditions — the structured front-end to the script chains. |
| `list_routing_filter_num_lists` | 🟢 read | `list_filter` | Lists routing filter num-lists (`/routing filter num-list`). A num-list is a named set of numeric ranges (AS numbers, communities, prefix lengths) that filter rules can match against by name. |
| `add_routing_filter_num_list` | 🟡 write | `list`*, `range`*, `comment` | Adds a numeric range entry to a named num-list. |
| `remove_routing_filter_num_list` | 🔴 destructive | `entry_id`* | Removes a num-list entry by id. |

## BFD

<a id="routing-bfd"></a>Bidirectional Forwarding Detection config + sessions (`/routing bfd`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_bfd_configurations` | 🟢 read | _none_ | Lists BFD configuration entries (`/routing bfd configuration`). BFD gives sub-second failure detection for a link/neighbor so routing protocols (OSPF/BGP) can tear down a session far faster than their own hold timers. Each entry binds timers to a set of interfaces in a VRF. |
| `add_bfd_configuration` | 🟡 write | `interfaces`*, `vrf`, `min_rx`, `min_tx`, `multiplier`, `comment`, `disabled`* | Adds a BFD configuration. `interfaces` selects where BFD runs (an interface or interface-list); `min_rx`/`min_tx` are the desired minimum receive/transmit intervals and `multiplier` is how many missed packets declare the session down (detection time ≈ interval × multiplier). |
| `update_bfd_configuration` | 🟡 write·idem | `config_id`*, `interfaces`, `vrf`, `min_rx`, `min_tx`, `multiplier`, `comment`, `disabled` | Updates a BFD configuration entry by id. |
| `remove_bfd_configuration` | 🔴 destructive | `config_id`* | Removes a BFD configuration entry by id. |
| `set_bfd_configuration_enabled` | 🟡 write·idem | `config_id`*, `enabled`* | Enables or disables a BFD configuration entry by id. |
| `list_bfd_sessions` | 🟢 read | `up_only`* | Lists live BFD sessions (`/routing bfd session`): each neighbor's state (up/down), local/remote discriminators and negotiated timers. Read-only — use it to confirm BFD is actually up before relying on it for fast failover. |

## BGP

<a id="routing-bgp"></a>BGP connections, templates, sessions and advertisements (`/routing bgp`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_bgp_connections` | 🟢 read | `name_filter` | Lists BGP connections (`/routing bgp connection`). In RouterOS v7 a 'connection' is one configured peer (or listener) that pulls common settings from optional templates. Shows local/remote AS, addresses and role. |
| `get_bgp_connection` | 🟢 read | `name`* | Gets detailed configuration for a specific BGP connection by name. |
| `add_bgp_connection` | 🟡 write | `name`*, `remote_address`*, `remote_as`, `as`, `local_role`, `local_address`, `router_id`, `templates`, `address_families`, `hold_time`, `keepalive_time`, `multihop`, `nexthop_choice`, `input_filter`, `output_filter`, `routing_table`, `vrf`, `comment`, `disabled`* | Adds a BGP connection (peer). At minimum give `name`, the peer `remote_address`/`remote_as`, the local `as` and a `local_role` (ebgp or ibgp). Input/output route filters reference `/routing filter` chains. Common settings can be factored into a template referenced via `templates`. |
| `update_bgp_connection` | 🟡 write·idem | `name`*, `remote_address`, `remote_as`, `as`, `local_role`, `local_address`, `router_id`, `address_families`, `hold_time`, `keepalive_time`, `multihop`, `input_filter`, `output_filter`, `routing_table`, `comment`, `disabled` | Updates settings of an existing BGP connection by name. |
| `remove_bgp_connection` | 🔴 destructive | `name`* | Removes a BGP connection by name (tears down the peering). |
| `set_bgp_connection_enabled` | 🟡 write·idem | `name`*, `enabled`* | Enables or disables a BGP connection by name. |
| `list_bgp_templates` | 🟢 read | _none_ | Lists BGP templates (`/routing bgp template`). Templates hold shared settings (AS, address-families, filters, timers) that connections inherit via their `templates` property. |
| `add_bgp_template` | 🟡 write | `name`*, `as`, `router_id`, `address_families`, `input_filter`, `output_filter`, `routing_table`, `comment`, `disabled`* | Adds a BGP template carrying shared peer settings. |
| `remove_bgp_template` | 🔴 destructive | `name`* | Removes a BGP template by name. |
| `list_bgp_sessions` | 🟢 read | `established_only`* | Lists active BGP sessions (`/routing bgp session`): negotiated state (established/idle/…), remote AS, uptime and prefix counts. Read-only — the authoritative view of which peerings are actually up. |
| `list_bgp_advertisements` | 🟢 read | `peer_filter` | Lists prefixes advertised to BGP peers (`/routing bgp advertisements`). Read-only — useful to confirm exactly what this router is sending to a given peer after output filters are applied. |

## OSPF

<a id="routing-ospf"></a>OSPF instances, areas, ranges, interface-templates, neighbors and LSAs (`/routing ospf`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_ospf_instances` | 🟢 read | _none_ | Lists OSPF instances (`/routing ospf instance`). An instance is one OSPF process: it fixes the protocol version (2 for IPv4, 3 for IPv6), router-id, redistribution and import/export filter chains. |
| `add_ospf_instance` | 🟡 write | `name`*, `version`*, `router_id`, `vrf`, `redistribute`, `in_filter_chain`, `out_filter_chain`, `originate_default`, `comment`, `disabled`* | Adds an OSPF instance. `version` 2 = OSPFv2 (IPv4), 3 = OSPFv3 (IPv6). `router_id` may be an IPv4 address, 'main', or the name of a `/routing id`. `redistribute` is a comma list (connected,static,rip,bgp,…). |
| `update_ospf_instance` | 🟡 write·idem | `name`*, `router_id`, `redistribute`, `in_filter_chain`, `out_filter_chain`, `originate_default`, `comment`, `disabled` | Updates an OSPF instance by name. |
| `remove_ospf_instance` | 🔴 destructive | `name`* | Removes an OSPF instance by name. |
| `list_ospf_areas` | 🟢 read | _none_ | Lists OSPF areas (`/routing ospf area`). An area groups links inside an instance; `type` controls LSA flooding (default/backbone, stub, nssa). |
| `add_ospf_area` | 🟡 write | `name`*, `area_id`*, `instance`*, `type`, `no_summaries`, `comment`, `disabled`* | Adds an OSPF area to an instance. The backbone is area-id 0.0.0.0. |
| `remove_ospf_area` | 🔴 destructive | `name`* | Removes an OSPF area by name. |
| `list_ospf_area_ranges` | 🟢 read | _none_ | Lists OSPF area ranges (`/routing ospf area range`): aggregate prefixes advertised at an area boundary to summarise intra-area routes. |
| `add_ospf_area_range` | 🟡 write | `area`*, `prefix`*, `advertise`*, `cost`, `comment` | Adds a summarisation range to an OSPF area. |
| `remove_ospf_area_range` | 🔴 destructive | `range_id`* | Removes an OSPF area range by id. |
| `list_ospf_interface_templates` | 🟢 read | _none_ | Lists OSPF interface templates (`/routing ospf interface-template`). A template binds interfaces/networks to an area and sets per-link parameters (cost, type, timers, authentication, passive). |
| `add_ospf_interface_template` | 🟡 write | `area`*, `interfaces`, `networks`, `cost`, `priority`, `type`, `passive`, `hello_interval`, `dead_interval`, `auth`, `auth_id`, `auth_key`, `comment`, `disabled`* | Adds an OSPF interface template. Match links via `interfaces` and/or `networks`; `type` sets the link model (broadcast/ptp/nbma/ptmp), `passive` advertises the subnet without forming adjacencies, and the `auth_*` fields enable per-interface authentication. |
| `remove_ospf_interface_template` | 🔴 destructive | `template_id`* | Removes an OSPF interface template by id. |
| `list_ospf_neighbors` | 🟢 read | _none_ | Lists OSPF neighbors (`/routing ospf neighbor`): adjacency state (Full/2-Way/…), neighbor router-id and address. Read-only — the key health check for OSPF adjacencies. |
| `list_ospf_lsa` | 🟢 read | `area_filter` | Lists the OSPF link-state database (`/routing ospf lsa`): every LSA the router holds, by type, area and originator. Read-only — used to inspect topology and diagnose flooding/summarisation problems. |

## RIP

<a id="routing-rip"></a>RIP instances, interface-templates, static + dynamic neighbors (`/routing rip`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_rip_instances` | 🟢 read | _none_ | Lists RIP instances (`/routing rip instance`). An instance is one RIP process with its own router-id, redistribution and import/export filter chains. |
| `add_rip_instance` | 🟡 write | `name`*, `router_id`, `vrf`, `redistribute`, `in_filter_chain`, `out_filter_chain`, `originate_default`, `comment`, `disabled`* | Adds a RIP instance. `redistribute` is a comma list (connected,static,ospf,bgp,…); filter chains reference `/routing filter`. |
| `update_rip_instance` | 🟡 write·idem | `name`*, `router_id`, `redistribute`, `in_filter_chain`, `out_filter_chain`, `originate_default`, `comment`, `disabled` | Updates a RIP instance by name. |
| `remove_rip_instance` | 🔴 destructive | `name`* | Removes a RIP instance by name. |
| `list_rip_interface_templates` | 🟢 read | _none_ | Lists RIP interface templates (`/routing rip interface-template`): which interfaces participate in an instance and their per-link options (passive, authentication, key-chain). |
| `add_rip_interface_template` | 🟡 write | `instance`*, `interfaces`*, `passive`, `key_chain`, `comment`, `disabled`* | Adds a RIP interface template binding interfaces to an instance. `passive` advertises without sending updates; `key_chain` enables authentication. |
| `remove_rip_interface_template` | 🔴 destructive | `template_id`* | Removes a RIP interface template by id. |
| `list_rip_static_neighbors` | 🟢 read | _none_ | Lists statically-configured RIP neighbors (`/routing rip static-neighbor`) — used to unicast RIP updates to peers across non-broadcast links. |
| `add_rip_static_neighbor` | 🟡 write | `address`*, `instance`, `comment`, `disabled`* | Adds a static RIP neighbor to unicast updates to. |
| `remove_rip_static_neighbor` | 🔴 destructive | `neighbor_id`* | Removes a RIP static neighbor by id. |
| `list_rip_neighbors` | 🟢 read | _none_ | Lists discovered RIP neighbors (`/routing rip neighbor`): peers this router is exchanging routes with, with last-update timing. Read-only. |

## PIM-SM

<a id="routing-pimsm"></a>PIM Sparse-Mode instances, interface-templates, RPs and neighbors (`/routing pimsm`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_pimsm_instances` | 🟢 read | _none_ | Lists PIM Sparse-Mode instances (`/routing pimsm instance`). PIM-SM builds multicast distribution trees rooted at a Rendezvous Point (RP). An instance fixes the address family and VRF the protocol runs in. |
| `add_pimsm_instance` | 🟡 write | `name`*, `afi`*, `vrf`, `rp_set`, `comment`, `disabled`* | Adds a PIM Sparse-Mode instance. |
| `remove_pimsm_instance` | 🔴 destructive | `name`* | Removes a PIM-SM instance by name. |
| `list_pimsm_interface_templates` | 🟢 read | _none_ | Lists PIM-SM interface templates (`/routing pimsm interface-template`): which interfaces run PIM and their hello/priority settings (DR election). |
| `add_pimsm_interface_template` | 🟡 write | `instance`*, `interfaces`*, `priority`, `hello_period`, `comment`, `disabled`* | Adds a PIM-SM interface template binding interfaces to an instance. |
| `remove_pimsm_interface_template` | 🔴 destructive | `template_id`* | Removes a PIM-SM interface template by id. |
| `list_pimsm_rps` | 🟢 read | _none_ | Lists PIM-SM Rendezvous Points (`/routing pimsm rp`): the RP addresses and the multicast group ranges each serves as the root of the shared tree. |
| `add_pimsm_rp` | 🟡 write | `instance`*, `address`*, `group`, `comment`, `disabled`* | Adds a static Rendezvous Point for a multicast group range. |
| `remove_pimsm_rp` | 🔴 destructive | `rp_id`* | Removes a PIM-SM Rendezvous Point by id. |
| `list_pimsm_neighbors` | 🟢 read | _none_ | Lists PIM-SM neighbors (`/routing pimsm neighbor`): adjacent PIM routers discovered via Hello messages, with their DR priority and timers. Read-only. |

## IGMP Proxy

<a id="routing-igmp-proxy"></a>IGMP proxy settings, interfaces and forwarding cache (`/routing igmp-proxy`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_igmp_proxy_settings` | 🟢 read | _none_ | Shows global IGMP-proxy settings (`/routing igmp-proxy`). IGMP proxy forwards multicast between a single upstream and one or more downstream interfaces without a full multicast routing protocol — ideal for IPTV. |
| `update_igmp_proxy_settings` | 🟡 write·idem | `quick_leave`, `query_interval`, `query_response_interval` | Updates global IGMP-proxy settings. `quick_leave` prunes a group immediately on leave (good for IPTV channel zapping); query intervals tune membership refresh behaviour. |
| `list_igmp_proxy_interfaces` | 🟢 read | _none_ | Lists IGMP-proxy interfaces (`/routing igmp-proxy interface`). Exactly one interface should be `upstream` (toward the multicast source); the rest are downstream toward receivers. |
| `add_igmp_proxy_interface` | 🟡 write | `interface`*, `upstream`*, `alternative_subnets`, `threshold`, `comment`, `disabled`* | Adds an interface to the IGMP proxy. Set `upstream=true` for the interface facing the multicast source; `alternative_subnets` whitelists extra source subnets reachable through this interface. |
| `update_igmp_proxy_interface` | 🟡 write·idem | `interface`*, `upstream`, `alternative_subnets`, `threshold`, `comment`, `disabled` | Updates an IGMP-proxy interface by its interface name. |
| `remove_igmp_proxy_interface` | 🔴 destructive | `interface`* | Removes an IGMP-proxy interface by its interface name. |
| `set_igmp_proxy_interface_enabled` | 🟡 write·idem | `interface`*, `enabled`* | Enables or disables an IGMP-proxy interface by name. |
| `list_igmp_proxy_mfc` | 🟢 read | _none_ | Lists the IGMP-proxy multicast forwarding cache (`/routing igmp-proxy mfc`): active (source, group) entries and which downstream interfaces each is being forwarded to. Read-only — the live multicast forwarding state. |

## GMP

<a id="routing-gmp"></a>Group Management Protocol (IGMP/MLD) interfaces and memberships (`/routing gmp`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_gmp_interfaces` | 🟢 read | _none_ | Lists GMP interfaces (`/routing gmp interface`). GMP is RouterOS's shared Group Management Protocol layer (IGMP for IPv4, MLD for IPv6) used by PIM-SM and IGMP-proxy to learn receiver group memberships. Read-only — shows the querier role, version and timers per interface. |
| `list_gmp_group_memberships` | 🟢 read | `interface_filter`, `group_filter` | Lists GMP group memberships (`/routing gmp group`): the multicast groups currently joined per interface, as learned from IGMP/MLD reports. Read-only — the source of truth for which downstream segments want which groups. |

## RPKI

<a id="routing-rpki"></a>RPKI validator sessions for BGP origin validation (`/routing rpki`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_rpki_sessions` | 🟢 read | `group_filter` | Lists RPKI sessions (`/routing rpki`). Each session is an RTR connection to a validator cache that streams Validated ROA Payloads (VRPs); BGP filters reference the session `group` to mark routes valid/invalid/unknown for Route Origin Validation. Shows connection status and VRP counts. |
| `add_rpki_session` | 🟡 write | `group`*, `address`*, `port`*, `refresh_interval`, `expire_interval`, `retry_interval`, `vrf`, `comment`, `disabled`* | Adds an RPKI session to a validator cache. `group` is the name BGP filters match against; `address`/`port` point at the RTR cache (port 8282 is the common rpki-rtr default). Tune refresh/retry/expire intervals to control how often VRPs are pulled and when stale data is dropped. |
| `update_rpki_session` | 🟡 write·idem | `session_id`*, `address`, `port`, `refresh_interval`, `expire_interval`, `retry_interval`, `comment`, `disabled` | Updates an RPKI session by id. |
| `remove_rpki_session` | 🔴 destructive | `session_id`* | Removes an RPKI session by id (BGP routes using its group fall back to 'unknown'). |
| `set_rpki_session_enabled` | 🟡 write·idem | `session_id`*, `enabled`* | Enables or disables an RPKI session by id. |

## Firewall — Filter

<a id="firewall-filter"></a>Filter rules and a guided basic setup (`/ip firewall filter`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_filter_rule` | 🟡 write | `chain`*, `action`*, `src_address`, `dst_address`, `src_port`, `dst_port`, `protocol`, `in_interface`, `out_interface`, `connection_state`, `connection_nat_state`, `src_address_list`, `dst_address_list`, `limit`, `tcp_flags`, `comment`, `disabled`*, `log`*, `log_prefix`, `place_before` | Creates a firewall filter rule in the specified chain on the MikroTik device. connection_state: comma-separated e.g. "established,related,new,invalid". limit: RouterOS rate/burst string e.g. "10,5:packet" or "10/1s:packet". tcp_flags: RouterOS flag expression e.g. "syn,!ack". place_before: rule number or ID (*N) to insert before e.g. "0" or "*3". |
| `list_filter_rules` | 🟢 read | `chain_filter`, `action_filter`, `src_address_filter`, `dst_address_filter`, `protocol_filter`, `interface_filter`, `disabled_only`*, `invalid_only`*, `dynamic_only`* | Lists firewall filter rules on the MikroTik device. |
| `get_filter_rule` | 🟢 read | `rule_id`* | Gets detailed information about a specific firewall filter rule. rule_id: use the ID from list output e.g. "*1" or "0". |
| `update_filter_rule` | 🟡 write·idem | `rule_id`*, `chain`, `action`, `src_address`, `dst_address`, `src_port`, `dst_port`, `protocol`, `in_interface`, `out_interface`, `connection_state`, `connection_nat_state`, `src_address_list`, `dst_address_list`, `limit`, `tcp_flags`, `comment`, `disabled`, `log`, `log_prefix` | Updates an existing firewall filter rule on the MikroTik device. rule_id: use the ID from list output e.g. "*1" or "0". connection_state: comma-separated e.g. "established,related". limit: RouterOS rate string e.g. "10,5:packet". tcp_flags: RouterOS flag expression e.g. "syn,!ack". Pass "" to clear an optional field (e.g. src_address=""). |
| `remove_filter_rule` | 🔴 destructive | `rule_id`* | Removes a firewall filter rule from the MikroTik device. rule_id: use the ID from list output e.g. "*1" or "0". |
| `move_filter_rule` | 🟡 write·idem | `rule_id`*, `destination`* | Moves a firewall filter rule to a different position in the chain. rule_id: use the ID from list output e.g. "*1" or "0". destination: 0-based target position index. |
| `enable_filter_rule` | 🟡 write·idem | `rule_id`* | Enables a firewall filter rule. |
| `disable_filter_rule` | 🟡 write·idem | `rule_id`* | Disables a firewall filter rule. |
| `create_basic_firewall_setup` | ⛔ dangerous | _none_ | Creates a basic firewall setup with common security rules on the MikroTik device. |

## Firewall — NAT

<a id="firewall-nat"></a>NAT rules: src/dst-nat, masquerade, redirect (`/ip firewall nat`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_nat_rule` | 🟡 write | `chain`*, `action`*, `src_address`, `dst_address`, `src_port`, `dst_port`, `protocol`, `in_interface`, `out_interface`, `to_addresses`, `to_ports`, `comment`, `disabled`*, `log`*, `log_prefix`, `place_before` | Creates a NAT rule (srcnat or dstnat) on the MikroTik device. to_addresses: single IP or range e.g. "10.0.0.1" or "10.0.0.1-10.0.0.10". to_ports: single port or range e.g. "8080" or "8080-8090". place_before: rule number or ID (*N) to insert before e.g. "0" or "*3". |
| `list_nat_rules` | 🟢 read | `chain_filter`, `action_filter`, `src_address_filter`, `dst_address_filter`, `protocol_filter`, `interface_filter`, `disabled_only`*, `invalid_only`* | Lists NAT rules on the MikroTik device. |
| `get_nat_rule` | 🟢 read | `rule_id`* | Gets detailed information about a specific NAT rule. rule_id: use the ID from list output e.g. "*1" or "0". |
| `update_nat_rule` | 🟡 write·idem | `rule_id`*, `chain`, `action`, `src_address`, `dst_address`, `src_port`, `dst_port`, `protocol`, `in_interface`, `out_interface`, `to_addresses`, `to_ports`, `comment`, `disabled`, `log`, `log_prefix` | Updates an existing NAT rule on the MikroTik device. rule_id: use the ID from list output e.g. "*1" or "0". to_addresses: single IP or range e.g. "10.0.0.1" or "10.0.0.1-10.0.0.10". to_ports: single port or range e.g. "8080" or "8080-8090". Pass "" to clear an optional field. |
| `remove_nat_rule` | 🔴 destructive | `rule_id`* | Removes a NAT rule from the MikroTik device. rule_id: use the ID from list output e.g. "*1" or "0". |
| `move_nat_rule` | 🟡 write·idem | `rule_id`*, `destination`* | Moves a NAT rule to a different position in the chain. rule_id: use the ID from list output e.g. "*1" or "0". destination: 0-based target position index. |
| `enable_nat_rule` | 🟡 write·idem | `rule_id`* | Enables a NAT rule. |
| `disable_nat_rule` | 🟡 write·idem | `rule_id`* | Disables a NAT rule. |

## Address Lists

<a id="address-list"></a>Firewall address-lists (`/ip firewall address-list`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_address_list_entry` | 🟡 write | `list`*, `address`*, `timeout`, `comment`, `disabled`* | Adds an address to a firewall address-list. |
| `list_address_lists` | 🟢 read | `list_filter`, `address_filter`, `dynamic_only`* | Lists firewall address-list entries with optional filters. |
| `get_address_list_entry` | 🟢 read | `entry_id`* | Gets detailed information about a specific address-list entry by its internal id. |
| `remove_address_list_entry` | 🔴 destructive | `entry_id`* | Removes an address-list entry by its internal id. |
| `enable_address_list_entry` | 🟡 write·idem | `entry_id`* | Enables an address-list entry by its internal id. |
| `disable_address_list_entry` | 🟡 write·idem | `entry_id`* | Disables an address-list entry by its internal id. |

## Certificates

<a id="certificate"></a>X.509 certificate management (`/certificate`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_certificates` | 🟢 read | `name_filter` | Lists certificates in the MikroTik device's certificate store. |
| `get_certificate` | 🟢 read | `name`* | Gets detailed information about a specific certificate. |
| `create_certificate` | 🟡 write | `name`*, `common_name`*, `key_size`*, `days_valid`*, `key_usage`, `country`, `organization` | Creates a certificate template on the MikroTik device. Use sign_certificate to self-sign it after creating. |
| `sign_certificate` | 🟡 write | `name`*, `ca`, `common_name` | Signs a certificate on the MikroTik device (self-sign or sign with a CA). This may be long-running. |
| `remove_certificate` | 🔴 destructive | `name`* | Removes a certificate from the MikroTik device's certificate store. |
| `import_certificate` | 🟡 write | `file_name`*, `passphrase`, `name` | Imports a certificate or key from a file in the MikroTik device's file system. |

## IP Services

<a id="ip-service"></a>Management service ports — ssh/www/api/telnet (`/ip service`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_ip_services` | 🟢 read | _none_ | Lists the management services (telnet, ftp, www, ssh, api, winbox, …) and their state. |
| `get_ip_service` | 🟢 read | `name`* | Gets detailed information about a specific management service. |
| `set_ip_service` | 🟡 write·idem | `name`*, `port`, `address`, `disabled`, `certificate` | Updates a management service's port, allowed source addresses, certificate, or enabled state. |
| `enable_ip_service` | 🟡 write·idem | `name`* | Enables a management service. |
| `disable_ip_service` | 🟡 write·idem | `name`* | Disables a management service (useful for hardening: telnet, ftp, www). |

## 802.1X — Server

<a id="dot1x-server"></a>802.1X authenticator: port-based access control via RADIUS (`/interface dot1x server`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_dot1x_server` | 🟡 write | `interface`*, `auth_types`, `accounting`, `interim_update`, `mac_auth_mode`, `guest_vlan_id`, `reject_vlan_id`, `server_fail_vlan_id`, `reauth_timeout`, `comment`, `disabled`* | Adds an 802.1X authenticator (server) on an interface, enforcing port-based network access control against a RADIUS server (`/interface dot1x server`). |
| `list_dot1x_servers` | 🟢 read | `interface_filter`, `disabled_only`* | Lists 802.1X authenticators on the MikroTik device. |
| `get_dot1x_server` | 🟢 read | `server_id`* | Gets a specific 802.1X authenticator by interface or '.id'. |
| `update_dot1x_server` | 🟡 write·idem | `server_id`*, `auth_types`, `accounting`, `interim_update`, `mac_auth_mode`, `guest_vlan_id`, `reject_vlan_id`, `server_fail_vlan_id`, `reauth_timeout`, `comment`, `disabled` | Updates an 802.1X authenticator (by interface or '.id'). Pass comment="" to clear the comment. |
| `remove_dot1x_server` | 🔴 destructive | `server_id`* | Removes an 802.1X authenticator by interface or '.id' from the MikroTik device. |

## 802.1X — Client

<a id="dot1x-client"></a>802.1X supplicant: authenticate the device to an upstream port (`/interface dot1x client`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_dot1x_client` | 🟡 write | `interface`*, `eap_methods`*, `identity`, `anonymous_identity`, `certificate`, `password`, `comment`, `disabled`* | Adds an 802.1X supplicant (client) on an interface so the device can authenticate itself to an upstream authenticator (`/interface dot1x client`). |
| `list_dot1x_clients` | 🟢 read | `interface_filter`, `status_filter`, `disabled_only`* | Lists 802.1X supplicants on the MikroTik device. |
| `get_dot1x_client` | 🟢 read | `client_id`* | Gets a specific 802.1X supplicant by interface or '.id'. |
| `update_dot1x_client` | 🟡 write·idem | `client_id`*, `eap_methods`, `identity`, `anonymous_identity`, `certificate`, `password`, `comment`, `disabled` | Updates an 802.1X supplicant (by interface or '.id'). Pass comment="" to clear the comment. |
| `remove_dot1x_client` | 🔴 destructive | `client_id`* | Removes an 802.1X supplicant by interface or '.id' from the MikroTik device. |

## WireGuard

<a id="wireguard"></a>WireGuard interfaces, peers and client-config generation.

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_wireguard_interface` | 🟡 write | `name`*, `listen_port`, `private_key`, `mtu`, `comment`, `disabled`* | Creates a WireGuard interface on the MikroTik device. |
| `list_wireguard_interfaces` | 🟢 read | `name_filter`, `disabled_only`*, `running_only`* | Lists WireGuard interfaces on the MikroTik device. |
| `get_wireguard_interface` | 🟢 read | `name`* | Gets detailed information about a specific WireGuard interface. |
| `update_wireguard_interface` | 🟡 write·idem | `name`*, `new_name`, `listen_port`, `private_key`, `mtu`, `comment`, `disabled` | Updates an existing WireGuard interface's settings on the MikroTik device. |
| `remove_wireguard_interface` | 🔴 destructive | `name`* | Removes a WireGuard interface from the MikroTik device. |
| `enable_wireguard_interface` | 🟡 write·idem | `name`* | Enables a WireGuard interface. |
| `disable_wireguard_interface` | 🟡 write·idem | `name`* | Disables a WireGuard interface. |
| `add_wireguard_peer` | 🟡 write | `interface`*, `public_key`*, `allowed_address`*, `endpoint_address`, `endpoint_port`, `preshared_key`, `persistent_keepalive`, `comment`, `disabled`* | Adds a WireGuard peer (with public key and allowed addresses) to an interface on the MikroTik device. |
| `list_wireguard_peers` | 🟢 read | `interface_filter`, `disabled_only`* | Lists WireGuard peers on the MikroTik device. |
| `get_wireguard_peer` | 🟢 read | `peer_id`* | Gets detailed information about a specific WireGuard peer by ID. |
| `update_wireguard_peer` | 🟡 write·idem | `peer_id`*, `allowed_address`, `endpoint_address`, `endpoint_port`, `preshared_key`, `persistent_keepalive`, `comment`, `disabled` | Updates an existing WireGuard peer's allowed addresses, endpoint, keepalive, or enabled state. |
| `remove_wireguard_peer` | 🔴 destructive | `peer_id`* | Removes a WireGuard peer from the MikroTik device. |
| `enable_wireguard_peer` | 🟡 write·idem | `peer_id`* | Enables a WireGuard peer. |
| `disable_wireguard_peer` | 🟡 write·idem | `peer_id`* | Disables a WireGuard peer. |
| `generate_wireguard_client_config` | 🟢 read | `client_private_key`*, `client_address`*, `server_public_key`*, `server_endpoint`*, `server_port`*, `allowed_ips`*, `dns`, `persistent_keepalive`* | Generates a wg0.conf client config string from the given keys and server endpoint. Does not communicate with the router. |

## IPsec

<a id="ipsec"></a>IPsec IKEv1/IKEv2: profiles, peers, identities, proposals, policies, SAs (`/ip ipsec`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_ipsec_profile` | 🟡 write | `name`*, `dh_group`*, `enc_algorithm`, `hash_algorithm`*, `lifetime`, `nat_traversal`, `dpd_interval`, `dpd_maximum_failures` | Creates an IPsec phase-1 profile (IKE proposal) on the MikroTik device. |
| `list_ipsec_profiles` | 🟢 read | `name_filter` | Lists IPsec phase-1 profiles on the MikroTik device. |
| `get_ipsec_profile` | 🟢 read | `name`* | Gets detailed information about a specific IPsec profile. |
| `update_ipsec_profile` | 🟡 write·idem | `name`*, `new_name`, `dh_group`, `enc_algorithm`, `hash_algorithm`, `lifetime`, `nat_traversal`, `dpd_interval`, `dpd_maximum_failures` | Updates an existing IPsec phase-1 profile's settings. |
| `remove_ipsec_profile` | 🔴 destructive | `name`* | Removes an IPsec profile from the MikroTik device. |
| `create_ipsec_peer` | 🟡 write | `name`*, `address`, `profile`, `exchange_mode`*, `local_address`, `passive`, `send_initial_contact`, `comment`, `disabled`* | Creates an IPsec peer (remote endpoint) on the MikroTik device. |
| `list_ipsec_peers` | 🟢 read | `name_filter` | Lists IPsec peers on the MikroTik device. |
| `get_ipsec_peer` | 🟢 read | `name`* | Gets detailed information about a specific IPsec peer. |
| `update_ipsec_peer` | 🟡 write·idem | `name`*, `new_name`, `address`, `profile`, `exchange_mode`, `local_address`, `passive`, `comment`, `disabled` | Updates an existing IPsec peer's settings. |
| `remove_ipsec_peer` | 🔴 destructive | `name`* | Removes an IPsec peer from the MikroTik device. |
| `create_ipsec_identity` | 🟡 write | `peer`*, `auth_method`*, `secret`, `my_id`, `remote_id`, `generate_policy`, `mode_config`, `policy_template_group`, `certificate`, `comment` | Creates an IPsec identity (authentication binding) for a peer. |
| `list_ipsec_identities` | 🟢 read | `peer_filter` | Lists IPsec identities on the MikroTik device. |
| `remove_ipsec_identity` | 🔴 destructive | `identity_id`* | Removes an IPsec identity by its internal ID (e.g. '*1'). |
| `create_ipsec_proposal` | 🟡 write | `name`*, `auth_algorithms`*, `enc_algorithms`*, `pfs_group`*, `lifetime` | Creates an IPsec phase-2 proposal (IPsec SA parameters). |
| `list_ipsec_proposals` | 🟢 read | `name_filter` | Lists IPsec phase-2 proposals on the MikroTik device. |
| `get_ipsec_proposal` | 🟢 read | `name`* | Gets detailed information about a specific IPsec proposal. |
| `update_ipsec_proposal` | 🟡 write·idem | `name`*, `new_name`, `auth_algorithms`, `enc_algorithms`, `pfs_group`, `lifetime` | Updates an existing IPsec phase-2 proposal's settings. |
| `remove_ipsec_proposal` | 🔴 destructive | `name`* | Removes an IPsec proposal from the MikroTik device. |
| `create_ipsec_policy` | 🟡 write | `peer`, `src_address`, `dst_address`, `protocol`, `action`*, `level`, `proposal`, `tunnel`*, `sa_src_address`, `sa_dst_address`, `template`, `comment` | Creates an IPsec policy defining which traffic is secured and how. |
| `list_ipsec_policies` | 🟢 read | _none_ | Lists IPsec policies on the MikroTik device. |
| `remove_ipsec_policy` | 🔴 destructive | `policy_id`* | Removes an IPsec policy by its internal ID (e.g. '*1'). |
| `get_ipsec_active_peers` | 🟢 read | _none_ | Shows currently established IPsec peers (active IKE sessions). |
| `get_ipsec_installed_sa` | 🟢 read | _none_ | Shows installed IPsec security associations (SAs). |
| `flush_ipsec_installed_sa` | 🔴 destructive | _none_ | Flushes all installed IPsec security associations, forcing tunnels to rekey. |
| `get_ipsec_statistics` | 🟢 read | _none_ | Shows IPsec subsystem statistics and counters. |

## PPP

<a id="ppp"></a>Shared PPP backend: profiles, secrets, active sessions (`/ppp`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_ppp_profile` | 🟡 write | `name`*, `local_address`, `remote_address`, `dns_server`, `rate_limit`, `use_encryption`, `change_tcp_mss`, `only_one`, `bridge`, `comment` | Creates a PPP profile on the MikroTik device. Profiles define address assignment, DNS, encryption, and rate limits shared by L2TP/PPTP/SSTP/OpenVPN sessions. |
| `list_ppp_profiles` | 🟢 read | `name_filter` | Lists PPP profiles on the MikroTik device. |
| `get_ppp_profile` | 🟢 read | `name`* | Gets detailed information about a specific PPP profile. |
| `update_ppp_profile` | 🟡 write·idem | `name`*, `new_name`, `local_address`, `remote_address`, `dns_server`, `rate_limit`, `use_encryption`, `change_tcp_mss`, `only_one`, `bridge`, `comment` | Updates an existing PPP profile's settings. |
| `remove_ppp_profile` | 🔴 destructive | `name`* | Removes a PPP profile from the MikroTik device. |
| `create_ppp_secret` | 🟡 write | `name`*, `password`*, `service`*, `profile`, `local_address`, `remote_address`, `caller_id`, `comment`, `disabled`* | Creates a PPP secret (VPN user account) on the MikroTik device. Used by L2TP/PPTP/SSTP/OpenVPN/PPPoE servers for client authentication. |
| `list_ppp_secrets` | 🟢 read | `name_filter`, `service_filter` | Lists PPP secrets (VPN user accounts) on the MikroTik device. Passwords are redacted. |
| `get_ppp_secret` | 🟢 read | `name`* | Gets detailed information about a specific PPP secret. The password is redacted. |
| `update_ppp_secret` | 🟡 write·idem | `name`*, `new_name`, `password`, `service`, `profile`, `local_address`, `remote_address`, `caller_id`, `comment`, `disabled` | Updates an existing PPP secret's settings. The password is redacted in output. |
| `remove_ppp_secret` | 🔴 destructive | `name`* | Removes a PPP secret (VPN user account) from the MikroTik device. |
| `get_ppp_active` | 🟢 read | `name_filter` | Lists currently active PPP sessions (connected VPN clients). |
| `disconnect_ppp_active` | 🔴 destructive | `name`* | Disconnects an active PPP session by username. |

## L2TP

<a id="l2tp"></a>L2TP server + clients, incl. L2TP/IPsec (`/interface l2tp-*`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_l2tp_server` | 🟢 read | _none_ | Gets the L2TP server configuration on the MikroTik device. |
| `set_l2tp_server` | 🟡 write·idem | `enabled`, `default_profile`, `authentication`, `use_ipsec`, `ipsec_secret`, `max_mtu`, `max_mru` | Configures the L2TP server. For L2TP/IPsec road-warrior setups, set use_ipsec='required' and supply ipsec_secret. |
| `create_l2tp_client` | 🟡 write | `name`*, `connect_to`*, `user`*, `password`*, `profile`*, `add_default_route`, `use_ipsec`, `ipsec_secret`, `comment`, `disabled`* | Creates an L2TP client interface that dials out to a remote L2TP server. |
| `list_l2tp_clients` | 🟢 read | `name_filter` | Lists L2TP client interfaces on the MikroTik device. |
| `get_l2tp_client` | 🟢 read | `name`* | Gets detailed information about a specific L2TP client. The password is redacted. |
| `remove_l2tp_client` | 🔴 destructive | `name`* | Removes an L2TP client interface from the MikroTik device. |
| `enable_l2tp_client` | 🟡 write·idem | `name`* | Enables an L2TP client interface. |
| `disable_l2tp_client` | 🟡 write·idem | `name`* | Disables an L2TP client interface. |

## PPTP

<a id="pptp"></a>PPTP server + clients (legacy) (`/interface pptp-*`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_pptp_server` | 🟢 read | _none_ | Gets the PPTP server configuration. NOTE: PPTP is legacy/weak — prefer L2TP/IPsec, SSTP, or WireGuard. |
| `set_pptp_server` | 🟡 write·idem | `enabled`, `default_profile`, `authentication`, `max_mtu`, `max_mru` | Configures the PPTP server. NOTE: PPTP is legacy/weak — prefer L2TP/IPsec, SSTP, or WireGuard for new deployments. |
| `create_pptp_client` | 🟡 write | `name`*, `connect_to`*, `user`*, `password`*, `profile`, `add_default_route`, `comment`, `disabled`* | Creates a PPTP client interface that dials out to a remote PPTP server. NOTE: PPTP is legacy/weak — prefer L2TP/IPsec, SSTP, or WireGuard. |
| `list_pptp_clients` | 🟢 read | `name_filter` | Lists PPTP client interfaces on the MikroTik device. |
| `get_pptp_client` | 🟢 read | `name`* | Gets detailed information about a specific PPTP client. The password is redacted. |
| `remove_pptp_client` | 🔴 destructive | `name`* | Removes a PPTP client interface from the MikroTik device. |

## SSTP

<a id="sstp"></a>SSTP (TLS) server + clients (`/interface sstp-*`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_sstp_server` | 🟢 read | _none_ | Gets the SSTP server (TLS) configuration on the MikroTik device. |
| `set_sstp_server` | 🟡 write·idem | `enabled`, `default_profile`, `authentication`, `certificate`, `port`, `tls_version`, `verify_client_certificate` | Configures the SSTP server (TLS-based VPN). Requires a TLS certificate. |
| `create_sstp_client` | 🟡 write | `name`*, `connect_to`*, `user`*, `password`*, `profile`, `certificate`, `verify_server_certificate`, `add_default_route`, `http_proxy`, `comment`, `disabled`* | Creates an SSTP client interface connecting to a remote SSTP server over TLS. |
| `list_sstp_clients` | 🟢 read | `name_filter` | Lists SSTP client interfaces on the MikroTik device. |
| `get_sstp_client` | 🟢 read | `name`* | Gets detailed information about a specific SSTP client interface. |
| `remove_sstp_client` | 🔴 destructive | `name`* | Removes an SSTP client interface from the MikroTik device. |

## OpenVPN

<a id="openvpn"></a>OpenVPN server + clients (`/interface ovpn-*`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_ovpn_server` | 🟢 read | _none_ | Gets the OpenVPN (OVPN) server configuration on the MikroTik device. |
| `set_ovpn_server` | 🟡 write·idem | `enabled`, `certificate`, `auth`, `cipher`, `netmask`, `mode`, `port`, `protocol`, `default_profile`, `require_client_certificate`, `max_mtu` | Configures the OpenVPN (OVPN) server. RouterOS 7 supports both UDP and TCP. |
| `create_ovpn_client` | 🟡 write | `name`*, `connect_to`*, `port`*, `user`, `password`, `certificate`, `cipher`, `auth`, `mode`, `protocol`, `profile`, `add_default_route`, `verify_server_certificate`, `comment`, `disabled`* | Creates an OpenVPN (OVPN) client interface connecting to a remote OpenVPN server. |
| `list_ovpn_clients` | 🟢 read | `name_filter` | Lists OpenVPN (OVPN) client interfaces on the MikroTik device. |
| `get_ovpn_client` | 🟢 read | `name`* | Gets detailed information about a specific OpenVPN client interface. |
| `remove_ovpn_client` | 🔴 destructive | `name`* | Removes an OpenVPN client interface from the MikroTik device. |
| `enable_ovpn_client` | 🟡 write·idem | `name`* | Enables an OpenVPN client interface. |
| `disable_ovpn_client` | 🟡 write·idem | `name`* | Disables an OpenVPN client interface. |

## Tunnels

<a id="tunnels"></a>GRE, IPIP, EoIP and VXLAN tunnels (`/interface gre|ipip|eoip|vxlan`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_gre_tunnel` | 🟡 write | `name`*, `remote_address`*, `local_address`, `keepalive`, `dont_fragment`, `clamp_tcp_mss`, `mtu`, `comment`, `disabled`* | Creates a GRE (Generic Routing Encapsulation) L3 tunnel interface on the MikroTik device. |
| `list_gre_tunnels` | 🟢 read | `name_filter` | Lists GRE tunnel interfaces on the MikroTik device. |
| `get_gre_tunnel` | 🟢 read | `name`* | Gets detailed information about a specific GRE tunnel interface. |
| `remove_gre_tunnel` | 🔴 destructive | `name`* | Removes a GRE tunnel interface from the MikroTik device. |
| `create_ipip_tunnel` | 🟡 write | `name`*, `remote_address`*, `local_address`, `keepalive`, `mtu`, `comment`, `disabled`* | Creates an IPIP (IP-in-IP) L3 tunnel interface on the MikroTik device. |
| `list_ipip_tunnels` | 🟢 read | `name_filter` | Lists IPIP tunnel interfaces on the MikroTik device. |
| `get_ipip_tunnel` | 🟢 read | `name`* | Gets detailed information about a specific IPIP tunnel interface. |
| `remove_ipip_tunnel` | 🔴 destructive | `name`* | Removes an IPIP tunnel interface from the MikroTik device. |
| `create_eoip_tunnel` | 🟡 write | `name`*, `remote_address`*, `tunnel_id`*, `local_address`, `keepalive`, `mtu`, `comment`, `disabled`* | Creates an EoIP (Ethernet over IP) L2 tunnel interface on the MikroTik device. Bridgeable; each tunnel needs a unique tunnel-id matching the remote peer. |
| `list_eoip_tunnels` | 🟢 read | `name_filter` | Lists EoIP tunnel interfaces on the MikroTik device. |
| `get_eoip_tunnel` | 🟢 read | `name`* | Gets detailed information about a specific EoIP tunnel interface. |
| `remove_eoip_tunnel` | 🔴 destructive | `name`* | Removes an EoIP tunnel interface from the MikroTik device. |
| `create_vxlan_tunnel` | 🟡 write | `name`*, `vni`*, `port`*, `local_address`, `interface`, `mtu`, `comment`, `disabled`* | Creates a VXLAN (Virtual Extensible LAN) L2 overlay interface on the MikroTik device. |
| `list_vxlan_tunnels` | 🟢 read | `name_filter` | Lists VXLAN interfaces on the MikroTik device. |
| `get_vxlan_tunnel` | 🟢 read | `name`* | Gets detailed information about a specific VXLAN interface. |
| `remove_vxlan_tunnel` | 🔴 destructive | `name`* | Removes a VXLAN interface from the MikroTik device. |

## RADIUS

<a id="radius"></a>RADIUS client servers, incoming CoA, counters (`/radius`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_radius_server` | 🟡 write | `address`*, `secret`*, `service`*, `authentication_port`*, `accounting_port`*, `timeout`, `src_address`, `realm`, `called_id`, `domain`, `comment`, `disabled`* | Adds a RADIUS server entry that the router uses to authenticate clients. |
| `list_radius_servers` | 🟢 read | `service_filter`, `address_filter` | Lists configured RADIUS servers. |
| `get_radius_server` | 🟢 read | `radius_id`* | Gets detailed information about a specific RADIUS server by its internal id. |
| `update_radius_server` | 🟡 write·idem | `radius_id`*, `address`, `secret`, `service`, `authentication_port`, `accounting_port`, `timeout`, `src_address`, `realm`, `called_id`, `domain`, `comment`, `disabled` | Updates an existing RADIUS server entry. |
| `remove_radius_server` | 🔴 destructive | `radius_id`* | Removes a RADIUS server entry. |
| `enable_radius_server` | 🟡 write·idem | `radius_id`* | Enables a RADIUS server entry. |
| `disable_radius_server` | 🟡 write·idem | `radius_id`* | Disables a RADIUS server entry. |
| `get_radius_incoming` | 🟢 read | _none_ | Gets the RADIUS incoming (Change of Authorization / CoA) settings. |
| `set_radius_incoming` | 🟡 write·idem | `accept`, `port` | Configures RADIUS incoming (Change of Authorization / CoA) settings. |
| `reset_radius_counters` | 🔴 destructive | _none_ | Resets the RADIUS request/response counters. |

## User Manager

<a id="user-manager"></a>Built-in RADIUS server: users, profiles, routers (NAS), limitations, sessions (`/user-manager`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_user_manager_settings` | 🟢 read | _none_ | Gets the User Manager settings (enabled, certificate, use-profiles). |
| `set_user_manager_settings` | 🟡 write·idem | `enabled`, `certificate`, `use_profiles` | Updates the User Manager settings. |
| `add_user_manager_user` | 🟡 write | `name`*, `password`*, `group`, `shared_users`, `attributes`, `comment`, `disabled`* | Adds a user to the User Manager RADIUS database. |
| `list_user_manager_users` | 🟢 read | `name_filter` | Lists users in the User Manager RADIUS database. |
| `get_user_manager_user` | 🟢 read | `name`* | Gets detailed information about a specific User Manager user. |
| `update_user_manager_user` | 🟡 write·idem | `name`*, `new_name`, `password`, `group`, `shared_users`, `attributes`, `comment`, `disabled` | Updates an existing User Manager user. |
| `remove_user_manager_user` | 🔴 destructive | `name`* | Removes a user from the User Manager RADIUS database. |
| `add_user_manager_profile` | 🟡 write | `name`*, `name_for_users`, `validity`, `price`, `starts_when`, `override_shared_users`, `comment` | Adds a User Manager profile (a billing/service plan). |
| `list_user_manager_profiles` | 🟢 read | `name_filter` | Lists User Manager profiles. |
| `remove_user_manager_profile` | 🔴 destructive | `name`* | Removes a User Manager profile. |
| `assign_user_manager_profile` | 🟡 write | `user`*, `profile`* | Assigns a profile to a User Manager user. |
| `list_user_manager_user_profiles` | 🟢 read | `user_filter` | Lists User Manager user-profile assignments. |
| `add_user_manager_router` | 🟡 write | `name`*, `address`*, `shared_secret`*, `coa_port`, `disabled`* | Adds a RADIUS client (router/NAS) that authenticates against User Manager. |
| `list_user_manager_routers` | 🟢 read | `name_filter` | Lists RADIUS clients (routers/NAS) configured in User Manager. |
| `remove_user_manager_router` | 🔴 destructive | `name`* | Removes a RADIUS client (router/NAS) from User Manager. |
| `add_user_manager_limitation` | 🟡 write | `name`*, `rate_limit_rx`, `rate_limit_tx`, `transfer_limit`, `uptime_limit`, `comment` | Adds a User Manager limitation (rate/transfer/uptime limits). |
| `list_user_manager_limitations` | 🟢 read | `name_filter` | Lists User Manager limitations. |
| `remove_user_manager_limitation` | 🔴 destructive | `name`* | Removes a User Manager limitation. |
| `list_user_manager_sessions` | 🟢 read | `user_filter`, `active_only`* | Lists User Manager accounting sessions. |

## Queues / QoS

<a id="queue"></a>Queue types, queue trees and simple queues (`/queue`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_queue_type` | 🟡 write | `name`*, `kind`*, `cake_flowmode`, `cake_nat`, `cake_overhead`, `cake_mpu`, `cake_diffserv`, `cake_ack_filter`, `cake_rtt`, `cake_wash`, `cake_overhead_scheme`, `pcq_rate`, `pcq_limit`, `pcq_classifier`, `pfifo_limit`, `bfifo_limit`, `sfq_perturb`, `sfq_allot`, `fq_codel_limit`, `fq_codel_quantum`, `fq_codel_target`, `fq_codel_interval`, `red_limit`, `red_min_threshold`, `red_max_threshold`, `red_burst`, `red_avg_packet` | Creates a queue type (qdisc). kind selects the discipline (cake, fq-codel, sfq, red, pcq, pfifo, bfifo); remaining params are per-discipline options. |
| `list_queue_types` | 🟢 read | `name_filter`, `kind_filter` | Lists queue types on the MikroTik device. |
| `get_queue_type` | 🟢 read | `name`* | Gets detailed information about a specific queue type. |
| `update_queue_type` | 🟡 write·idem | `name`*, `new_name`, `cake_flowmode`, `cake_nat`, `cake_overhead`, `cake_mpu`, `cake_diffserv`, `cake_ack_filter`, `cake_rtt`, `cake_wash`, `cake_overhead_scheme`, `pcq_rate`, `pcq_limit`, `pcq_classifier` | Updates an existing queue type's discipline-specific settings. |
| `remove_queue_type` | 🔴 destructive | `name`* | Removes a queue type from the MikroTik device. |
| `create_queue_tree` | 🟡 write | `name`*, `parent`*, `queue`, `packet_mark`, `max_limit`, `limit_at`, `burst_limit`, `burst_threshold`, `burst_time`, `bucket_size`, `priority`, `comment`, `disabled`* | Creates a hierarchical queue tree entry attached to a parent interface or queue. |
| `list_queue_trees` | 🟢 read | `name_filter`, `parent_filter`, `disabled_only`*, `invalid_only`* | Lists queue trees on the MikroTik device. |
| `get_queue_tree` | 🟢 read | `name`* | Gets detailed information about a specific queue tree. |
| `update_queue_tree` | 🟡 write·idem | `name`*, `new_name`, `parent`, `queue`, `packet_mark`, `max_limit`, `limit_at`, `burst_limit`, `burst_threshold`, `burst_time`, `bucket_size`, `priority`, `comment`, `disabled` | Updates an existing queue tree entry (bandwidth limits, parent, priority, etc.). |
| `remove_queue_tree` | 🔴 destructive | `name`* | Removes a queue tree from the MikroTik device. |
| `enable_queue_tree` | 🟡 write·idem | `name`* | Enables a queue tree. |
| `disable_queue_tree` | 🟡 write·idem | `name`* | Disables a queue tree. |
| `create_simple_queue` | 🟡 write | `name`*, `target`*, `dst`, `max_limit`, `limit_at`, `burst_limit`, `burst_threshold`, `burst_time`, `bucket_size`, `queue`, `parent`, `priority`, `packet_marks`, `comment`, `disabled`* | Creates a simple queue to rate-limit a target address or interface. |
| `list_simple_queues` | 🟢 read | `name_filter`, `target_filter`, `disabled_only`*, `invalid_only`* | Lists simple queues on the MikroTik device. |
| `get_simple_queue` | 🟢 read | `name`* | Gets detailed information about a specific simple queue. |
| `update_simple_queue` | 🟡 write·idem | `name`*, `new_name`, `target`, `dst`, `max_limit`, `limit_at`, `burst_limit`, `burst_threshold`, `burst_time`, `bucket_size`, `queue`, `parent`, `priority`, `packet_marks`, `comment`, `disabled` | Updates an existing simple queue's rate limits, target, or scheduling settings. |
| `remove_simple_queue` | 🔴 destructive | `name`* | Removes a simple queue from the MikroTik device. |
| `enable_simple_queue` | 🟡 write·idem | `name`* | Enables a simple queue. |
| `disable_simple_queue` | 🟡 write·idem | `name`* | Disables a simple queue. |

## Queues — Interface

<a id="queue-interface"></a>Per-interface queue-type assignment (`/queue interface`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_queue_interfaces` | 🟢 read | `interface_filter`, `queue_filter` | Lists per-interface queue assignments on the MikroTik device (`/queue interface`). |
| `get_queue_interface` | 🟢 read | `interface_id`* | Gets the queue assignment for a specific interface by name or '.id'. |
| `update_queue_interface` | 🟡 write·idem | `interface_id`*, `queue`* | Assigns a queue type to an interface on the MikroTik device. |

## Devices

<a id="devices"></a>List the configured MikroTik devices the AI can target via the `device` argument.

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_mikrotik_devices` | 🟢 read | _none_ | Lists the configured MikroTik devices (name, host, description) and which is the default. Pass a device's name as the `device` argument on any other tool to target it. Secrets are never shown. |

## System

<a id="system"></a>Identity, resources, health, clock/NTP, packages, reboot/shutdown.

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_system_identity` | 🟢 read | _none_ | Gets the system identity (hostname) of the MikroTik device. |
| `set_system_identity` | 🟡 write | `name`* | Sets the system identity (hostname) of the MikroTik device. |
| `get_system_resources` | 🟢 read | _none_ | Gets system resource information (CPU, memory, uptime, board name, version). |
| `get_system_health` | 🟢 read | _none_ | Gets system health sensor readings (voltage, temperature, fans). Some devices have no sensors. |
| `get_routerboard` | 🟢 read | _none_ | Gets RouterBOARD hardware information (model, serial, firmware). |
| `get_system_clock` | 🟢 read | _none_ | Gets the current system clock, date, and time-zone settings. |
| `set_system_clock` | 🟡 write | `time_zone_name`, `date`, `time` | Sets system clock settings. Provide at least one of time-zone, date, or time. |
| `get_ntp_client` | 🟢 read | _none_ | Gets the NTP client configuration and synchronization status. |
| `set_ntp_client` | 🟡 write | `enabled`, `servers` | Configures the NTP client (enable/disable and server list). |
| `get_installed_packages` | 🟢 read | _none_ | Lists installed software packages and their versions. |
| `check_for_updates` | 🟢 read | _none_ | Checks for available RouterOS updates on the configured update channel. |
| `get_system_history` | 🟢 read | _none_ | Gets the system change history (recent configuration actions). |
| `reboot_system` | ⛔ dangerous | `confirm`* | Reboots the MikroTik device. Requires confirm=true; the connection will drop. |
| `shutdown_system` | ⛔ dangerous | `confirm`* | Shuts down the MikroTik device. Requires confirm=true; the connection will drop. |

## System Config

<a id="system-config"></a>Console, LEDs, license, note, NTP server, password, ports, regulatory, reset, special-login, watchdog.

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_system_console` | 🟢 read | _none_ | Lists the system console sessions/ports (`/system console`). |
| `list_leds` | 🟢 read | _none_ | Lists the configured LEDs and their triggers (`/system leds`). |
| `get_leds_settings` | 🟢 read | _none_ | Gets the global LED settings (`/system leds settings`). |
| `set_leds_settings` | 🟡 write·idem | `all_leds_off` | Updates the global LED settings, e.g. dark-mode scheduling via all-leds-off. |
| `get_license` | 🟢 read | _none_ | Gets the RouterOS license (`/system license`). On CHR shows the license level and deadline; on RouterBOARD the menu may differ or be absent. |
| `get_note` | 🟢 read | _none_ | Gets the system note shown at login (`/system note`). |
| `set_note` | 🟡 write·idem | `note`, `show_at_login` | Sets the system note and whether it is displayed at login. |
| `get_ntp_server` | 🟢 read | _none_ | Gets the NTP server configuration (`/system ntp server`, RouterOS 7). |
| `set_ntp_server` | 🟡 write·idem | `enabled`, `broadcast`, `multicast`, `manycast`, `broadcast_address` | Configures the built-in NTP server (enable, broadcast/multicast/manycast modes). |
| `change_password` | 🟡 write | `old_password`*, `new_password`* | Changes the current user's login password (`/password`). The old and new passwords are never echoed back in the result. |
| `list_ports` | 🟢 read | `name_filter` | Lists the device's serial ports (`/port`). |
| `get_port` | 🟢 read | `name`* | Gets detailed information about a specific serial port. |
| `set_port` | 🟡 write·idem | `name`*, `baud_rate`, `data_bits`, `parity`, `stop_bits`, `flow_control` | Updates a serial port's line settings (baud rate, data/stop bits, parity, flow control). |
| `get_regulatory` | 🟢 read | _none_ | Surfaces the wireless regulatory/country domain. RouterOS has no `/system regulatory` menu; this reads `/interface wifi radio` (wifiwave2), which exposes the country and regulatory settings of the radios. |
| `reset_configuration` | ⛔ dangerous | `confirm`*, `keep_users`, `no_defaults`, `skip_backup`, `run_after_reset` | Factory-resets the device configuration (`/system reset-configuration`). Requires confirm=true; the device reboots into a default configuration and the connection will drop. |
| `list_special_login` | 🟢 read | _none_ | Lists special-login entries, e.g. serial-console auto-login (`/system special-login`). |
| `get_watchdog` | 🟢 read | _none_ | Gets the hardware/software watchdog configuration (`/system watchdog`). |
| `set_watchdog` | 🟡 write·idem | `watchdog_timer`, `watch_address`, `ping_timeout`, `no_ping_delay`, `automatic_supout`, `auto_send_supout` | Configures the watchdog timer and the host it pings to detect a hung device. |

## Network Tools

<a id="network-tools"></a>ping, traceroute, bandwidth-test, DNS resolve, netwatch (`/tool`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `ping` | 🟢 read | `address`*, `count`*, `interface`, `src_address`, `size` | Sends ICMP echo requests to a host. Output reflects a single bounded run of `count` packets (1-100); it does not stream continuously. |
| `traceroute` | 🟢 read | `address`*, `count`*, `use_dns` | Traces the network path to a host. traceroute can stream; output reflects a bounded run of `count` probes (keep count small). |
| `bandwidth_test` | 🟢 read | `address`*, `duration`*, `direction`*, `user`, `password`, `protocol`* | Runs a throughput test against a target that must be running a bandwidth-test server. Output reflects a bounded run of `duration` seconds; it does not run indefinitely. |
| `resolve_dns` | 🟢 read | `name`*, `server` | Resolves a DNS name to an address using the device's configured resolver. |
| `add_netwatch` | 🟡 write | `host`*, `interval`, `timeout`, `up_script`, `down_script`, `comment`, `disabled`* | Adds a netwatch entry that monitors a host and optionally runs scripts on up/down transitions. |
| `list_netwatch` | 🟢 read | `host_filter` | Lists netwatch host-monitoring entries. |
| `get_netwatch` | 🟢 read | `host`* | Gets detailed information about a specific netwatch entry. |
| `remove_netwatch` | 🔴 destructive | `host`* | Removes a netwatch entry by host. |

## Btest Server

<a id="tool-bandwidth-server"></a>Bandwidth-test server settings and sessions (`/tool bandwidth-server`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_bandwidth_server` | 🟢 read | _none_ | Gets the bandwidth-test server settings of the MikroTik device (`/tool bandwidth-server`). |
| `update_bandwidth_server` | 🟡 write·idem | `enabled`, `authenticate`, `max_sessions`, `allocate_udp_ports_from` | Updates the bandwidth-test server settings of the MikroTik device. |
| `list_bandwidth_server_sessions` | 🟢 read | `user_filter` | Lists active bandwidth-test server sessions (`/tool bandwidth-server session`). |

## Flood Ping

<a id="tool-flood-ping"></a>ICMP flood ping with summary statistics (`/tool flood-ping`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `flood_ping` | 🟢 read | `address`*, `count`*, `size`, `interface`, `src_address` | Sends a burst of ICMP echo requests as fast as possible and reports sent/received counts and min/avg/max round-trip times (`/tool flood-ping`). The run is bounded by `count`, so it terminates rather than streaming. |

## Graphing

<a id="tool-graphing"></a>Interface/queue/resource graphing rules (`/tool graphing`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_graphing_interface` | 🟡 write | `interface`*, `allow_address`, `store_on_disk` | Adds an interface graphing rule so the device records traffic graphs for an interface (`/tool graphing interface`). |
| `add_graphing_queue` | 🟡 write | `simple_queue`*, `allow_address`, `store_on_disk` | Adds a simple-queue graphing rule (`/tool graphing queue`). |
| `add_graphing_resource` | 🟡 write | `allow_address`, `store_on_disk` | Adds a system-resource graphing rule (CPU, memory, disk) (`/tool graphing resource`). |
| `list_graphing` | 🟢 read | `kind`* | Lists graphing rules of the given kind (interface, queue or resource). |
| `remove_graphing` | 🔴 destructive | `kind`*, `entry_id`* | Removes a graphing rule of the given kind by '.id' (from list output). |

## IP Scan

<a id="tool-ip-scan"></a>Discover live hosts on a range or interface (`/tool ip-scan`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `ip_scan` | 🟢 read | `address_range`, `interface`, `duration`* | Scans an address range (or a connected interface's subnet) for live hosts, returning addresses, MACs, response times and discovered DNS names (`/tool ip-scan`). The run is bounded by `duration`. |

## MAC Server

<a id="tool-mac-server"></a>MAC-Telnet/MAC-Winbox/MAC-ping servers and sessions (`/tool mac-server`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_mac_server` | 🟢 read | _none_ | Gets the MAC-Telnet server settings (`/tool mac-server`). |
| `update_mac_server` | 🟡 write·idem | `allowed_interface_list`* | Updates the MAC-Telnet server settings of the MikroTik device. |
| `get_mac_winbox` | 🟢 read | _none_ | Gets the MAC-Winbox server settings (`/tool mac-server mac-winbox`). |
| `update_mac_winbox` | 🟡 write·idem | `allowed_interface_list`* | Updates the MAC-Winbox server settings of the MikroTik device (which interfaces accept Winbox over MAC). |
| `get_mac_ping` | 🟢 read | _none_ | Gets the MAC-ping server setting (`/tool mac-server ping`). |
| `update_mac_ping` | 🟡 write·idem | `enabled`* | Enables or disables the MAC-ping server (`/tool mac-server ping`). |
| `list_mac_server_sessions` | 🟢 read | `interface_filter` | Lists active MAC-Telnet sessions (`/tool mac-server session`). |

## Packet Sniffer

<a id="tool-sniffer"></a>Packet capture: settings, start/stop/save, captured hosts/protocols/packets (`/tool sniffer`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_sniffer_settings` | 🟢 read | _none_ | Gets the packet sniffer configuration and running state (`/tool sniffer`). |
| `update_sniffer_settings` | 🟡 write·idem | `filter_interface`, `filter_ip_address`, `filter_port`, `filter_mac_protocol`, `streaming_enabled`, `streaming_server`, `memory_limit`, `file_name`, `only_headers` | Updates the packet sniffer configuration on the MikroTik device. |
| `start_sniffer` | 🟡 write | _none_ | Starts the packet sniffer capturing into memory (and a file if configured). Stop it with stop_sniffer to read the results. |
| `stop_sniffer` | 🟡 write | _none_ | Stops the packet sniffer. |
| `save_sniffer` | 🟡 write | `file_name`* | Saves the current sniffer buffer to a .pcap file on the device. |
| `list_sniffer_packets` | 🟢 read | `address_filter`, `protocol_filter` | Lists captured packets (`/tool sniffer packet`). |
| `list_sniffer_hosts` | 🟢 read | `address_filter` | Lists hosts seen by the sniffer with byte/packet counts (`/tool sniffer host`). |
| `list_sniffer_protocols` | 🟢 read | _none_ | Lists the protocol distribution seen by the sniffer (`/tool sniffer protocol`). |
| `list_sniffer_connections` | 🟢 read | _none_ | Lists connections observed by the sniffer (`/tool sniffer connection`). |

## Profile

<a id="tool-profile"></a>CPU usage profiler by subsystem (`/tool profile`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `profile_cpu` | 🟢 read | `duration`*, `cpu` | Profiles CPU usage by process/classifier over a bounded sampling window, showing which subsystems consume CPU (`/tool profile`). The run is bounded by `duration`, so it terminates rather than streaming. |

## RoMON

<a id="tool-romon"></a>Router Management Overlay Network settings and ports (`/tool romon`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_romon` | 🟢 read | _none_ | Gets the RoMON settings of the MikroTik device (`/tool romon`). |
| `update_romon` | 🟡 write·idem | `enabled`, `id`, `secrets` | Updates the RoMON settings of the MikroTik device. |
| `add_romon_port` | 🟡 write | `interface`*, `cost`, `secrets`, `forbid`, `disabled`* | Adds a RoMON port entry controlling which interfaces participate in the overlay (`/tool romon port`). |
| `list_romon_ports` | 🟢 read | `interface_filter` | Lists RoMON port entries (`/tool romon port`). |
| `remove_romon_port` | 🔴 destructive | `port_id`* | Removes a RoMON port entry by interface or '.id' from the MikroTik device. |

## SMS

<a id="tool-sms"></a>Send/receive SMS over an LTE modem (`/tool sms`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_sms_settings` | 🟢 read | _none_ | Gets the SMS settings of the MikroTik device (`/tool sms`). |
| `update_sms_settings` | 🟡 write·idem | `port`, `receive_enabled`, `secret`, `allowed_number`, `channel`, `sim_pin` | Updates the SMS settings of the MikroTik device. |
| `send_sms` | 🟡 write | `port`*, `phone_number`*, `message`*, `smsc`, `channel` | Sends an SMS message via the device's LTE/modem (`/tool sms send`). |
| `list_sms_inbox` | 🟢 read | `phone_filter` | Lists received SMS messages (`/tool sms inbox`). |

## Speed Test

<a id="tool-speed-test"></a>Latency/throughput test to another RouterOS (`/tool speed-test`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `speed_test` | 🟢 read | `address`*, `duration`*, `direction`*, `tcp_connection_count`, `user`, `password` | Runs a latency and throughput test to another reachable RouterOS device (`/tool speed-test`). The run is bounded by `duration`, so it terminates rather than streaming. |

## Traffic Generator

<a id="tool-traffic-generator"></a>Synthetic traffic: ports, streams and run control (`/tool traffic-generator`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_traffic_generator_port` | 🟡 write | `name`*, `interface`*, `disabled`* | Adds a traffic-generator port binding a name to a physical interface (`/tool traffic-generator port`). |
| `list_traffic_generator_ports` | 🟢 read | `name_filter` | Lists traffic-generator ports (`/tool traffic-generator port`). |
| `remove_traffic_generator_port` | 🔴 destructive | `port_id`* | Removes a traffic-generator port by name or '.id' from the MikroTik device. |
| `add_traffic_generator_stream` | 🟡 write | `name`*, `port`*, `tx_template`, `packet_size`, `tx_rate`, `comment`, `disabled`* | Adds a traffic-generator stream describing what to transmit on a port (`/tool traffic-generator stream`). |
| `list_traffic_generator_streams` | 🟢 read | `name_filter`, `port_filter` | Lists traffic-generator streams (`/tool traffic-generator stream`). |
| `remove_traffic_generator_stream` | 🔴 destructive | `stream_id`* | Removes a traffic-generator stream by name or '.id' from the MikroTik device. |
| `start_traffic_generator` | 🟡 write | `duration` | Starts the traffic generator, transmitting the configured streams (`/tool traffic-generator start`). |
| `stop_traffic_generator` | 🟡 write | _none_ | Stops the traffic generator (`/tool traffic-generator stop`). |

## Traffic Monitor

<a id="tool-traffic-monitor"></a>Run scripts when interface traffic crosses a threshold (`/tool traffic-monitor`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_traffic_monitor` | 🟡 write | `name`*, `interface`*, `traffic`*, `trigger`*, `threshold`*, `on_event`, `comment`, `disabled`* | Adds a traffic-monitor entry that runs a script when an interface's traffic crosses a threshold (`/tool traffic-monitor`). |
| `list_traffic_monitors` | 🟢 read | `name_filter`, `interface_filter`, `disabled_only`* | Lists traffic-monitor entries (`/tool traffic-monitor`). |
| `get_traffic_monitor` | 🟢 read | `name`* | Gets a specific traffic-monitor entry by name. |
| `update_traffic_monitor` | 🟡 write·idem | `name`*, `interface`, `traffic`, `trigger`, `threshold`, `on_event`, `comment`, `disabled` | Updates a traffic-monitor entry by name. Pass comment="" to clear the comment. |
| `remove_traffic_monitor` | 🔴 destructive | `name`* | Removes a traffic-monitor entry by name. |
| `enable_traffic_monitor` | 🟡 write·idem | `name`* | Enables a traffic-monitor entry by name. |
| `disable_traffic_monitor` | 🟡 write·idem | `name`* | Disables a traffic-monitor entry by name. |

## Wake-on-LAN

<a id="tool-wol"></a>Send Wake-on-LAN magic packets (`/tool wol`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `wake_on_lan` | 🟡 write | `mac`*, `interface` | Sends a Wake-on-LAN magic packet to wake a host by MAC address (`/tool wol`). |

## Scheduler / Scripts

<a id="scheduler"></a>Scheduled jobs and scripts (`/system scheduler`, `/system script`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_scheduler` | 🟡 write | `name`*, `on_event`*, `interval`, `start_time`, `start_date`, `comment`, `disabled`* | Creates a scheduled task on the MikroTik device that runs an on-event script at an interval or start time. |
| `list_schedulers` | 🟢 read | `name_filter` | Lists scheduled tasks on the MikroTik device. |
| `get_scheduler` | 🟢 read | `name`* | Gets detailed information about a specific scheduler entry. |
| `remove_scheduler` | 🔴 destructive | `name`* | Removes a scheduled task from the MikroTik device. |
| `enable_scheduler` | 🟡 write·idem | `name`* | Enables a scheduled task on the MikroTik device. |
| `disable_scheduler` | 🟡 write·idem | `name`* | Disables a scheduled task on the MikroTik device. |
| `add_script` | 🟡 write | `name`*, `source`*, `comment`, `dont_require_permissions`* | Adds a named script to the MikroTik device's script repository. |
| `list_scripts` | 🟢 read | `name_filter` | Lists scripts in the MikroTik device's script repository. |
| `remove_script` | 🔴 destructive | `name`* | Removes a script from the MikroTik device's script repository. |
| `run_script` | 🟡 write | `name`* | Runs a named script from the MikroTik device's script repository. |

## Users

<a id="users"></a>Users, groups, active sessions and SSH keys (`/user`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_user` | 🟡 write | `name`*, `password`*, `group`*, `address`, `comment`, `disabled`* | Adds a user to MikroTik device. |
| `list_users` | 🟢 read | `name_filter`, `group_filter`, `disabled_only`*, `active_only`* | Lists users on MikroTik device. |
| `get_user` | 🟢 read | `name`* | Gets detailed information about a specific user. |
| `update_user` | 🟡 write·idem | `name`*, `new_name`, `password`, `group`, `address`, `comment`, `disabled` | Updates a user. |
| `remove_user` | 🔴 destructive | `name`* | Removes a user. |
| `disable_user` | 🟡 write·idem | `name`* | Disables a user. |
| `enable_user` | 🟡 write·idem | `name`* | Enables a user. |
| `add_user_group` | 🟡 write | `name`*, `policy`*, `skin`, `comment` | Adds a user group. |
| `list_user_groups` | 🟢 read | `name_filter`, `policy_filter` | Lists user groups on MikroTik device. |
| `get_user_group` | 🟢 read | `name`* | Gets detailed information about a specific user group. |
| `update_user_group` | 🟡 write·idem | `name`*, `new_name`, `policy`, `skin`, `comment` | Updates a user group. |
| `remove_user_group` | 🔴 destructive | `name`* | Removes a user group. |
| `get_active_users` | 🟢 read | _none_ | Gets currently active/logged-in users. |
| `disconnect_user` | 🔴 destructive | `user_id`* | Disconnects an active user session. |
| `export_user_config` | 🟢 read | `filename` | Exports user configuration to a file. |
| `set_user_ssh_keys` | 🟡 write | `username`*, `key_file`* | Sets SSH keys for a specific user. |
| `list_user_ssh_keys` | 🟢 read | `username`* | Lists SSH keys for a specific user. |
| `remove_user_ssh_key` | 🔴 destructive | `key_id`* | Removes an SSH key. |

## Logs

<a id="logs"></a>Log retrieval, search, statistics and export (`/log`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `get_logs` | 🟢 read | `topics`, `action`, `time_filter`, `message_filter`, `prefix_filter`, `limit`, `follow`*, `print_as`* | Gets logs from the MikroTik device with optional topic, time, and message filters. |
| `get_logs_by_severity` | 🟢 read | `severity`*, `time_filter`, `limit` | Gets logs filtered by severity level (debug/info/warning/error/critical). |
| `get_logs_by_topic` | 🟢 read | `topic`*, `time_filter`, `limit` | Gets logs for a specific topic/facility (system, dhcp, interface, firewall, etc.). |
| `search_logs` | 🟢 read | `search_term`*, `time_filter`, `case_sensitive`*, `limit` | Searches log messages for a specific term. |
| `get_system_events` | 🟢 read | `event_type`, `time_filter`, `limit` | Gets system-related log events (login, reboot, config-change, etc.). |
| `get_security_logs` | 🟢 read | `time_filter`, `limit` | Gets security-related log entries (login failures, blocked connections, etc.). |
| `clear_logs` | 🔴 destructive | _none_ | Clears all logs from the MikroTik device. This action cannot be undone. |
| `get_log_statistics` | 🟢 read | _none_ | Gets log entry counts by topic and severity from the MikroTik device. |
| `export_logs` | 🟢 read | `filename`, `topics`, `time_filter`, `format`* | Exports logs to a file on the MikroTik device with optional topic and time filters. |
| `monitor_logs` | 🟢 read | `topics`, `action`, `duration`* | Monitors MikroTik logs in near-real-time for a limited duration (max 60s). |

## Logging Config

<a id="logging"></a>Logging rules + actions: where each topic is logged (`/system logging`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `add_logging_rule` | 🟡 write | `topics`*, `action`, `prefix`, `disabled`* | Adds a system logging rule that routes log messages matching the given topics to a logging action. |
| `list_logging_rules` | 🟢 read | `topics_filter`, `action_filter` | Lists system logging rules on the MikroTik device. |
| `remove_logging_rule` | 🔴 destructive | `rule_id`* | Removes a system logging rule by its internal id. |
| `add_logging_action` | 🟡 write | `name`*, `target`*, `remote`, `remote_port`, `bsd_syslog`, `syslog_facility`, `syslog_severity`, `disk_file_name`, `disk_lines_per_file`, `memory_lines`, `email_to`, `disabled`* | Adds a system logging action defining where matching log messages are sent (memory, disk, echo, remote syslog or email). |
| `list_logging_actions` | 🟢 read | `name_filter` | Lists system logging actions on the MikroTik device. |
| `remove_logging_action` | 🔴 destructive | `name`* | Removes a system logging action by name. |

## Backup

<a id="backup"></a>Binary backups, text exports, file transfer and restore.

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `create_backup` | 🟡 write | `name`, `dont_encrypt`*, `include_password`*, `comment` | Creates a system backup on the MikroTik device. |
| `list_backups` | 🟢 read | `name_filter`, `include_exports`* | Lists backup files on the MikroTik device. |
| `create_export` | 🟢 read | `name`, `file_format`*, `export_type`*, `hide_sensitive`*, `verbose`*, `compact`*, `comment` | Creates a configuration export file (rsc/json/xml) on the MikroTik device. |
| `export_section` | 🟢 read | `section`*, `name`, `hide_sensitive`*, `compact`* | Exports a specific RouterOS configuration section to a file. section: RouterOS path without leading slash e.g. "ip address", "interface vlan", "ip firewall filter", "ip firewall nat", "queue simple". |
| `download_file` | 🟢 read | `filename`*, `file_type`* | Downloads a backup or export file from the MikroTik device as base64-encoded content. |
| `upload_file` | 🟡 write | `filename`*, `content_base64`* | Uploads a base64-encoded file to the MikroTik device (for restore operations). |
| `restore_backup` | ⛔ dangerous | `filename`*, `password` | Restores a system backup on the MikroTik device; triggers a reboot. |
| `import_configuration` | ⛔ dangerous | `filename`*, `run_after_reset`*, `verbose`* | Imports and executes a RouterOS configuration script (.rsc file) on the device. |
| `remove_file` | ⛔ dangerous | `filename`* | Removes a file from the MikroTik device filesystem. |
| `backup_info` | 🟢 read | `filename`* | Gets detailed information about a backup file on the MikroTik device. |

## S3 Backup

<a id="s3-backup"></a>Optional: ship device backups/exports to S3-compatible storage, organised per device (`/tool fetch` + Bun S3).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `s3_backup_status` | 🟢 read | _none_ | Reports whether optional S3 backup storage is configured and where backups will be stored. |
| `upload_backup_to_s3` | 🟡 write | `filename`*, `key`, `expires_in` | Uploads a file from the device (e.g. a .backup or .rsc export) to the configured S3 bucket. The device streams it directly to S3 via a short-lived presigned URL. |
| `download_backup_from_s3` | 🟡 write | `key`*, `filename`, `expires_in` | Downloads an object from the configured S3 bucket onto the device filesystem (e.g. to later restore a backup). The device streams it directly from S3 via a short-lived presigned URL. |
| `list_s3_backups` | 🟢 read | `prefix`, `max_keys`* | Lists objects in the configured S3 bucket. By default lists only the current device's backups (under '<prefix>/<device>/'); pass an explicit prefix to list elsewhere (e.g. '' for the whole bucket). |
| `s3_backup_info` | 🟢 read | `key`* | Gets metadata (size, etag, last-modified, content type) for an object in the configured S3 bucket. |
| `delete_s3_backup` | 🔴 destructive | `key`* | Deletes an object from the configured S3 bucket. |

## Disk

<a id="disk"></a>Storage devices: list/get disks and format-drive (`/disk`).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `list_disks` | 🟢 read | _none_ | Lists storage disks (USB, NVMe, internal flash) attached to the MikroTik device. |
| `get_disk` | 🟢 read | `name`* | Gets detailed information about a specific disk. |
| `format_disk` | ⛔ dangerous | `name`*, `file_system`, `label`, `confirm`* | Formats (ERASES) a disk on the MikroTik device. This destroys all data on the disk. Requires confirm=true. |

## Safe Mode

<a id="safe-mode"></a>Transactional config window with auto-revert (Ctrl+X session).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `safe_mode_status` | 🟢 read | _none_ | Returns whether MikroTik Safe Mode is currently active (for the targeted device). |
| `enable_safe_mode` | 🟡 write | _none_ | Activates MikroTik Safe Mode on the targeted device; changes are held in memory and auto-reverted on disconnect until committed. |
| `commit_safe_mode` | 🟡 write | _none_ | Commits all pending Safe Mode changes on the targeted device to persistent storage and exits Safe Mode. |
| `rollback_safe_mode` | 🟡 write | _none_ | Discards all pending Safe Mode changes on the targeted device by closing the SSH session, triggering automatic rollback. |

## Apps — Dashboards

<a id="app-views"></a>Tools that render interactive UI views inline (MCP Apps): the device dashboard, the interfaces overview and the firewall-rules table. Every read tool (list_*/get_*) additionally renders in the generic records viewer.

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `show_system_dashboard` | 🟢 read | _none_ | Shows a live device health dashboard (CPU, memory, disk, uptime, temperature/voltage, board and RouterOS version) as an interactive view. Use this when the user wants an at-a-glance overview of a MikroTik device. |
| `show_interfaces` | 🟢 read | _none_ | Shows all interfaces as an interactive overview: per-port running/disabled status, type, MTU and MAC address, with live refresh. Use this when the user wants a visual at-a-glance view of the device's interfaces. |
| `show_firewall_filter` | 🟢 read | _none_ | Shows the IP firewall filter rules as an interactive, ordered table: chain, action, key matchers and packet/byte counters, with enabled/disabled state and live refresh. Use this when the user wants to review the firewall ruleset visually. |

