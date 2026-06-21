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
import {
  parseFlagLegend,
  parseKeyValues,
  parseLeadingNumber,
  parseRecords,
  parseSizeToBytes,
} from "../core/routeros-parse";
import { uiViewUri } from "../core/ui-resources";

/** Run a single-record `print` and return its parsed key/values (or {} on error). */
async function printRecord(cmd: string, ctx: ToolContext): Promise<Record<string, string>> {
  const out = await executeMikrotikCommand(cmd, ctx);
  if (looksLikeError(out) || isEmpty(out)) return {};
  return parseKeyValues(out);
}

/** Run a multi-record `print detail` and return parsed rows + the flag legend. */
async function printRows(
  cmd: string,
  ctx: ToolContext,
): Promise<{ rows: Record<string, string>[]; flags: Record<string, string> }> {
  const out = await executeMikrotikCommand(cmd, ctx);
  if (looksLikeError(out) || isEmpty(out)) return { rows: [], flags: {} };
  return { rows: parseRecords(out).rows, flags: parseFlagLegend(out) };
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

      // Sequential, not Promise.all: each printRecord opens its own fresh SSH
      // connection, and firing four at once can exhaust a router's concurrent
      // SSH session limit — some connections then return empty, leaving the
      // dashboard fields blank. One connection at a time is reliable (and a
      // device overview is not latency-critical).
      const identity = await printRecord("/system identity print", ctx);
      const resource = await printRecord("/system resource print", ctx);
      const health = await printRecord("/system health print", ctx);
      const routerboard = await printRecord("/system routerboard print", ctx);

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

  defineTool({
    name: "show_interfaces",
    title: "Interfaces Overview",
    annotations: READ,
    ui: { resourceUri: uiViewUri("interfaces"), visibility: ["model", "app"] },
    description:
      "Shows all interfaces as an interactive overview: per-port running/disabled " +
      "status, type, MTU and MAC address, with live refresh. Use this when the user " +
      "wants a visual at-a-glance view of the device's interfaces.",
    async handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`Building interfaces overview for '${device}'`);

      const { rows, flags } = await printRows("/interface print detail", ctx);
      const structuredContent = {
        __mikrotikView: "interfaces" as const,
        device,
        rows,
        flags,
        generatedAt: new Date().toISOString(),
      };

      const running = rows.filter((r) => (r.flags ?? "").includes("R")).length;
      const disabled = rows.filter((r) => (r.flags ?? "").includes("X")).length;
      const text = `INTERFACES — ${device}\n\n${rows.length} interface(s): ${running} running, ${disabled} disabled.\n${rows
        .slice(0, 40)
        .map((r) => `  • ${r.name ?? "?"} (${r.type ?? "?"})${r.flags ? ` [${r.flags}]` : ""}`)
        .join("\n")}\n\n(Rendered as an interactive overview in hosts that support MCP Apps.)`;

      return { text, structuredContent };
    },
  }),

  defineTool({
    name: "show_firewall_filter",
    title: "Firewall Rules",
    annotations: READ,
    ui: { resourceUri: uiViewUri("firewall"), visibility: ["model", "app"] },
    description:
      "Shows the IP firewall filter rules as an interactive, ordered table: chain, " +
      "action, key matchers and packet/byte counters, with enabled/disabled state and " +
      "live refresh. Use this when the user wants to review the firewall ruleset visually.",
    async handler(_a, ctx) {
      const device = resolveDeviceName(ctx.device);
      ctx.info(`Building firewall overview for '${device}'`);

      const { rows, flags } = await printRows("/ip firewall filter print detail", ctx);
      const structuredContent = {
        __mikrotikView: "firewall" as const,
        device,
        chain: "filter",
        rows,
        flags,
        generatedAt: new Date().toISOString(),
      };

      const disabled = rows.filter((r) => (r.flags ?? "").includes("X")).length;
      const byChain = rows.reduce<Record<string, number>>((acc, r) => {
        const c = r.chain ?? "?";
        acc[c] = (acc[c] ?? 0) + 1;
        return acc;
      }, {});
      const chainSummary = Object.entries(byChain)
        .map(([c, n]) => `${c}=${n}`)
        .join(", ");
      const text =
        `FIREWALL FILTER RULES — ${device}\n\n` +
        `${rows.length} rule(s)${chainSummary ? ` (${chainSummary})` : ""}, ${disabled} disabled.\n\n` +
        "(Rendered as an interactive table in hosts that support MCP Apps.)";

      return { text, structuredContent };
    },
  }),
];
