/**
 * The complete tool catalog — the single source of truth for both the server
 * (which registers `allToolModules`) and the doc/schema generators (which read
 * the labels and descriptions from `moduleCatalog`). Add a module in exactly one
 * place: here.
 */
import type { ToolModule } from "../core/registry";

import { addressListTools } from "./address-list";
import { appViewTools } from "./app-views";
import { backupTools } from "./backup";
import { s3BackupTools } from "./s3-backup";
import { bridgeTools } from "./bridge";
import { certificateTools } from "./certificate";
import { deviceTools } from "./devices";
import { dhcpTools } from "./dhcp";
import { diskTools } from "./disk";
import { dnsTools } from "./dns";
import { dot1xServerTools } from "./dot1x-server";
import { dot1xClientTools } from "./dot1x-client";
import { firewallFilterTools } from "./firewall-filter";
import { firewallNatTools } from "./firewall-nat";
import { interfaceTools } from "./interfaces";
import { ipAddressTools } from "./ip-address";
import { ipPoolTools } from "./ip-pool";
import { ipServiceTools } from "./ip-service";
import { ipv6AddressTools } from "./ipv6-address";
import { ipv6DhcpClientTools } from "./ipv6-dhcp-client";
import { ipv6DhcpRelayTools } from "./ipv6-dhcp-relay";
import { ipv6DhcpServerTools } from "./ipv6-dhcp-server";
import { ipv6FirewallFilterTools } from "./ipv6-firewall-filter";
import { ipv6FirewallNatTools } from "./ipv6-firewall-nat";
import { ipv6FirewallMangleTools } from "./ipv6-firewall-mangle";
import { ipv6FirewallRawTools } from "./ipv6-firewall-raw";
import { ipv6FirewallAddressListTools } from "./ipv6-firewall-address-list";
import { ipv6NdTools } from "./ipv6-nd";
import { ipv6NeighborTools } from "./ipv6-neighbor";
import { ipv6PoolTools } from "./ipv6-pool";
import { ipv6RouteTools } from "./ipv6-route";
import { ipv6SettingsTools } from "./ipv6-settings";
import { ipsecTools } from "./ipsec";
import { l2tpTools } from "./l2tp";
import { logTools } from "./logs";
import { systemLoggingTools } from "./logging";
import { networkToolTools } from "./network-tools";
import { bandwidthServerTools } from "./tool-bandwidth-server";
import { floodPingTools } from "./tool-flood-ping";
import { graphingTools } from "./tool-graphing";
import { ipScanTools } from "./tool-ip-scan";
import { macServerTools } from "./tool-mac-server";
import { snifferTools } from "./tool-sniffer";
import { profileTools } from "./tool-profile";
import { romonTools } from "./tool-romon";
import { smsTools } from "./tool-sms";
import { speedTestTools } from "./tool-speed-test";
import { trafficGeneratorTools } from "./tool-traffic-generator";
import { trafficMonitorTools } from "./tool-traffic-monitor";
import { wolTools } from "./tool-wol";
import { openvpnTools } from "./openvpn";
import { poeTools } from "./poe";
import { pppTools } from "./ppp";
import { pptpTools } from "./pptp";
import { queueTools } from "./queue";
import { queueInterfaceTools } from "./queue-interface";
import { radiusTools } from "./radius";
import { routeTools } from "./routes";
import { routingBfdTools } from "./routing-bfd";
import { routingBgpTools } from "./routing-bgp";
import { routingFilterTools } from "./routing-filter";
import { routingGmpTools } from "./routing-gmp";
import { routingIdTools } from "./routing-id";
import { routingIgmpProxyTools } from "./routing-igmp-proxy";
import { routingNexthopTools } from "./routing-nexthop";
import { routingOspfTools } from "./routing-ospf";
import { routingPimsmTools } from "./routing-pimsm";
import { routingRipTools } from "./routing-rip";
import { routingRpkiTools } from "./routing-rpki";
import { routingSettingsTools } from "./routing-settings";
import { routingRuleTools } from "./routing-rule";
import { routingTableTools } from "./routing-table";
import { safeModeTools } from "./safe-mode";
import { schedulerTools } from "./scheduler";
import { sstpTools } from "./sstp";
import { switchSettingsTools } from "./switch-settings";
import { switchPortTools } from "./switch-port";
import { switchPortIsolationTools } from "./switch-port-isolation";
import { switchRuleTools } from "./switch-rule";
import { systemConfigTools } from "./system-config";
import { systemTools } from "./system";
import { tunnelTools } from "./tunnels";
import { userManagerTools } from "./user-manager";
import { userTools } from "./users";
import { vlanTools } from "./vlan";
import { wireguardTools } from "./wireguard";
import { wirelessTools } from "./wireless";

export interface ModuleInfo {
  /** Display label used in docs. */
  label: string;
  /** Anchor/slug used for doc cross-links. */
  slug: string;
  /** Functional group the module belongs to. */
  group: string;
  /** One-line scope summary. */
  description: string;
  tools: ToolModule;
}

export const moduleCatalog: ModuleInfo[] = [
  // ── Layer 2 / interfaces ─────────────────────────────────────────────────
  {
    label: "Interfaces",
    slug: "interfaces",
    group: "Interfaces",
    description: "Generic interface listing and enable/disable (`/interface`).",
    tools: interfaceTools,
  },
  {
    label: "VLAN",
    slug: "vlan",
    group: "Interfaces",
    description: "802.1Q VLAN interfaces (`/interface vlan`).",
    tools: vlanTools,
  },
  {
    label: "Bridge",
    slug: "bridge",
    group: "Interfaces",
    description: "Bridges, ports, host table and bridge VLANs (`/interface bridge`).",
    tools: bridgeTools,
  },
  {
    label: "Wireless",
    slug: "wireless",
    group: "Interfaces",
    description: "Wireless interfaces, security profiles and access lists (legacy + wifiwave2).",
    tools: wirelessTools,
  },
  {
    label: "PoE",
    slug: "poe",
    group: "Interfaces",
    description: "Power-over-Ethernet status and configuration (`/interface ethernet poe`).",
    tools: poeTools,
  },
  // ── Switch chip (`/interface ethernet switch`) ───────────────────────────
  {
    label: "Switch — Settings",
    slug: "switch-settings",
    group: "Switch",
    description:
      "Hardware switch chips: mirroring, CPU flow control (`/interface ethernet switch`).",
    tools: switchSettingsTools,
  },
  {
    label: "Switch — Ports",
    slug: "switch-port",
    group: "Switch",
    description: "Per-port switch chip VLAN settings (`/interface ethernet switch port`).",
    tools: switchPortTools,
  },
  {
    label: "Switch — Port Isolation",
    slug: "switch-port-isolation",
    group: "Switch",
    description:
      "Hardware port isolation / forwarding overrides (`/interface ethernet switch port-isolation`).",
    tools: switchPortIsolationTools,
  },
  {
    label: "Switch — Rules",
    slug: "switch-rule",
    group: "Switch",
    description: "Hardware switch ACL/redirect rules (`/interface ethernet switch rule`).",
    tools: switchRuleTools,
  },
  // ── Layer 3 / addressing & routing ───────────────────────────────────────
  {
    label: "IP Addresses",
    slug: "ip-address",
    group: "Addressing & Routing",
    description: "Interface IP addressing (`/ip address`).",
    tools: ipAddressTools,
  },
  {
    label: "IP Pools",
    slug: "ip-pool",
    group: "Addressing & Routing",
    description: "Address pools for DHCP/PPP (`/ip pool`).",
    tools: ipPoolTools,
  },
  {
    label: "Routing — Static",
    slug: "routes",
    group: "Addressing & Routing",
    description: "Static routes, routing table, route checks and cache (`/ip route`).",
    tools: routeTools,
  },
  {
    label: "DHCP",
    slug: "dhcp",
    group: "Addressing & Routing",
    description: "DHCP servers, networks and pools (`/ip dhcp-server`).",
    tools: dhcpTools,
  },
  {
    label: "DNS",
    slug: "dns",
    group: "Addressing & Routing",
    description: "DNS settings, static records, cache and regexp (`/ip dns`).",
    tools: dnsTools,
  },
  // ── IPv6 (`/ipv6`) ───────────────────────────────────────────────────────
  {
    label: "IPv6 Addresses",
    slug: "ipv6-address",
    group: "IPv6",
    description: "Interface IPv6 addressing (`/ipv6 address`).",
    tools: ipv6AddressTools,
  },
  {
    label: "DHCPv6 Client",
    slug: "ipv6-dhcp-client",
    group: "IPv6",
    description: "DHCPv6 client: address/prefix delegation requests (`/ipv6 dhcp-client`).",
    tools: ipv6DhcpClientTools,
  },
  {
    label: "DHCPv6 Relay",
    slug: "ipv6-dhcp-relay",
    group: "IPv6",
    description: "DHCPv6 relay: forward client requests to upstream servers (`/ipv6 dhcp-relay`).",
    tools: ipv6DhcpRelayTools,
  },
  {
    label: "DHCPv6 Server",
    slug: "ipv6-dhcp-server",
    group: "IPv6",
    description: "DHCPv6 server, static bindings and custom options (`/ipv6 dhcp-server`).",
    tools: ipv6DhcpServerTools,
  },
  {
    label: "IPv6 Firewall — Filter",
    slug: "ipv6-firewall-filter",
    group: "IPv6",
    description: "IPv6 filter rules (`/ipv6 firewall filter`).",
    tools: ipv6FirewallFilterTools,
  },
  {
    label: "IPv6 Firewall — NAT",
    slug: "ipv6-firewall-nat",
    group: "IPv6",
    description: "IPv6 NAT rules: src-nat, dst-nat, masquerade, netmap (`/ipv6 firewall nat`).",
    tools: ipv6FirewallNatTools,
  },
  {
    label: "IPv6 Firewall — Mangle",
    slug: "ipv6-firewall-mangle",
    group: "IPv6",
    description:
      "IPv6 mangle rules: connection/packet/routing marks, DSCP, hop-limit (`/ipv6 firewall mangle`).",
    tools: ipv6FirewallMangleTools,
  },
  {
    label: "IPv6 Firewall — Raw",
    slug: "ipv6-firewall-raw",
    group: "IPv6",
    description: "IPv6 raw rules: pre-conntrack accept/drop/notrack (`/ipv6 firewall raw`).",
    tools: ipv6FirewallRawTools,
  },
  {
    label: "IPv6 Firewall — Address List",
    slug: "ipv6-firewall-address-list",
    group: "IPv6",
    description: "IPv6 firewall address-lists (`/ipv6 firewall address-list`).",
    tools: ipv6FirewallAddressListTools,
  },
  {
    label: "IPv6 ND",
    slug: "ipv6-nd",
    group: "IPv6",
    description:
      "Neighbor Discovery / Router Advertisement config and advertised prefixes (`/ipv6 nd`).",
    tools: ipv6NdTools,
  },
  {
    label: "IPv6 Neighbors",
    slug: "ipv6-neighbor",
    group: "IPv6",
    description: "IPv6 neighbor cache (ND-discovered addresses), read + flush (`/ipv6 neighbor`).",
    tools: ipv6NeighborTools,
  },
  {
    label: "IPv6 Pool",
    slug: "ipv6-pool",
    group: "IPv6",
    description: "IPv6 address/prefix pools for delegation and addressing (`/ipv6 pool`).",
    tools: ipv6PoolTools,
  },
  {
    label: "IPv6 Routes",
    slug: "ipv6-route",
    group: "IPv6",
    description: "Static IPv6 routes, incl. default and blackhole/unreachable (`/ipv6 route`).",
    tools: ipv6RouteTools,
  },
  {
    label: "IPv6 Settings",
    slug: "ipv6-settings",
    group: "IPv6",
    description:
      "Global IPv6 settings: forwarding, RA/redirect acceptance, neighbor table (`/ipv6 settings`).",
    tools: ipv6SettingsTools,
  },
  // ── Dynamic routing (`/routing`) ─────────────────────────────────────────
  {
    label: "Router ID",
    slug: "routing-id",
    group: "Dynamic Routing",
    description: "Router-ID instances for OSPF/BGP (`/routing id`).",
    tools: routingIdTools,
  },
  {
    label: "Routing Settings",
    slug: "routing-settings",
    group: "Dynamic Routing",
    description:
      "Global routing settings: ECMP hash policy, VRF-as-interface (`/routing settings`).",
    tools: routingSettingsTools,
  },
  {
    label: "Routing Tables",
    slug: "routing-table",
    group: "Dynamic Routing",
    description: "Named routing tables / FIBs (`/routing table`).",
    tools: routingTableTools,
  },
  {
    label: "Routing Rules",
    slug: "routing-rule",
    group: "Dynamic Routing",
    description:
      "Policy routing rules selecting a table by src/dst/interface/mark (`/routing rule`).",
    tools: routingRuleTools,
  },
  {
    label: "Next-hops",
    slug: "routing-nexthop",
    group: "Dynamic Routing",
    description: "Resolved recursive next-hop table, read-only diagnostics (`/routing nexthop`).",
    tools: routingNexthopTools,
  },
  {
    label: "Routing Filters",
    slug: "routing-filter",
    group: "Dynamic Routing",
    description: "Route filter rules, select-rules and num-lists (`/routing filter`).",
    tools: routingFilterTools,
  },
  {
    label: "BFD",
    slug: "routing-bfd",
    group: "Dynamic Routing",
    description: "Bidirectional Forwarding Detection config + sessions (`/routing bfd`).",
    tools: routingBfdTools,
  },
  {
    label: "BGP",
    slug: "routing-bgp",
    group: "Dynamic Routing",
    description: "BGP connections, templates, sessions and advertisements (`/routing bgp`).",
    tools: routingBgpTools,
  },
  {
    label: "OSPF",
    slug: "routing-ospf",
    group: "Dynamic Routing",
    description:
      "OSPF instances, areas, ranges, interface-templates, neighbors and LSAs (`/routing ospf`).",
    tools: routingOspfTools,
  },
  {
    label: "RIP",
    slug: "routing-rip",
    group: "Dynamic Routing",
    description: "RIP instances, interface-templates, static + dynamic neighbors (`/routing rip`).",
    tools: routingRipTools,
  },
  {
    label: "PIM-SM",
    slug: "routing-pimsm",
    group: "Dynamic Routing",
    description:
      "PIM Sparse-Mode instances, interface-templates, RPs and neighbors (`/routing pimsm`).",
    tools: routingPimsmTools,
  },
  {
    label: "IGMP Proxy",
    slug: "routing-igmp-proxy",
    group: "Dynamic Routing",
    description: "IGMP proxy settings, interfaces and forwarding cache (`/routing igmp-proxy`).",
    tools: routingIgmpProxyTools,
  },
  {
    label: "GMP",
    slug: "routing-gmp",
    group: "Dynamic Routing",
    description:
      "Group Management Protocol (IGMP/MLD) interfaces and memberships (`/routing gmp`).",
    tools: routingGmpTools,
  },
  {
    label: "RPKI",
    slug: "routing-rpki",
    group: "Dynamic Routing",
    description: "RPKI validator sessions for BGP origin validation (`/routing rpki`).",
    tools: routingRpkiTools,
  },
  // ── Security ─────────────────────────────────────────────────────────────
  {
    label: "Firewall — Filter",
    slug: "firewall-filter",
    group: "Security",
    description: "Filter rules and a guided basic setup (`/ip firewall filter`).",
    tools: firewallFilterTools,
  },
  {
    label: "Firewall — NAT",
    slug: "firewall-nat",
    group: "Security",
    description: "NAT rules: src/dst-nat, masquerade, redirect (`/ip firewall nat`).",
    tools: firewallNatTools,
  },
  {
    label: "Address Lists",
    slug: "address-list",
    group: "Security",
    description: "Firewall address-lists (`/ip firewall address-list`).",
    tools: addressListTools,
  },
  {
    label: "Certificates",
    slug: "certificate",
    group: "Security",
    description: "X.509 certificate management (`/certificate`).",
    tools: certificateTools,
  },
  {
    label: "IP Services",
    slug: "ip-service",
    group: "Security",
    description: "Management service ports — ssh/www/api/telnet (`/ip service`).",
    tools: ipServiceTools,
  },
  {
    label: "802.1X — Server",
    slug: "dot1x-server",
    group: "Security",
    description:
      "802.1X authenticator: port-based access control via RADIUS (`/interface dot1x server`).",
    tools: dot1xServerTools,
  },
  {
    label: "802.1X — Client",
    slug: "dot1x-client",
    group: "Security",
    description:
      "802.1X supplicant: authenticate the device to an upstream port (`/interface dot1x client`).",
    tools: dot1xClientTools,
  },
  // ── VPN / tunneling ──────────────────────────────────────────────────────
  {
    label: "WireGuard",
    slug: "wireguard",
    group: "VPN & Tunneling",
    description: "WireGuard interfaces, peers and client-config generation.",
    tools: wireguardTools,
  },
  {
    label: "IPsec",
    slug: "ipsec",
    group: "VPN & Tunneling",
    description:
      "IPsec IKEv1/IKEv2: profiles, peers, identities, proposals, policies, SAs (`/ip ipsec`).",
    tools: ipsecTools,
  },
  {
    label: "PPP",
    slug: "ppp",
    group: "VPN & Tunneling",
    description: "Shared PPP backend: profiles, secrets, active sessions (`/ppp`).",
    tools: pppTools,
  },
  {
    label: "L2TP",
    slug: "l2tp",
    group: "VPN & Tunneling",
    description: "L2TP server + clients, incl. L2TP/IPsec (`/interface l2tp-*`).",
    tools: l2tpTools,
  },
  {
    label: "PPTP",
    slug: "pptp",
    group: "VPN & Tunneling",
    description: "PPTP server + clients (legacy) (`/interface pptp-*`).",
    tools: pptpTools,
  },
  {
    label: "SSTP",
    slug: "sstp",
    group: "VPN & Tunneling",
    description: "SSTP (TLS) server + clients (`/interface sstp-*`).",
    tools: sstpTools,
  },
  {
    label: "OpenVPN",
    slug: "openvpn",
    group: "VPN & Tunneling",
    description: "OpenVPN server + clients (`/interface ovpn-*`).",
    tools: openvpnTools,
  },
  {
    label: "Tunnels",
    slug: "tunnels",
    group: "VPN & Tunneling",
    description: "GRE, IPIP, EoIP and VXLAN tunnels (`/interface gre|ipip|eoip|vxlan`).",
    tools: tunnelTools,
  },
  // ── AAA (RADIUS / User Manager) ───────────────────────────────────────────
  {
    label: "RADIUS",
    slug: "radius",
    group: "AAA",
    description: "RADIUS client servers, incoming CoA, counters (`/radius`).",
    tools: radiusTools,
  },
  {
    label: "User Manager",
    slug: "user-manager",
    group: "AAA",
    description:
      "Built-in RADIUS server: users, profiles, routers (NAS), limitations, sessions (`/user-manager`).",
    tools: userManagerTools,
  },
  // ── QoS ──────────────────────────────────────────────────────────────────
  {
    label: "Queues / QoS",
    slug: "queue",
    group: "QoS",
    description: "Queue types, queue trees and simple queues (`/queue`).",
    tools: queueTools,
  },
  {
    label: "Queues — Interface",
    slug: "queue-interface",
    group: "QoS",
    description: "Per-interface queue-type assignment (`/queue interface`).",
    tools: queueInterfaceTools,
  },
  // ── System / operations ──────────────────────────────────────────────────
  {
    label: "Devices",
    slug: "devices",
    group: "System & Ops",
    description:
      "List the configured MikroTik devices the AI can target via the `device` argument.",
    tools: deviceTools,
  },
  {
    label: "System",
    slug: "system",
    group: "System & Ops",
    description: "Identity, resources, health, clock/NTP, packages, reboot/shutdown.",
    tools: systemTools,
  },
  {
    label: "System Config",
    slug: "system-config",
    group: "System & Ops",
    description:
      "Console, LEDs, license, note, NTP server, password, ports, regulatory, reset, special-login, watchdog.",
    tools: systemConfigTools,
  },
  {
    label: "Network Tools",
    slug: "network-tools",
    group: "System & Ops",
    description: "ping, traceroute, bandwidth-test, DNS resolve, netwatch (`/tool`).",
    tools: networkToolTools,
  },
  // ── Tools (`/tool`) ──────────────────────────────────────────────────────
  {
    label: "Btest Server",
    slug: "tool-bandwidth-server",
    group: "Tools",
    description: "Bandwidth-test server settings and sessions (`/tool bandwidth-server`).",
    tools: bandwidthServerTools,
  },
  {
    label: "Flood Ping",
    slug: "tool-flood-ping",
    group: "Tools",
    description: "ICMP flood ping with summary statistics (`/tool flood-ping`).",
    tools: floodPingTools,
  },
  {
    label: "Graphing",
    slug: "tool-graphing",
    group: "Tools",
    description: "Interface/queue/resource graphing rules (`/tool graphing`).",
    tools: graphingTools,
  },
  {
    label: "IP Scan",
    slug: "tool-ip-scan",
    group: "Tools",
    description: "Discover live hosts on a range or interface (`/tool ip-scan`).",
    tools: ipScanTools,
  },
  {
    label: "MAC Server",
    slug: "tool-mac-server",
    group: "Tools",
    description: "MAC-Telnet/MAC-Winbox/MAC-ping servers and sessions (`/tool mac-server`).",
    tools: macServerTools,
  },
  {
    label: "Packet Sniffer",
    slug: "tool-sniffer",
    group: "Tools",
    description:
      "Packet capture: settings, start/stop/save, captured hosts/protocols/packets (`/tool sniffer`).",
    tools: snifferTools,
  },
  {
    label: "Profile",
    slug: "tool-profile",
    group: "Tools",
    description: "CPU usage profiler by subsystem (`/tool profile`).",
    tools: profileTools,
  },
  {
    label: "RoMON",
    slug: "tool-romon",
    group: "Tools",
    description: "Router Management Overlay Network settings and ports (`/tool romon`).",
    tools: romonTools,
  },
  {
    label: "SMS",
    slug: "tool-sms",
    group: "Tools",
    description: "Send/receive SMS over an LTE modem (`/tool sms`).",
    tools: smsTools,
  },
  {
    label: "Speed Test",
    slug: "tool-speed-test",
    group: "Tools",
    description: "Latency/throughput test to another RouterOS (`/tool speed-test`).",
    tools: speedTestTools,
  },
  {
    label: "Traffic Generator",
    slug: "tool-traffic-generator",
    group: "Tools",
    description: "Synthetic traffic: ports, streams and run control (`/tool traffic-generator`).",
    tools: trafficGeneratorTools,
  },
  {
    label: "Traffic Monitor",
    slug: "tool-traffic-monitor",
    group: "Tools",
    description:
      "Run scripts when interface traffic crosses a threshold (`/tool traffic-monitor`).",
    tools: trafficMonitorTools,
  },
  {
    label: "Wake-on-LAN",
    slug: "tool-wol",
    group: "Tools",
    description: "Send Wake-on-LAN magic packets (`/tool wol`).",
    tools: wolTools,
  },
  {
    label: "Scheduler / Scripts",
    slug: "scheduler",
    group: "System & Ops",
    description: "Scheduled jobs and scripts (`/system scheduler`, `/system script`).",
    tools: schedulerTools,
  },
  {
    label: "Users",
    slug: "users",
    group: "System & Ops",
    description: "Users, groups, active sessions and SSH keys (`/user`).",
    tools: userTools,
  },
  {
    label: "Logs",
    slug: "logs",
    group: "System & Ops",
    description: "Log retrieval, search, statistics and export (`/log`).",
    tools: logTools,
  },
  {
    label: "Logging Config",
    slug: "logging",
    group: "System & Ops",
    description: "Logging rules + actions: where each topic is logged (`/system logging`).",
    tools: systemLoggingTools,
  },
  {
    label: "Backup",
    slug: "backup",
    group: "System & Ops",
    description: "Binary backups, text exports, file transfer and restore.",
    tools: backupTools,
  },
  {
    label: "S3 Backup",
    slug: "s3-backup",
    group: "System & Ops",
    description:
      "Optional: ship device backups/exports to S3-compatible storage, organised per device (`/tool fetch` + Bun S3).",
    tools: s3BackupTools,
  },
  {
    label: "Disk",
    slug: "disk",
    group: "System & Ops",
    description: "Storage devices: list/get disks and format-drive (`/disk`).",
    tools: diskTools,
  },
  {
    label: "Safe Mode",
    slug: "safe-mode",
    group: "System & Ops",
    description: "Transactional config window with auto-revert (Ctrl+X session).",
    tools: safeModeTools,
  },
  // ── Interactive views (MCP Apps) ─────────────────────────────────────────
  {
    label: "Apps — Dashboards",
    slug: "app-views",
    group: "MCP Apps",
    description:
      "Tools that render interactive UI views inline (MCP Apps): the device dashboard, " +
      "the interfaces overview and the firewall-rules table. Every read tool (list_*/get_*) " +
      "additionally renders in the generic records viewer.",
    tools: appViewTools,
  },
];

export const allToolModules: ToolModule[] = moduleCatalog.map((m) => m.tools);
