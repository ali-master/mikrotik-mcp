/**
 * Root-cause analysis engine — pure analysis, zero device I/O.
 *
 * Receives diagnostic evidence collected across multiple dimensions (logs,
 * interfaces, routes, firewall, ARP/DHCP, system resources, connectivity)
 * and correlates it to produce a ranked list of probable root causes with
 * confidence levels, plain-language explanations, and fix commands.
 *
 * The tool layer (`src/tools/root-cause.ts`) handles all device interaction;
 * this module stays import-free of `connector.ts` so it's testable without a
 * live device.
 */

// ── Diagnostic dimensions ───────────────────────────────────────────────────

export type DiagnosticDimension =
  | "connectivity"
  | "interfaces"
  | "routing"
  | "firewall"
  | "nat"
  | "arp_dhcp"
  | "dns"
  | "resources"
  | "logs"
  | "vpn";

export const ALL_DIMENSIONS: DiagnosticDimension[] = [
  "connectivity",
  "interfaces",
  "routing",
  "firewall",
  "nat",
  "arp_dhcp",
  "dns",
  "resources",
  "logs",
  "vpn",
];

export const DIMENSION_LABELS: Record<DiagnosticDimension, string> = {
  connectivity: "Connectivity & Reachability",
  interfaces: "Interface State & Counters",
  routing: "Routing Table & Neighbors",
  firewall: "Firewall Rules & Hit Counters",
  nat: "NAT & Connection Tracking",
  arp_dhcp: "ARP / DHCP State",
  dns: "DNS Resolution",
  resources: "System Resources",
  logs: "System Logs & Events",
  vpn: "VPN / Tunnel State",
};

// ── Evidence types ──────────────────────────────────────────────────────────

export type EvidenceSeverity = "critical" | "warning" | "info" | "ok";

/** A single piece of diagnostic evidence from one dimension. */
export interface Evidence {
  dimension: DiagnosticDimension;
  severity: EvidenceSeverity;
  /** One-line finding. */
  summary: string;
  /** Additional detail or raw data. */
  detail?: string;
  /** Related RouterOS object (rule number, interface name, etc.). */
  reference?: string;
}

/** Raw diagnostic data collected by the tool layer. */
export interface DiagnosticData {
  /** Target being investigated (IP, hostname, or symptom description). */
  target: string;

  // ── Connectivity ──────────────────────────────────────────────────────
  ping?: { sent: number; received: number; lossPct: number; avgRtt?: number };
  traceroute?: string;

  // ── Interfaces ────────────────────────────────────────────────────────
  interfaces: InterfaceSnapshot[];

  // ── Routing ───────────────────────────────────────────────────────────
  routeCount: number;
  defaultRouteExists: boolean;
  activeRoutes: RouteSnapshot[];
  ospfNeighbors: RoutingNeighbor[];
  bgpPeers: RoutingNeighbor[];

  // ── Firewall ──────────────────────────────────────────────────────────
  /** Filter rules matching the target (by src/dst address). */
  matchingFilterRules: FirewallRuleSnapshot[];
  /** Total input/forward chain rule count. */
  filterRuleCount: number;

  // ── NAT ───────────────────────────────────────────────────────────────
  natRules: FirewallRuleSnapshot[];
  connectionCount: number;

  // ── ARP / DHCP ────────────────────────────────────────────────────────
  arpEntries: ArpEntry[];
  dhcpLeases: DhcpLease[];

  // ── DNS ───────────────────────────────────────────────────────────────
  dnsResolveResult?: string;
  dnsServers: string;
  dnsAllowRemote: boolean;

  // ── Resources ─────────────────────────────────────────────────────────
  cpuLoad: number;
  memoryUsedPct: number;
  uptime: string;
  rosVersion: string;

  // ── Logs ───────────────────────────────────────────────────────────────
  /** Recent log entries (last 10 minutes) that relate to the target/symptom. */
  relevantLogs: LogEntry[];

  // ── VPN / tunnels ─────────────────────────────────────────────────────
  tunnelInterfaces: InterfaceSnapshot[];
}

export interface InterfaceSnapshot {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  txBytes: number;
  rxBytes: number;
  txErrors: number;
  rxErrors: number;
  linkDowns: number;
  lastLinkDownTime?: string;
  mtu: number;
}

export interface RouteSnapshot {
  dst: string;
  gateway: string;
  distance: number;
  active: boolean;
  dynamic: boolean;
}

export interface RoutingNeighbor {
  id: string;
  address: string;
  state: string;
  interface: string;
  uptime?: string;
}

export interface FirewallRuleSnapshot {
  index: number;
  chain: string;
  action: string;
  srcAddress?: string;
  dstAddress?: string;
  protocol?: string;
  dstPort?: string;
  bytes: number;
  packets: number;
  disabled: boolean;
  comment?: string;
}

export interface ArpEntry {
  address: string;
  macAddress: string;
  interface: string;
  complete: boolean;
  dynamic: boolean;
}

export interface DhcpLease {
  address: string;
  macAddress: string;
  hostName: string;
  status: string;
  lastSeen?: string;
  server: string;
}

export interface LogEntry {
  time: string;
  topics: string;
  message: string;
}

// ── Root cause types ────────────────────────────────────────────────────────

export type Confidence = "high" | "medium" | "low";

export interface RootCause {
  /** Short label. */
  cause: string;
  /** Plain-language explanation of why this is likely the issue. */
  explanation: string;
  /** Confidence based on corroborating evidence. */
  confidence: Confidence;
  /** The evidence that supports this conclusion. */
  evidence: Evidence[];
  /** Exact RouterOS fix commands (when known). */
  fixes: string[];
  /** Affected dimension(s). */
  dimensions: DiagnosticDimension[];
}

export interface DiagnosisReport {
  target: string;
  timestamp: string;
  /** Collected evidence across all dimensions. */
  allEvidence: Evidence[];
  /** Ranked root causes (most likely first). */
  rootCauses: RootCause[];
  /** Per-dimension health summary. */
  dimensionSummary: { dimension: DiagnosticDimension; label: string; status: EvidenceSeverity }[];
}

// ── Analysis engine ─────────────────────────────────────────────────────────

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

/** Run the full root-cause analysis on collected diagnostic data. */
export function analyzeRootCause(data: DiagnosticData): DiagnosisReport {
  const evidence: Evidence[] = [];
  const rootCauses: RootCause[] = [];

  // ── 1. Connectivity analysis ──────────────────────────────────────────
  if (data.ping) {
    if (data.ping.lossPct === 100) {
      evidence.push({
        dimension: "connectivity",
        severity: "critical",
        summary: `Target ${data.target} is completely unreachable (100% packet loss)`,
        detail: `${data.ping.sent} packets sent, 0 received`,
      });
    } else if (data.ping.lossPct > 0) {
      evidence.push({
        dimension: "connectivity",
        severity: "warning",
        summary: `Partial packet loss to ${data.target}: ${data.ping.lossPct}%`,
        detail: `${data.ping.received}/${data.ping.sent} received`,
      });
    } else {
      evidence.push({
        dimension: "connectivity",
        severity: "ok",
        summary: `Target ${data.target} is reachable (0% loss)`,
      });
    }
  }

  // ── 2. Interface analysis ─────────────────────────────────────────────
  const downInterfaces = data.interfaces.filter((i) => !i.running && !i.disabled);
  const errorInterfaces = data.interfaces.filter((i) => i.txErrors > 0 || i.rxErrors > 0);
  const highLinkDowns = data.interfaces.filter((i) => i.linkDowns > 5);

  for (const iface of downInterfaces) {
    evidence.push({
      dimension: "interfaces",
      severity: "critical",
      summary: `Interface ${iface.name} is down (not running, not disabled)`,
      detail: `Type: ${iface.type}, link-downs: ${iface.linkDowns}`,
      reference: iface.name,
    });
  }

  for (const iface of errorInterfaces) {
    evidence.push({
      dimension: "interfaces",
      severity: "warning",
      summary: `Interface ${iface.name} has errors: TX=${iface.txErrors} RX=${iface.rxErrors}`,
      reference: iface.name,
    });
  }

  for (const iface of highLinkDowns) {
    if (!downInterfaces.includes(iface)) {
      evidence.push({
        dimension: "interfaces",
        severity: "warning",
        summary: `Interface ${iface.name} is flapping: ${iface.linkDowns} link-downs`,
        detail: iface.lastLinkDownTime ? `Last down: ${iface.lastLinkDownTime}` : undefined,
        reference: iface.name,
      });
    }
  }

  if (downInterfaces.length === 0 && errorInterfaces.length === 0) {
    evidence.push({
      dimension: "interfaces",
      severity: "ok",
      summary: `All ${data.interfaces.length} interfaces healthy`,
    });
  }

  // ── 3. Routing analysis ───────────────────────────────────────────────
  if (!data.defaultRouteExists) {
    evidence.push({
      dimension: "routing",
      severity: "critical",
      summary: "No default route — device cannot reach the internet",
    });
  } else {
    evidence.push({
      dimension: "routing",
      severity: "ok",
      summary: `Default route present, ${data.routeCount} total routes`,
    });
  }

  // OSPF neighbor issues
  const ospfDown = data.ospfNeighbors.filter((n) => n.state.toLowerCase() !== "full");
  for (const n of ospfDown) {
    evidence.push({
      dimension: "routing",
      severity: n.state.toLowerCase() === "init" ? "critical" : "warning",
      summary: `OSPF neighbor ${n.id} on ${n.interface} is ${n.state} (not Full)`,
      reference: n.id,
    });
  }

  // BGP peer issues
  const bgpDown = data.bgpPeers.filter((p) => !p.state.toLowerCase().includes("established"));
  for (const p of bgpDown) {
    evidence.push({
      dimension: "routing",
      severity: "critical",
      summary: `BGP peer ${p.address} is ${p.state} (not Established)`,
      reference: p.id,
    });
  }

  // ── 4. Firewall analysis ──────────────────────────────────────────────
  const blockingRules = data.matchingFilterRules.filter(
    (r) => !r.disabled && (r.action === "drop" || r.action === "reject") && r.packets > 0,
  );
  for (const rule of blockingRules) {
    evidence.push({
      dimension: "firewall",
      severity: "warning",
      summary: `Firewall rule #${rule.index} (${rule.chain}) is actively dropping traffic: ${rule.packets} packets`,
      detail: formatRule(rule),
      reference: `#${rule.index}`,
    });
  }

  if (blockingRules.length === 0 && data.matchingFilterRules.length > 0) {
    evidence.push({
      dimension: "firewall",
      severity: "ok",
      summary: `${data.matchingFilterRules.length} matching firewall rules — none actively blocking`,
    });
  }

  // ── 5. NAT analysis ──────────────────────────────────────────────────
  const masquerade = data.natRules.some((r) => r.action === "masquerade" && !r.disabled);
  const srcNat = data.natRules.some((r) => r.action === "src-nat" && !r.disabled);
  if (!masquerade && !srcNat && data.natRules.length > 0) {
    evidence.push({
      dimension: "nat",
      severity: "info",
      summary: "No masquerade/src-nat rule active — LAN clients may lack internet",
    });
  } else if (masquerade || srcNat) {
    evidence.push({
      dimension: "nat",
      severity: "ok",
      summary: "Source NAT/masquerade present",
    });
  }

  evidence.push({
    dimension: "nat",
    severity: "info",
    summary: `${data.connectionCount} active connection tracking entries`,
  });

  // ── 6. ARP / DHCP analysis ───────────────────────────────────────────
  const incompleteArp = data.arpEntries.filter((e) => !e.complete);
  if (incompleteArp.length > 0) {
    evidence.push({
      dimension: "arp_dhcp",
      severity: "warning",
      summary: `${incompleteArp.length} incomplete ARP entries — hosts not responding`,
      detail: incompleteArp
        .slice(0, 5)
        .map((e) => `${e.address} on ${e.interface}`)
        .join(", "),
    });
  }

  // DHCP exhaustion check
  const boundLeases = data.dhcpLeases.filter((l) => l.status === "bound");
  if (data.dhcpLeases.length > 0) {
    evidence.push({
      dimension: "arp_dhcp",
      severity: "ok",
      summary: `${boundLeases.length} active DHCP leases`,
    });
  }

  // Target-specific DHCP/ARP check
  if (isIpAddress(data.target)) {
    const lease = data.dhcpLeases.find((l) => l.address === data.target);
    const arp = data.arpEntries.find((e) => e.address === data.target);

    if (!lease && !arp) {
      evidence.push({
        dimension: "arp_dhcp",
        severity: "warning",
        summary: `Target ${data.target} has no DHCP lease and no ARP entry — device may be offline`,
      });
    } else if (arp && !arp.complete) {
      evidence.push({
        dimension: "arp_dhcp",
        severity: "warning",
        summary: `ARP entry for ${data.target} is incomplete — host not responding at L2`,
      });
    }
  }

  // ── 7. DNS analysis ──────────────────────────────────────────────────
  if (data.dnsResolveResult !== undefined) {
    if (!data.dnsResolveResult) {
      evidence.push({
        dimension: "dns",
        severity: "warning",
        summary: "DNS resolution failed",
        detail: `Servers: ${data.dnsServers || "none configured"}`,
      });
    } else {
      evidence.push({
        dimension: "dns",
        severity: "ok",
        summary: `DNS resolves to ${data.dnsResolveResult}`,
      });
    }
  }

  if (!data.dnsServers) {
    evidence.push({
      dimension: "dns",
      severity: "warning",
      summary: "No DNS servers configured",
    });
  }

  // ── 8. Resource analysis ──────────────────────────────────────────────
  if (data.cpuLoad > 90) {
    evidence.push({
      dimension: "resources",
      severity: "critical",
      summary: `CPU critically overloaded: ${data.cpuLoad}%`,
    });
  } else if (data.cpuLoad > 70) {
    evidence.push({
      dimension: "resources",
      severity: "warning",
      summary: `CPU under pressure: ${data.cpuLoad}%`,
    });
  } else {
    evidence.push({
      dimension: "resources",
      severity: "ok",
      summary: `CPU load: ${data.cpuLoad}%`,
    });
  }

  if (data.memoryUsedPct > 90) {
    evidence.push({
      dimension: "resources",
      severity: "critical",
      summary: `Memory critically low: ${data.memoryUsedPct}% used`,
    });
  } else if (data.memoryUsedPct > 75) {
    evidence.push({
      dimension: "resources",
      severity: "warning",
      summary: `Memory pressure: ${data.memoryUsedPct}% used`,
    });
  } else {
    evidence.push({
      dimension: "resources",
      severity: "ok",
      summary: `Memory: ${data.memoryUsedPct}% used`,
    });
  }

  // ── 9. Log analysis ──────────────────────────────────────────────────
  const errorLogs = data.relevantLogs.filter(
    (l) =>
      l.topics.includes("error") || l.topics.includes("critical") || l.topics.includes("warning"),
  );
  const firewallLogs = data.relevantLogs.filter((l) => l.topics.includes("firewall"));
  const authLogs = data.relevantLogs.filter(
    (l) =>
      l.message.toLowerCase().includes("login") ||
      l.message.toLowerCase().includes("denied") ||
      l.message.toLowerCase().includes("failed"),
  );

  if (errorLogs.length > 0) {
    evidence.push({
      dimension: "logs",
      severity: "warning",
      summary: `${errorLogs.length} error/warning log entries in the last 10 minutes`,
      detail: errorLogs
        .slice(0, 3)
        .map((l) => `[${l.time}] ${l.topics}: ${l.message}`)
        .join("\n"),
    });
  }

  if (firewallLogs.length > 0) {
    evidence.push({
      dimension: "logs",
      severity: "info",
      summary: `${firewallLogs.length} firewall log entries — traffic being logged/blocked`,
    });
  }

  if (authLogs.length > 0) {
    evidence.push({
      dimension: "logs",
      severity: "warning",
      summary: `${authLogs.length} authentication-related log entries`,
      detail: authLogs
        .slice(0, 3)
        .map((l) => `[${l.time}] ${l.message}`)
        .join("\n"),
    });
  }

  if (errorLogs.length === 0 && firewallLogs.length === 0) {
    evidence.push({
      dimension: "logs",
      severity: "ok",
      summary: "No concerning log entries in the last 10 minutes",
    });
  }

  // ── 10. VPN / tunnel analysis ─────────────────────────────────────────
  const downTunnels = data.tunnelInterfaces.filter((t) => !t.running && !t.disabled);
  for (const t of downTunnels) {
    evidence.push({
      dimension: "vpn",
      severity: "critical",
      summary: `Tunnel ${t.name} (${t.type}) is down`,
      reference: t.name,
    });
  }

  if (data.tunnelInterfaces.length > 0 && downTunnels.length === 0) {
    evidence.push({
      dimension: "vpn",
      severity: "ok",
      summary: `All ${data.tunnelInterfaces.length} tunnel(s) running`,
    });
  }

  // ── Correlate evidence into root causes ───────────────────────────────
  correlateRootCauses(data, evidence, rootCauses);

  // Sort: high confidence first
  rootCauses.sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]);

  // Build dimension summary
  const dimensionSummary = ALL_DIMENSIONS.map((dim) => {
    const dimEvidence = evidence.filter((e) => e.dimension === dim);
    let status: EvidenceSeverity = "ok";
    if (dimEvidence.some((e) => e.severity === "critical")) status = "critical";
    else if (dimEvidence.some((e) => e.severity === "warning")) status = "warning";
    else if (dimEvidence.length === 0) status = "info";
    return { dimension: dim, label: DIMENSION_LABELS[dim], status };
  });

  return {
    target: data.target,
    timestamp: new Date().toISOString(),
    allEvidence: evidence,
    rootCauses,
    dimensionSummary,
  };
}

// ── Correlation engine ──────────────────────────────────────────────────────

function correlateRootCauses(
  data: DiagnosticData,
  evidence: Evidence[],
  causes: RootCause[],
): void {
  const criticals = evidence.filter((e) => e.severity === "critical");
  const warnings = evidence.filter((e) => e.severity === "warning");

  // ── Pattern: Interface down → connectivity loss
  const downIfaces = data.interfaces.filter((i) => !i.running && !i.disabled);
  if (downIfaces.length > 0 && data.ping?.lossPct === 100) {
    causes.push({
      cause: "Interface link failure",
      explanation:
        `Interface(s) ${downIfaces.map((i) => i.name).join(", ")} are down. ` +
        "This is the most likely cause of complete connectivity loss. Check physical " +
        "cables, SFP modules, and remote switch ports.",
      confidence: "high",
      evidence: evidence.filter((e) => e.dimension === "interfaces" && e.severity === "critical"),
      fixes: downIfaces.map((i) => `/interface enable [find name="${i.name}"]`),
      dimensions: ["interfaces", "connectivity"],
    });
  }

  // ── Pattern: No default route → no internet
  if (!data.defaultRouteExists) {
    const relEvidence = evidence.filter(
      (e) => e.dimension === "routing" && e.severity === "critical",
    );
    causes.push({
      cause: "Missing default route",
      explanation:
        "No default route (0.0.0.0/0) is present in the routing table. " +
        "Without a default route, the device cannot reach any destination outside " +
        "its directly connected networks. This commonly occurs after a WAN interface " +
        "goes down or a DHCP client loses its lease.",
      confidence: data.ping?.lossPct === 100 ? "high" : "medium",
      evidence: relEvidence,
      fixes: [
        "# Check WAN interface DHCP client:",
        "/ip dhcp-client print",
        "# Or add a static default route:",
        '/ip route add dst-address=0.0.0.0/0 gateway=<WAN-GATEWAY-IP> comment="default route"',
      ],
      dimensions: ["routing"],
    });
  }

  // ── Pattern: OSPF neighbors down → routing convergence failure
  const ospfDown = data.ospfNeighbors.filter((n) => n.state.toLowerCase() !== "full");
  if (ospfDown.length > 0) {
    causes.push({
      cause: "OSPF adjacency failure",
      explanation:
        `${ospfDown.length} OSPF neighbor(s) are not in Full state: ` +
        `${ospfDown.map((n) => `${n.id} (${n.state})`).join(", ")}. ` +
        "This prevents route exchange and can cause reachability loss to remote networks.",
      confidence: ospfDown.length > 1 ? "high" : "medium",
      evidence: evidence.filter((e) => e.dimension === "routing" && e.severity !== "ok"),
      fixes: [
        "/routing ospf neighbor print detail",
        "/routing ospf interface-template print detail",
      ],
      dimensions: ["routing"],
    });
  }

  // ── Pattern: BGP peers down → route loss
  const bgpDown = data.bgpPeers.filter((p) => !p.state.toLowerCase().includes("established"));
  if (bgpDown.length > 0) {
    causes.push({
      cause: "BGP session failure",
      explanation:
        `${bgpDown.length} BGP peer(s) not established: ` +
        `${bgpDown.map((p) => `${p.address} (${p.state})`).join(", ")}. ` +
        "This can cause loss of learned routes and reachability to advertised networks.",
      confidence: "high",
      evidence: evidence.filter((e) => e.dimension === "routing" && e.severity === "critical"),
      fixes: ["/routing bgp session print", "/routing bgp connection print detail"],
      dimensions: ["routing"],
    });
  }

  // ── Pattern: Firewall dropping target traffic
  const blockingRules = data.matchingFilterRules.filter(
    (r) => !r.disabled && (r.action === "drop" || r.action === "reject") && r.packets > 0,
  );
  if (blockingRules.length > 0) {
    const isTarget100Loss = data.ping?.lossPct === 100;
    causes.push({
      cause: "Firewall blocking traffic",
      explanation:
        `${blockingRules.length} firewall rule(s) are actively dropping packets ` +
        `matching the target. Rule(s): ${blockingRules
          .map((r) => `#${r.index} (${r.chain}, ${r.packets} pkts)`)
          .join(", ")}. Review whether these rules are intentional or overly broad.`,
      confidence: isTarget100Loss ? "high" : "medium",
      evidence: evidence.filter((e) => e.dimension === "firewall" && e.severity !== "ok"),
      fixes: blockingRules.map((r) => `/ip firewall filter disable [find where .id=${r.index}]`),
      dimensions: ["firewall"],
    });
  }

  // ── Pattern: No NAT → LAN clients can't reach internet
  const hasMasq = data.natRules.some(
    (r) => (r.action === "masquerade" || r.action === "src-nat") && !r.disabled,
  );
  if (!hasMasq && data.ping?.lossPct === 100 && data.defaultRouteExists) {
    causes.push({
      cause: "Missing source NAT / masquerade",
      explanation:
        "The default route exists but no masquerade or src-nat rule is active. " +
        "LAN clients' private IPs are not being translated, so return traffic from " +
        "the internet has no path back. Add a masquerade rule on the WAN interface.",
      confidence: "medium",
      evidence: evidence.filter((e) => e.dimension === "nat"),
      fixes: [
        '/ip firewall nat add chain=srcnat action=masquerade out-interface=<WAN> comment="masquerade LAN"',
      ],
      dimensions: ["nat"],
    });
  }

  // ── Pattern: DNS failure → name resolution broken
  if (data.dnsResolveResult === "") {
    causes.push({
      cause: "DNS resolution failure",
      explanation:
        "DNS queries are failing. This could be caused by missing DNS servers, " +
        "an unreachable upstream DNS, or a firewall rule blocking UDP/53.",
      confidence: data.dnsServers ? "medium" : "high",
      evidence: evidence.filter((e) => e.dimension === "dns"),
      fixes: data.dnsServers
        ? ["/ip dns print", `/ping ${data.dnsServers.split(",")[0].trim()} count=3`]
        : ["/ip dns set servers=1.1.1.1,8.8.8.8"],
      dimensions: ["dns"],
    });
  }

  // ── Pattern: CPU/memory exhaustion → general degradation
  if (data.cpuLoad > 90 || data.memoryUsedPct > 90) {
    const metric =
      data.cpuLoad > 90 && data.memoryUsedPct > 90
        ? "CPU and memory"
        : data.cpuLoad > 90
          ? "CPU"
          : "Memory";
    causes.push({
      cause: `${metric} exhaustion`,
      explanation:
        `The device's ${metric.toLowerCase()} is critically overloaded ` +
        `(CPU: ${data.cpuLoad}%, memory: ${data.memoryUsedPct}% used). ` +
        "This can cause packet drops, connection timeouts, and general service degradation.",
      confidence: data.ping && data.ping.lossPct > 0 ? "medium" : "low",
      evidence: evidence.filter((e) => e.dimension === "resources" && e.severity !== "ok"),
      fixes: [
        "/system resource print",
        "/tool profile cpu=all duration=5",
        "/ip firewall connection print count-only",
      ],
      dimensions: ["resources"],
    });
  }

  // ── Pattern: ARP incomplete → L2 issue
  if (isIpAddress(data.target)) {
    const arp = data.arpEntries.find((e) => e.address === data.target);
    if (arp && !arp.complete && data.ping?.lossPct === 100) {
      causes.push({
        cause: "ARP resolution failure (Layer 2)",
        explanation:
          `The ARP entry for ${data.target} is incomplete — the device is not responding ` +
          `to ARP requests on interface ${arp.interface}. This indicates a Layer 2 issue: ` +
          "the target device may be powered off, on a different VLAN, or the cable is disconnected.",
        confidence: "high",
        evidence: evidence.filter((e) => e.dimension === "arp_dhcp" && e.severity !== "ok"),
        fixes: [`/ping ${data.target} count=3`, `/ip arp print where address="${data.target}"`],
        dimensions: ["arp_dhcp"],
      });
    }
  }

  // ── Pattern: Tunnel down → VPN connectivity loss
  const downTunnels = data.tunnelInterfaces.filter((t) => !t.running && !t.disabled);
  if (downTunnels.length > 0) {
    causes.push({
      cause: "VPN/tunnel interface down",
      explanation:
        `Tunnel(s) ${downTunnels.map((t) => `${t.name} (${t.type})`).join(", ")} are down. ` +
        "Traffic destined for remote networks over these tunnels will be black-holed.",
      confidence: "high",
      evidence: evidence.filter((e) => e.dimension === "vpn" && e.severity === "critical"),
      fixes: downTunnels.map((t) => `/interface enable [find name="${t.name}"]`),
      dimensions: ["vpn"],
    });
  }

  // ── Pattern: Interface flapping → intermittent loss
  const flapping = data.interfaces.filter((i) => i.linkDowns > 5 && i.running);
  if (flapping.length > 0 && data.ping && data.ping.lossPct > 0 && data.ping.lossPct < 100) {
    causes.push({
      cause: "Interface link flapping",
      explanation:
        `Interface(s) ${flapping.map((i) => `${i.name} (${i.linkDowns} link-downs)`).join(", ")} ` +
        "show excessive link transitions. This causes intermittent packet loss as the " +
        "link repeatedly goes up and down. Check cables, SFPs, and switch port settings.",
      confidence: "medium",
      evidence: evidence.filter((e) => e.dimension === "interfaces" && e.severity === "warning"),
      fixes: flapping.map((i) => `/interface monitor ${i.name} once`),
      dimensions: ["interfaces", "connectivity"],
    });
  }

  // ── Fallback: no strong root cause found
  if (causes.length === 0 && criticals.length === 0 && warnings.length === 0) {
    causes.push({
      cause: "No anomalies detected",
      explanation:
        "All diagnostic dimensions appear healthy. The issue may be transient, " +
        "external to this device, or require deeper inspection of specific traffic flows.",
      confidence: "low",
      evidence: [],
      fixes: [],
      dimensions: [],
    });
  } else if (causes.length === 0 && (criticals.length > 0 || warnings.length > 0)) {
    causes.push({
      cause: "Multiple anomalies — manual investigation needed",
      explanation:
        `Found ${criticals.length} critical and ${warnings.length} warning indicators ` +
        "but no single clear root cause pattern. Review the evidence below and " +
        "investigate the critical findings first.",
      confidence: "low",
      evidence: [...criticals, ...warnings],
      fixes: [],
      dimensions: [...new Set([...criticals, ...warnings].map((e) => e.dimension))],
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isIpAddress(s: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s);
}

function formatRule(r: FirewallRuleSnapshot): string {
  const parts = [`chain=${r.chain}`, `action=${r.action}`];
  if (r.srcAddress) parts.push(`src=${r.srcAddress}`);
  if (r.dstAddress) parts.push(`dst=${r.dstAddress}`);
  if (r.protocol) parts.push(`proto=${r.protocol}`);
  if (r.dstPort) parts.push(`port=${r.dstPort}`);
  parts.push(`pkts=${r.packets}`);
  if (r.comment) parts.push(`"${r.comment}"`);
  return parts.join(" ");
}

// ── Report renderer ─────────────────────────────────────────────────────────

export function renderDiagnosisReport(report: DiagnosisReport, device: string): string {
  const lines: string[] = [];

  lines.push("╔═══════════════════════════════════════════════════════════════╗");
  lines.push("║            INTELLIGENT ROOT-CAUSE ANALYSIS                  ║");
  lines.push("╚═══════════════════════════════════════════════════════════════╝");
  lines.push("");
  lines.push(`  Device:    ${device}`);
  lines.push(`  Target:    ${report.target}`);
  lines.push(`  Time:      ${report.timestamp}`);
  lines.push("");

  // Dimension health matrix
  lines.push("── DIAGNOSTIC DIMENSIONS ──────────────────────────────────────");
  for (const dim of report.dimensionSummary) {
    const icon =
      dim.status === "ok"
        ? " OK "
        : dim.status === "critical"
          ? "CRIT"
          : dim.status === "warning"
            ? "WARN"
            : "INFO";
    lines.push(`  ${icon}  ${dim.label}`);
  }
  lines.push("");

  // Root causes
  if (report.rootCauses.length > 0) {
    lines.push("── ROOT CAUSE ANALYSIS ────────────────────────────────────────");
    for (let i = 0; i < report.rootCauses.length; i++) {
      const rc = report.rootCauses[i];
      const conf = rc.confidence.toUpperCase();
      lines.push("");
      lines.push(`  #${i + 1} [${conf} CONFIDENCE] ${rc.cause}`);
      lines.push(`     ${rc.explanation}`);

      if (rc.evidence.length > 0) {
        lines.push("     Evidence:");
        for (const e of rc.evidence.slice(0, 5)) {
          lines.push(`       - ${e.summary}`);
        }
      }

      if (rc.fixes.length > 0) {
        lines.push("     Fix commands:");
        for (const f of rc.fixes) {
          lines.push(`       ${f}`);
        }
      }
    }
    lines.push("");
  }

  // All evidence (detailed)
  lines.push("── EVIDENCE LOG ───────────────────────────────────────────────");
  for (const e of report.allEvidence) {
    const sev =
      e.severity === "ok"
        ? " OK "
        : e.severity === "critical"
          ? "CRIT"
          : e.severity === "warning"
            ? "WARN"
            : "INFO";
    lines.push(
      `  ${sev}  [${DIMENSION_LABELS[e.dimension].substring(0, 16).padEnd(16)}]  ${e.summary}`,
    );
    if (e.detail) {
      for (const dl of e.detail.split("\n")) {
        lines.push(`        ${dl}`);
      }
    }
  }

  return lines.join("\n");
}
