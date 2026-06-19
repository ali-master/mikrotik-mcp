/**
 * Assembles the MCP server: a fresh `McpServer` with every tool and prompt
 * registered. Transports (stdio / streamable-http) wrap the result.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SendLog } from "./core/context";
import { registerTools } from "./core/registry";
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

export interface CreatedServer {
  server: McpServer;
  toolCount: number;
  promptCount: number;
}

export function createServer(opts: { sendLog?: SendLog } = {}): CreatedServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    {
      capabilities: { tools: {}, prompts: {}, logging: {} },
      instructions: INSTRUCTIONS,
    },
  );

  const toolCount = registerTools(server, allToolModules, opts.sendLog);
  const promptCount = registerPrompts(server);
  return { server, toolCount, promptCount };
}
