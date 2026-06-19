# Tool Reference

> **Generated** from source by `scripts/gen-tool-docs.ts` (`bun run gen:docs`) for v1.0.0. Do not edit by hand.

**340 tools** across **34 modules**. A `*` marks a required parameter.

Risk legend: 🟢 read · 🟡 write · 🔴 destructive (removes config) · ⛔ dangerous (high blast radius / not repeatable).

## Modules

| Module | Group | Tools | Scope |
|--------|-------|------:|-------|
| [Interfaces](#interfaces) | Interfaces | 4 | Generic interface listing and enable/disable (`/interface`). |
| [VLAN](#vlan) | Interfaces | 5 | 802.1Q VLAN interfaces (`/interface vlan`). |
| [Bridge](#bridge) | Interfaces | 11 | Bridges, ports, host table and bridge VLANs (`/interface bridge`). |
| [Wireless](#wireless) | Interfaces | 18 | Wireless interfaces, security profiles and access lists (legacy + wifiwave2). |
| [PoE](#poe) | Interfaces | 3 | Power-over-Ethernet status and configuration (`/interface ethernet poe`). |
| [IP Addresses](#ip-address) | Addressing & Routing | 4 | Interface IP addressing (`/ip address`). |
| [IP Pools](#ip-pool) | Addressing & Routing | 7 | Address pools for DHCP/PPP (`/ip pool`). |
| [Routing](#routes) | Addressing & Routing | 14 | Static routes, routing table, route checks and cache (`/ip route`). |
| [DHCP](#dhcp) | Addressing & Routing | 6 | DHCP servers, networks and pools (`/ip dhcp-server`). |
| [DNS](#dns) | Addressing & Routing | 15 | DNS settings, static records, cache and regexp (`/ip dns`). |
| [Firewall — Filter](#firewall-filter) | Security | 9 | Filter rules and a guided basic setup (`/ip firewall filter`). |
| [Firewall — NAT](#firewall-nat) | Security | 8 | NAT rules: src/dst-nat, masquerade, redirect (`/ip firewall nat`). |
| [Address Lists](#address-list) | Security | 6 | Firewall address-lists (`/ip firewall address-list`). |
| [Certificates](#certificate) | Security | 6 | X.509 certificate management (`/certificate`). |
| [IP Services](#ip-service) | Security | 5 | Management service ports — ssh/www/api/telnet (`/ip service`). |
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
| [Devices](#devices) | System & Ops | 1 | List the configured MikroTik devices the AI can target via the `device` argument. |
| [System](#system) | System & Ops | 14 | Identity, resources, health, clock/NTP, packages, reboot/shutdown. |
| [Network Tools](#network-tools) | System & Ops | 8 | ping, traceroute, bandwidth-test, DNS resolve, netwatch (`/tool`). |
| [Scheduler / Scripts](#scheduler) | System & Ops | 10 | Scheduled jobs and scripts (`/system scheduler`, `/system script`). |
| [Users](#users) | System & Ops | 18 | Users, groups, active sessions and SSH keys (`/user`). |
| [Logs](#logs) | System & Ops | 10 | Log retrieval, search, statistics and export (`/log`). |
| [Backup](#backup) | System & Ops | 10 | Binary backups, text exports, file transfer and restore. |
| [Safe Mode](#safe-mode) | System & Ops | 4 | Transactional config window with auto-revert (Ctrl+X session). |

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

## Routing

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

## Safe Mode

<a id="safe-mode"></a>Transactional config window with auto-revert (Ctrl+X session).

| Tool | Risk | Parameters | Description |
|------|------|------------|-------------|
| `safe_mode_status` | 🟢 read | _none_ | Returns whether MikroTik Safe Mode is currently active (for the targeted device). |
| `enable_safe_mode` | 🟡 write | _none_ | Activates MikroTik Safe Mode on the targeted device; changes are held in memory and auto-reverted on disconnect until committed. |
| `commit_safe_mode` | 🟡 write | _none_ | Commits all pending Safe Mode changes on the targeted device to persistent storage and exits Safe Mode. |
| `rollback_safe_mode` | 🟡 write | _none_ | Discards all pending Safe Mode changes on the targeted device by closing the SSH session, triggering automatic rollback. |

