/** IP scan — `/tool ip-scan`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const ipScanTools: ToolModule = [
  defineTool({
    name: "ip_scan",
    title: "IP Scan",
    annotations: READ,
    description:
      "Scans an address range (or a connected interface's subnet) for live " +
      "hosts, returning addresses, MACs, response times and discovered DNS " +
      "names (`/tool ip-scan`). The run is bounded by `duration`.\n\n" +
      "Notes:\n" +
      "    Provide address_range, interface, or both. At least one is required.",
    inputSchema: {
      address_range: z
        .string()
        .optional()
        .describe("Range/CIDR to scan, e.g. '192.168.1.0/24'"),
      interface: z
        .string()
        .optional()
        .describe("Scan the subnet on this interface, e.g. 'ether1'"),
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
      return isEmpty(result)
        ? "IP scan completed; no hosts discovered."
        : `IP SCAN:\n\n${result}`;
    },
  }),
];
