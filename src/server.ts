/**
 * Assembles the MCP server: a fresh `McpServer` with every tool and prompt
 * registered. Transports (stdio / streamable-http) wrap the result.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import type { SendLog } from "./core/context";
import { registerTools } from "./core/registry";
import { registerUiResources } from "./core/ui-resources";
import { listDevices, deviceDirectory, deviceLabels, getConfig } from "./core/runtime";
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
      capabilities: {},
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
    // Friendly labels (descriptions) are accepted as device aliases too, so the
    // AI can target e.g. "Ali Home" as well as the config key "home".
    deviceAliases: deviceLabels(),
    // A key → label → target directory so the `device` selector can list each
    // router unambiguously and the model won't confuse e.g. "Ali Home" with "home".
    deviceDirectory: deviceDirectory(),
    readOnly,
  });
  const promptCount = registerPrompts(server);
  // MCP App views (`ui://…`) — interactive dashboards rendered inline by hosts
  // that support the Apps extension (Claude, ChatGPT). Plain clients ignore them.
  const uiViewCount = registerUiResources(server);
  // Optionally paginate `tools/list` so a very large catalog (several hundred
  // tools) ships in client-friendly pages WITHOUT disabling any tool.
  installToolPagination(server, getConfig().mcp.toolPageSize);
  return { server, toolCount, promptCount, uiViewCount, readOnly };
}

/**
 * Deliver the full tool catalog in cursor-paginated pages. A no-op when
 * `pageSize <= 0` (the entire catalog ships in one `tools/list` response — the
 * default, unchanged behaviour). When set, EVERY tool is still served — just
 * split across pages so clients that choke on one huge response can load them
 * all. The SDK's own handler computes the normalised list once (the tool set is
 * fixed after startup); we cache it and slice per cursor.
 */
function installToolPagination(server: McpServer, pageSize: number): void {
  if (pageSize <= 0) return;
  const low = server.server as unknown as {
    _requestHandlers?: Map<string, (req: unknown, extra: unknown) => Promise<ListToolsResult>>;
  };
  const sdkHandler = low._requestHandlers?.get("tools/list");
  if (typeof sdkHandler !== "function") return;

  let cache: ListToolsResult["tools"] | null = null;
  server.server.setRequestHandler(
    ListToolsRequestSchema,
    async (request, extra): Promise<ListToolsResult> => {
      // The full, schema-normalised catalog is fixed after startup — compute it
      // once via the SDK's own handler, then serve cursor-delimited slices.
      if (!cache) cache = (await sdkHandler(request, extra)).tools ?? [];
      const total = cache.length;
      const cursor = request.params?.cursor;
      let start = 0;
      if (typeof cursor === "string") {
        const n = Number.parseInt(cursor, 10);
        start = Number.isFinite(n) && n > 0 ? Math.min(n, total) : 0;
      }
      const tools = cache.slice(start, start + pageSize);
      const end = start + tools.length;
      return end < total ? { tools, nextCursor: String(end) } : { tools };
    },
  );
}
