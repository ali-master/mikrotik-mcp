/**
 * Assembles the MCP server: a fresh `McpServer` with every tool and prompt
 * registered. Transports (stdio / streamable-http) wrap the result.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SendLog } from "./core/context";
import { registerTools } from "./core/registry";
import { listDevices } from "./core/runtime";
import { registerPrompts } from "./prompts";
import { allToolModules } from "./tools";
import { VERSION, SERVER_NAME } from "./version";

const INSTRUCTIONS = `MikroTik RouterOS management over SSH.

This server exposes RouterOS configuration as MCP tools grouped by subsystem:
interfaces, IP addressing, DHCP, DNS, firewall (filter + NAT), routing, VLANs,
wireless, WireGuard, queues/QoS, users, logs, backups, PoE, system, network
tools, bridges, address-lists, scheduler/scripts and certificates.

Safety model — tools are annotated by risk:
  • readOnlyHint     → inspection only, no changes
  • destructiveHint  → removes or replaces configuration
Before a batch of risky changes, consider enable_safe_mode: RouterOS then holds
every change in memory and auto-reverts if the session drops, so a mistake that
locks you out is undone automatically. commit_safe_mode persists; rollback
discards. Prefer specific filters on list_* tools to keep output small.`;

const MULTI_DEVICE_INSTRUCTIONS = `

Multiple devices are configured: {{names}} (default: {{default}}). Every tool
accepts an optional "device" argument to choose which router it runs on; omit it
to use the default. Use list_mikrotik_devices to see them. For cross-device work
(e.g. a tunnel between two routers) configure each side by passing the matching
"device", then verify reachability with ping/traceroute from each end.`;

export interface CreatedServer {
  server: McpServer;
  toolCount: number;
  promptCount: number;
}

export function createServer(opts: { sendLog?: SendLog } = {}): CreatedServer {
  const { names, default: defaultDevice } = listDevices();
  const instructions =
    names.length > 1
      ? INSTRUCTIONS +
        MULTI_DEVICE_INSTRUCTIONS.replace("{{names}}", names.join(", ")).replace(
          "{{default}}",
          defaultDevice,
        )
      : INSTRUCTIONS;

  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    {
      capabilities: { tools: {}, prompts: {}, logging: {} },
      instructions,
    },
  );

  const toolCount = registerTools(server, allToolModules, {
    sendLog: opts.sendLog,
    deviceNames: names,
  });
  const promptCount = registerPrompts(server);
  return { server, toolCount, promptCount };
}
