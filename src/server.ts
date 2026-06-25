/**
 * Assembles the MCP server: a fresh `McpServer` with every tool and prompt
 * registered. Transports (stdio / streamable-http) wrap the result.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SendLog } from "./core/context";
import { registerTools } from "./core/registry";
import { registerUiResources } from "./core/ui-resources";
import { listDevices, getConfig } from "./core/runtime";
import { registerPrompts } from "./prompts";
import { selectToolModules } from "./tools";
import {
  VERSION,
  SERVER_NAME,
  SERVER_DESCRIPTION,
  SERVER_TITLE,
  WEBSITE_URL,
  LOGO_URL,
} from "./version";

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
discards. Prefer specific filters on list_* tools to keep output small.

Change workflow — ALWAYS take a restore point before a plan. Before calling
plan_changes or apply_plan (or any batch of write/destructive tools), first call
capture_config_snapshot to record the current configuration. These snapshots are
captured with \`/export\` (a read-only print — it does NOT create a file on the
router) and persisted to the MCP host's local database (~/.mikrotik-mcp/
snapshots.db), so they add ZERO load to the MikroTik device's disk and leave
nothing to clean up on the device. They survive device reboots/resets. After a
change, use diff_config_snapshots (from=latest, to=live) to confirm exactly what
changed, and if something is wrong, get_config_snapshot returns the prior
\`/export\` text to restore from. Do NOT use create_backup/create_export for this
pre-change restore point — those write files to the device's flash; prefer the
local snapshot to keep the device's disk clean.`;

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
  /** Number of MCP App `ui://` views registered as resources. */
  uiViewCount: number;
  /** True when only read-only tools were registered. */
  readOnly: boolean;
}

export function createServer(opts: { sendLog?: SendLog } = {}): CreatedServer {
  const { names, default: defaultDevice } = listDevices();
  const readOnly = getConfig().readOnly;
  const instructions =
    names.length > 1
      ? INSTRUCTIONS +
        MULTI_DEVICE_INSTRUCTIONS.replace("{{names}}", names.join(", ")).replace(
          "{{default}}",
          defaultDevice,
        )
      : INSTRUCTIONS;

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: VERSION,
      websiteUrl: WEBSITE_URL,
      title: SERVER_TITLE,
      description: SERVER_DESCRIPTION,
      icons: [
        {
          src: LOGO_URL,
          mimeType: "image/png",
          sizes: ["192x192"],
          theme: "light",
        },
      ],
    },
    {
      capabilities: {
        // Tools, prompts and resources are registered below. McpServer advertises
        // `listChanged: true` for each at registration; this catalog is static so
        // no list_changed notifications are actually emitted, but the SDK declares
        // the capability either way.
        tools: { listChanged: true },
        prompts: { listChanged: true },
        resources: { listChanged: true },
        // Structured log notifications (`notifications/message`): every tool
        // handler's ctx.info / ctx.error is forwarded to the client (wired via
        // `sendLog` just below). The SDK honours the client's `logging/setLevel`.
        logging: {},
      },
      instructions,
    },
  );

  // Make the advertised `logging` capability real: forward tool-handler
  // diagnostics (ctx.info / ctx.error) to the connected client as MCP log
  // notifications. Best-effort and fire-and-forget — the SDK no-ops when the
  // client has filtered the level out, and any failure is swallowed so logging
  // can never break a tool call. A caller may inject its own `sendLog` (e.g.
  // per-session HTTP transports or tests).
  const sendLog: SendLog =
    opts.sendLog ??
    ((level, message) => {
      try {
        void server.server.sendLoggingMessage({ level, data: message }).catch(() => {});
      } catch {
        /* logging is best-effort; never propagate into the tool call */
      }
    });

  // Curate the tool surface to the configured scopes (default: the full catalog)
  // so the client's tool-discovery search reliably surfaces every matching tool
  // on a several-hundred-tool server.
  const toolModules = selectToolModules(getConfig().tools);
  const toolCount = registerTools(server, toolModules, {
    sendLog,
    deviceNames: names,
    readOnly,
  });
  const promptCount = registerPrompts(server);
  // MCP App views (`ui://…`) — interactive dashboards rendered inline by hosts
  // that support the Apps extension (Claude, ChatGPT). Plain clients ignore them.
  const uiViewCount = registerUiResources(server);
  return { server, toolCount, promptCount, uiViewCount, readOnly };
}
