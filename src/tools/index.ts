/**
 * The complete tool catalog — the single source of truth for both the server
 * (which registers `allToolModules`) and the doc/schema generators (which read
 * the labels and descriptions from `moduleCatalog`). Add a module in exactly one
 * place: here.
 */
import type { ToolModule } from "../core/registry";

import { addressListTools } from "./address-list";
import { backupTools } from "./backup";
import { bridgeTools } from "./bridge";
import { certificateTools } from "./certificate";
import { deviceTools } from "./devices";
import { dhcpTools } from "./dhcp";
import { diskTools } from "./disk";
import { dnsTools } from "./dns";
import { firewallFilterTools } from "./firewall-filter";
import { firewallNatTools } from "./firewall-nat";
import { interfaceTools } from "./interfaces";
import { ipAddressTools } from "./ip-address";
import { ipPoolTools } from "./ip-pool";
import { ipServiceTools } from "./ip-service";
import { ipv6AddressTools } from "./ipv6-address";
import { ipv6DhcpClientTools } from "./ipv6-dhcp-client";
import { ipv6DhcpRelayTools } from "./ipv6-dhcp-relay";
import { ipsecTools } from "./ipsec";
import { l2tpTools } from "./l2tp";
import { logTools } from "./logs";
import { systemLoggingTools } from "./logging";
import { networkToolTools } from "./network-tools";
import { openvpnTools } from "./openvpn";
import { poeTools } from "./poe";
import { pppTools } from "./ppp";
import { pptpTools } from "./pptp";
import { queueTools } from "./queue";
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
    description:
      "Bridges, ports, host table and bridge VLANs (`/interface bridge`).",
    tools: bridgeTools,
  },
  {
    label: "Wireless",
    slug: "wireless",
    group: "Interfaces",
    description:
      "Wireless interfaces, security profiles and access lists (legacy + wifiwave2).",
    tools: wirelessTools,
  },
  {
    label: "PoE",
    slug: "poe",
    group: "Interfaces",
    description:
      "Power-over-Ethernet status and configuration (`/interface ethernet poe`).",
    tools: poeTools,
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
    description:
      "Static routes, routing table, route checks and cache (`/ip route`).",
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
    description:
      "DHCPv6 client: address/prefix delegation requests (`/ipv6 dhcp-client`).",
    tools: ipv6DhcpClientTools,
  },
  {
    label: "DHCPv6 Relay",
    slug: "ipv6-dhcp-relay",
    group: "IPv6",
    description:
      "DHCPv6 relay: forward client requests to upstream servers (`/ipv6 dhcp-relay`).",
    tools: ipv6DhcpRelayTools,
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
    description:
      "Resolved recursive next-hop table, read-only diagnostics (`/routing nexthop`).",
    tools: routingNexthopTools,
  },
  {
    label: "Routing Filters",
    slug: "routing-filter",
    group: "Dynamic Routing",
    description:
      "Route filter rules, select-rules and num-lists (`/routing filter`).",
    tools: routingFilterTools,
  },
  {
    label: "BFD",
    slug: "routing-bfd",
    group: "Dynamic Routing",
    description:
      "Bidirectional Forwarding Detection config + sessions (`/routing bfd`).",
    tools: routingBfdTools,
  },
  {
    label: "BGP",
    slug: "routing-bgp",
    group: "Dynamic Routing",
    description:
      "BGP connections, templates, sessions and advertisements (`/routing bgp`).",
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
    description:
      "RIP instances, interface-templates, static + dynamic neighbors (`/routing rip`).",
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
    description:
      "IGMP proxy settings, interfaces and forwarding cache (`/routing igmp-proxy`).",
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
    description:
      "RPKI validator sessions for BGP origin validation (`/routing rpki`).",
    tools: routingRpkiTools,
  },
  // ── Security ─────────────────────────────────────────────────────────────
  {
    label: "Firewall — Filter",
    slug: "firewall-filter",
    group: "Security",
    description:
      "Filter rules and a guided basic setup (`/ip firewall filter`).",
    tools: firewallFilterTools,
  },
  {
    label: "Firewall — NAT",
    slug: "firewall-nat",
    group: "Security",
    description:
      "NAT rules: src/dst-nat, masquerade, redirect (`/ip firewall nat`).",
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
    description:
      "Management service ports — ssh/www/api/telnet (`/ip service`).",
    tools: ipServiceTools,
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
    description:
      "Shared PPP backend: profiles, secrets, active sessions (`/ppp`).",
    tools: pppTools,
  },
  {
    label: "L2TP",
    slug: "l2tp",
    group: "VPN & Tunneling",
    description:
      "L2TP server + clients, incl. L2TP/IPsec (`/interface l2tp-*`).",
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
    description:
      "GRE, IPIP, EoIP and VXLAN tunnels (`/interface gre|ipip|eoip|vxlan`).",
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
    description:
      "Identity, resources, health, clock/NTP, packages, reboot/shutdown.",
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
    description:
      "ping, traceroute, bandwidth-test, DNS resolve, netwatch (`/tool`).",
    tools: networkToolTools,
  },
  {
    label: "Scheduler / Scripts",
    slug: "scheduler",
    group: "System & Ops",
    description:
      "Scheduled jobs and scripts (`/system scheduler`, `/system script`).",
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
    description:
      "Logging rules + actions: where each topic is logged (`/system logging`).",
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
    description:
      "Transactional config window with auto-revert (Ctrl+X session).",
    tools: safeModeTools,
  },
];

export const allToolModules: ToolModule[] = moduleCatalog.map((m) => m.tools);
