/**
 * MCP App views — tools that render an interactive UI inline in the host.
 *
 * These are ordinary {@link defineTool} tools with a `ui` link, so they appear
 * in the catalog and inherit device routing, the parser-error backstop, etc.
 * Each returns a `structuredContent` payload the view renders, plus a `text`
 * summary so text-only clients still get a useful answer.
 */
import { executeMikrotikCommand } from "../core/connector";
import type { ToolContext } from "../core/context";
import { READ, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { resolveDeviceName } from "../core/runtime";
import { looksLikeError, isEmpty } from "../core/routeros";
import { parseKeyValues, parseLeadingNumber, parseSizeToBytes } from "../core/routeros-parse";
import { uiViewUri } from "../core/ui-resources";

/** Run a single-record `print` and return its parsed key/values (or {} on error). */
async function printRecord(cmd: string, ctx: ToolContext): Promise<Record<string, string>> {
  const out = await executeMikrotikCommand(cmd, ctx);
  if (looksLikeError(out) || isEmpty(out)) return {};
  return parseKeyValues(out);
}

/** Percentage (0-100, 1 decimal) of `used`/`total`, or null when unknown. */
function pct(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null;
  return Math.round((used / total) * 1000) / 10;
}

export const appViewTools: ToolModule = [
  defineTool({
    name: "show_system_dashboard",
    title: "Device Dashboard",
    annotations: READ,
    ui: { resourceUri: uiViewUri("dashboard") },
    description:
      "Shows a live device health dashboard (CPU, memory, disk, uptime, " +
      "temperature/voltage, board and RouterOS version) as an interactive view. " +
      "Use this when the user wants an at-a-glance overview of a MikroTik device.",
    async handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`Building system dashboard for '${device}'`);

      const [identity, resource, health, routerboard] = await Promise.all([
        printRecord("/system identity print", ctx),
        printRecord("/system resource print", ctx),
        printRecord("/system health print", ctx),
        printRecord("/system routerboard print", ctx),
      ]);

      const memTotal = parseSizeToBytes(resource["total-memory"]);
      const memFree = parseSizeToBytes(resource["free-memory"]);
      const memUsed = memTotal !== null && memFree !== null ? memTotal - memFree : null;
      const hddTotal = parseSizeToBytes(resource["total-hdd-space"]);
      const hddFree = parseSizeToBytes(resource["free-hdd-space"]);
      const hddUsed = hddTotal !== null && hddFree !== null ? hddTotal - hddFree : null;

      const derived = {
        cpuLoadPct: parseLeadingNumber(resource["cpu-load"]),
        memUsedBytes: memUsed,
        memTotalBytes: memTotal,
        memUsedPct: pct(memUsed, memTotal),
        hddUsedBytes: hddUsed,
        hddTotalBytes: hddTotal,
        hddUsedPct: pct(hddUsed, hddTotal),
        temperatureC:
          parseLeadingNumber(health.temperature) ?? parseLeadingNumber(health["cpu-temperature"]),
        voltageV: parseLeadingNumber(health.voltage),
      };

      const structuredContent = {
        device,
        identity: identity.name ?? device,
        resource,
        health,
        routerboard,
        derived,
        generatedAt: new Date().toISOString(),
      };

      // Compact text fallback for text-only hosts.
      const name = structuredContent.identity;
      const ver = resource.version ?? "?";
      const board = routerboard.model ?? resource["board-name"] ?? "?";
      const mem = derived.memUsedPct !== null ? `${derived.memUsedPct}% mem` : "mem n/a";
      const cpu = derived.cpuLoadPct !== null ? `${derived.cpuLoadPct}% CPU` : "CPU n/a";
      const text =
        `DEVICE DASHBOARD — ${name} (${device})\n\n` +
        `Board: ${board}\nRouterOS: ${ver}\nUptime: ${resource.uptime ?? "?"}\n${cpu}, ${mem}${
          derived.temperatureC !== null ? `, ${derived.temperatureC}°C` : ""
        }\n\n(Rendered as an interactive dashboard in hosts that support MCP Apps.)`;

      return { text, structuredContent };
    },
  }),
];
