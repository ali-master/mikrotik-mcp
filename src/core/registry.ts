/**
 * Tool declaration + registration layer.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ZodRawShape } from "zod";
import { createContext } from "./context";
import type { ToolContext, SendLog } from "./context";
import { containsRawParserError, indicatesFailure } from "./routeros";
import { buildRecordsView } from "./routeros-parse";
import { toolUiMeta, uiViewUri } from "./ui-meta";
import type { UiLink } from "./ui-meta";
import { resolvedTarget } from "./runtime";
import type { DeviceDirectoryEntry } from "./runtime";
import { riskOf } from "../observability/event";
import { isRecording, recordToolCall } from "../observability/recorder";

/**
 * Read tools whose names start with one of these verbs render their output in
 * the generic `records` MCP App view automatically (a table for lists, detail
 * cards for a single record). This is what gives every `list_*`/`get_*` base
 * tool an interactive UI without each handler opting in by hand — the registry
 * attaches the view and derives `structuredContent` from the handler's text.
 */
const AUTO_RECORDS_VERB = /^(list|get|show|print)_/;

/**
 * Permissive output schema attached to EXPLICIT MCP App tools. The ext-apps
 * examples always pair `_meta.ui` with an `outputSchema` so the host recognises
 * the tool as a structured-output widget and reliably delivers
 * `structuredContent` to the view. Our app-view payloads vary by tool, so this
 * is an open object (`additionalProperties` allowed) that validates any payload
 * without stripping it.
 */
const UI_OUTPUT_SCHEMA = z.object({}).passthrough();

/**
 * The effective UI view for a tool: an explicit `ui` always wins; otherwise a
 * read tool with a matching verb gets the shared `records` view. `visibility`
 * includes `app` so the rendered view can call the tool back to refresh.
 */
function effectiveUi(def: { name: string; annotations: ToolAnnotations; ui?: UiLink }): {
  ui: UiLink | undefined;
  auto: boolean;
} {
  if (def.ui) return { ui: def.ui, auto: false };
  if (def.annotations.readOnlyHint === true && AUTO_RECORDS_VERB.test(def.name)) {
    return { ui: { resourceUri: uiViewUri("records"), visibility: ["model", "app"] }, auto: true };
  }
  return { ui: undefined, auto: false };
}

/** Options threaded into every tool registration. */
export interface RegisterOptions {
  sendLog?: SendLog;
  /** Configured device KEYS; when more than one, a `device` selector is injected. */
  deviceNames?: string[];
  /**
   * Extra accepted values for the `device` selector — a device's free-text
   * label (`description`, e.g. "Ali Home") so the AI can target it by the
   * friendly name as well as its config key. Resolved back to the key by
   * {@link resolveDeviceName}. Does NOT affect the single-vs-multi decision.
   */
  deviceAliases?: string[];
  /**
   * Human-facing directory of every device (key → label → target), used to make
   * the `device` selector's description unambiguous so the model can tell
   * similarly-named routers apart and never substitute one for another.
   */
  deviceDirectory?: DeviceDirectoryEntry[];
  /**
   * Emit MCP App view metadata (`_meta.ui`) on tools. Default true. Set false for
   * hosts whose tool discovery hides/deprioritises tools that carry App/
   * `openai/outputTemplate` metadata — without it, every `list_*`/`get_*` read
   * tool gains the auto-records view and some clients then surface only the
   * (metadata-free) write tools. Disabling makes reads plain, surfacing tools.
   */
  appViews?: boolean;
  /**
   * Read-only mode: register only tools annotated `readOnlyHint`. Used to
   * withhold every write/destructive tool from a publicly-exposed surface (e.g.
   * a ChatGPT Apps connector) until authentication is in place.
   */
  readOnly?: boolean;
}

/**
 * Build the `device` selector's description. When a device directory is
 * available it lists each router as `key ("label") → host:port [default]` so the
 * model can tell similarly-named devices apart (e.g. "Ali Home" @ 45.87.6.144 vs
 * "home" @ 192.168.7.1) and is explicitly told to match the user's wording
 * exactly and never substitute one device for another.
 */
function deviceSelectorDescription(
  selectorNames: string[],
  directory?: DeviceDirectoryEntry[],
): string {
  if (directory && directory.length > 0) {
    const rows = directory
      .map(
        (d) =>
          `• ${d.key}${d.label && d.label !== d.key ? ` ("${d.label}")` : ""} → ${d.target}${
            d.isDefault ? " [default]" : ""
          }`,
      )
      .join("\n");
    return (
      "Which configured MikroTik device to run this on. Pass the EXACT config key (or its label) " +
      "that matches the user's wording — these are different physical routers, so never substitute " +
      'one for another (e.g. "Ali Home" is NOT "home"). Configured devices:\n' +
      `${rows}\n` +
      "Omit only when the user did not name a device (uses the default)."
    );
  }
  return (
    `Which configured MikroTik device to run this on. One of: ${selectorNames.join(", ")} ` +
    "(a config key or its label). Omit to use the default device."
  );
}

// ── Behaviour presets (MCP §Tool Annotations) ──────────────────────────────
/** Read-only, side-effect free, repeatable. */
export const READ: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
/** Creates/changes state; not inherently destructive; not idempotent. */
export const WRITE: ToolAnnotations = {
  destructiveHint: false,
  openWorldHint: false,
};
/** Changes state but converges to the same result if repeated (set/enable/disable). */
export const WRITE_IDEMPOTENT: ToolAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
/** Removes/replaces state; repeating is safe (the target is already gone). */
export const DESTRUCTIVE: ToolAnnotations = {
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
/** High blast radius and not safely repeatable (restore, import, factory setup). */
export const DANGEROUS: ToolAnnotations = {
  destructiveHint: true,
  openWorldHint: false,
};

/**
 * A handler may return plain text (the common case — wrapped as the model-facing
 * result) or a structured payload. `structuredContent` is the data an MCP App
 * view renders; `text` remains the fallback shown to the model and to text-only
 * hosts, so UI is always additive.
 */
export interface ToolResult {
  text: string;
  structuredContent?: Record<string, unknown>;
}

export type HandlerOutput = string | ToolResult;

export interface ToolDef<Shape extends ZodRawShape> {
  /** Stable tool id exposed to MCP clients. */
  name: string;
  /** Short human-readable display name shown in compact tool lists. */
  title: string;
  /** Full description — this is the prompt the model reads to decide when to call. */
  description: string;
  /** One of the risk presets above. */
  annotations: ToolAnnotations;
  /** Zod raw shape describing the tool's parameters. */
  inputSchema?: Shape;
  /**
   * Optional MCP App view: links this tool to a `ui://…` HTML resource the host
   * renders inline. When set, the tool should return `structuredContent` for the
   * view (it still returns `text` for non-UI hosts).
   */
  ui?: UiLink;
  /** Handler returning the result shown to the model (text, or text + structured data). */
  handler: (args: any, ctx: ToolContext) => Promise<HandlerOutput> | HandlerOutput;
}

export interface RegisterableTool {
  name: string;
  title: string;
  annotations: ToolAnnotations;
  inputSchema?: ZodRawShape;
  description: string;
  /** Present when the tool renders an MCP App view. */
  ui?: UiLink;
  /**
   * The raw handler (pre-`device`-injection, pre-validation). Exposed so the
   * tool-gateway dispatcher (`invoke_tool`) can run any tool by name through its
   * own Zod schema + handler — the precise alternative to the raw-CLI escape
   * hatch. Normal registration never touches this; it goes through `register`.
   */
  handler: (args: any, ctx: ToolContext) => Promise<HandlerOutput> | HandlerOutput;
  register: (server: McpServer, opts?: RegisterOptions) => void;
}

export function defineTool<Shape extends ZodRawShape>(def: ToolDef<Shape>): RegisterableTool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    annotations: def.annotations,
    inputSchema: def.inputSchema,
    ui: def.ui,
    handler: def.handler,
    register(server: McpServer, opts: RegisterOptions = {}) {
      const { sendLog, deviceNames, deviceAliases, deviceDirectory, appViews } = opts;
      // The single-vs-multi decision is keyed on the device COUNT, never the
      // enum size — a lone device that happens to have a label must not gain a
      // selector.
      const multiDevice = !!deviceNames && deviceNames.length > 1;
      // Resolve the view once: explicit `ui` or the auto `records` view for reads.
      // When App views are disabled, no tool carries `_meta.ui` — read tools
      // become plain tools so hosts that hide App-metadata tools still surface them.
      const { ui, auto } = appViews === false ? { ui: undefined, auto: false } : effectiveUi(def);

      // When more than one device is configured, every tool gains an optional
      // `device` selector (a validated enum) so the AI can target a specific
      // router per call. The enum accepts both config keys AND friendly labels
      // (descriptions); both resolve to a key in resolveDeviceName/getDevice.
      // Single-device setups are untouched.
      const selectorNames =
        multiDevice && deviceNames ? [...new Set([...deviceNames, ...(deviceAliases ?? [])])] : [];
      const inputSchema = multiDevice
        ? {
            ...def.inputSchema,
            device: z
              .enum(selectorNames as [string, ...string[]])
              .optional()
              .describe(deviceSelectorDescription(selectorNames, deviceDirectory)),
          }
        : def.inputSchema;

      const risk = riskOf(def.annotations);
      const callback = async (args: Record<string, unknown>): Promise<CallToolResult> => {
        // Peel the injected selector off before handing args to the handler.
        const { device, ...rest } = args as { device?: unknown };
        const deviceName = typeof device === "string" ? device : undefined;
        const ctx = createContext(sendLog, deviceName);
        // For state-changing tools on a multi-device server, stamp the result
        // with the exact router this call hit — per-call proof of targeting so
        // the model can trust writes (the live device map is fixed for the
        // process; it can't silently swap mid-session). Reads stay unstamped.
        const deviceStamp =
          multiDevice && risk !== "READ"
            ? (() => {
                const t = resolvedTarget(deviceName);
                const label = t.label && t.label !== t.key ? ` "${t.label}"` : "";
                const how = deviceName === undefined ? " — DEFAULT (no device specified)" : "";
                return `↳ executed on device: ${t.key}${label}${how} → ${t.target}`;
              })()
            : null;
        // Observability: capture timing + outcome for the dashboard (no-op when
        // the dashboard is disabled). Tracked across try/catch, emitted in finally.
        const startedAt = Date.now();
        let outText = "";
        let isErr = false;
        let errMsg: string | undefined;
        let hasStructured = false;
        try {
          const raw = await def.handler(rest, ctx);
          // Normalize: a plain string is just text; an object may also carry
          // `structuredContent` for an MCP App view.
          const out = typeof raw === "string" ? { text: raw } : raw;
          outText = out.text;
          // Backstop: if a handler returned a raw RouterOS parser error or a
          // flattened "Failed to …:" device-error string, surface it as a real
          // error instead of a success-looking result — so the host and the
          // observability dashboard's status column reflect the failure.
          if (containsRawParserError(out.text) || indicatesFailure(out.text)) {
            ctx.error(`Tool reported a failure: ${out.text.trim()}`);
            isErr = true;
            errMsg = out.text.trim();
            return { content: [{ type: "text", text: out.text }], isError: true };
          }
          // For an auto-attached records view, derive structured rows from the
          // handler's text so the table/detail view has data — unless the
          // handler already supplied its own `structuredContent`.
          //
          // Only attach the widget when the output actually parsed into ROWS. A
          // non-tabular read — e.g. a "no PoE-out hardware" message, a "not
          // found" reply, or any single sentence — yields zero rows; rendering a
          // blank records widget there makes the host show "rendered an
          // interactive widget" and SUPPRESS the real text answer, so the user
          // sees an empty table and the model loses the message. In that case we
          // fall back to plain text (no widget) so the answer stays visible.
          if (auto && !out.structuredContent) {
            const view = buildRecordsView(def.name, def.title, out.text, new Date().toISOString());
            if (view.rows.length > 0) {
              out.structuredContent = view as unknown as Record<string, unknown>;
            }
          }
          const result: CallToolResult = {
            content: [{ type: "text", text: out.text }],
          };
          // Structured data for the UI view (ignored by text-only hosts).
          if (out.structuredContent) {
            result.structuredContent = out.structuredContent;
            hasStructured = true;
          }
          if (deviceStamp) result.content.push({ type: "text", text: deviceStamp });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.error(msg);
          isErr = true;
          errMsg = msg;
          outText = `Error: ${msg}`;
          return {
            content: [
              { type: "text", text: `Error: ${msg}` },
              ...(deviceStamp ? [{ type: "text" as const, text: deviceStamp }] : []),
            ],
            isError: true,
          };
        } finally {
          if (isRecording()) {
            recordToolCall({
              tool: def.name,
              title: def.title,
              risk,
              device: deviceName,
              ts: startedAt,
              durationMs: Date.now() - startedAt,
              isError: isErr,
              error: errMsg,
              args: rest,
              output: outText,
              hasStructured,
            });
          }
        }
      };

      server.registerTool(
        def.name,
        {
          title: def.title,
          description: def.description,
          inputSchema,
          annotations: { ...def.annotations, title: def.title },
          // When the tool has an MCP App view (explicit, or the auto records view
          // for reads), advertise the `ui://` resource so the host can preload and
          // render it (Claude + ChatGPT compatible).
          ...(ui ? { _meta: toolUiMeta(ui) } : {}),
          // Explicit app-view tools also declare an output schema (matching the
          // ext-apps examples) so the host treats them as structured-output
          // widgets. NOT applied to the auto-records view: that one omits
          // `structuredContent` for non-tabular reads, and the SDK throws if an
          // output schema is declared but a success result has no structured
          // content.
          ...(ui && !auto ? { outputSchema: UI_OUTPUT_SCHEMA } : {}),
        },
        // The SDK derives the callback's arg type from `inputSchema`; our
        // dynamic registry erases that generic, so we assert the known-correct
        // shape here. Runtime behaviour is exactly the validated args object.
        callback as never,
      );
    },
  };
}

export type ToolModule = RegisterableTool[];

/** Register every tool from every module, returning the total count. */
export function registerTools(
  server: McpServer,
  modules: ToolModule[],
  opts: RegisterOptions = {},
): number {
  let count = 0;
  const seen = new Set<string>();
  for (const mod of modules) {
    for (const tool of mod) {
      if (seen.has(tool.name)) {
        throw new Error(`Duplicate tool name registered: ${tool.name}`);
      }
      seen.add(tool.name);
      // In read-only mode, withhold anything that isn't explicitly read-only.
      if (opts.readOnly && tool.annotations.readOnlyHint !== true) continue;
      tool.register(server, opts);
      count++;
    }
  }
  return count;
}
