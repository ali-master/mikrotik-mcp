/** IP scan — `/tool ip-scan`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const ipScanTools: ToolModule = [
  defineTool({
    name: "ip_scan",
    title: "Scan IPv4 Range for Live Hosts",
    annotations: READ,
    description:
      "Actively probe an IPv4 address range or an interface's connected subnet for live hosts (`/tool ip-scan`). " +
      "Use this to discover which IPv4 addresses are reachable — the router sends active probes and collects " +
      "responding hosts' IP addresses, MAC addresses, round-trip times, and reverse-DNS names. " +
      "This is an active network scan, not a passive table read. " +
      "This server does not expose an IPv6 scan tool; for IPv6 neighbor-cache entries consult the IPv6 " +
      "neighbor table tools (`list_ipv6_neighbors`, `get_ipv6_neighbor`). " +
      "Returns a list of discovered live hosts (address, MAC, latency, DNS name), " +
      "or a notice that no hosts were found. " +
      "At least one of `address_range` or `interface` is required; both may be provided together. " +
      "`address_range` accepts a CIDR or range string (e.g. '192.168.1.0/24'); " +
      "`interface` names the interface whose connected subnet is scanned (e.g. 'ether1'); " +
      "`duration` (default 5) bounds the scan run in seconds.",
    inputSchema: {
      address_range: z.string().optional().describe("Range/CIDR to scan, e.g. '192.168.1.0/24'"),
      interface: z.string().optional().describe("Scan the subnet on this interface, e.g. 'ether1'"),
      duration: z
        .number()
        .int()
        .min(1)
        .default(5)
        .describe("Scan duration in seconds (bounds the run)"),
    },
    async handler(a, ctx) {
      if (!a.address_range && !a.interface)
        return "Provide address_range and/or interface to scan.";

      ctx.info(
        `IP scan (range=${a.address_range ?? "-"}, interface=${a.interface ?? "-"}, duration=${a.duration}s)`,
      );
      const cmd = new Cmd("/tool ip-scan")
        .opt("address-range", a.address_range)
        .opt("interface", a.interface)
        .set("duration", `${a.duration}s`)
        .build();
      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to run IP scan: ${result}`;
      return isEmpty(result) ? "IP scan completed; no hosts discovered." : `IP SCAN:\n\n${result}`;
    },
  }),
];
