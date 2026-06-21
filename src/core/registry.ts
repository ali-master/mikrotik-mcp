/**
 * Tool declaration + registration layer.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ZodRawShape } from "zod";
import { createContext } from "./context";
import type { ToolContext, SendLog } from "./context";
import { containsRawParserError } from "./routeros";
import { buildRecordsView } from "./routeros-parse";
import { toolUiMeta, uiViewUri } from "./ui-meta";
import type { UiLink } from "./ui-meta";
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
  /** Configured device names; when more than one, a `device` selector is injected. */
  deviceNames?: string[];
  /**
   * Read-only mode: register only tools annotated `readOnlyHint`. Used to
   * withhold every write/destructive tool from a publicly-exposed surface (e.g.
   * a ChatGPT Apps connector) until authentication is in place.
   */
  readOnly?: boolean;
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
    register(server: McpServer, opts: RegisterOptions = {}) {
      const { sendLog, deviceNames } = opts;
      const multiDevice = !!deviceNames && deviceNames.length > 1;
      // Resolve the view once: explicit `ui` or the auto `records` view for reads.
      const { ui, auto } = effectiveUi(def);

      // When more than one device is configured, every tool gains an optional
      // `device` selector (a validated enum of the configured names) so the AI
      // can target a specific router per call. Single-device setups are untouched.
      const inputSchema = multiDevice
        ? {
            ...def.inputSchema,
            device: z
              .enum(deviceNames as [string, ...string[]])
              .optional()
              .describe(
                `Which configured MikroTik device to run this on. One of: ${deviceNames.join(", ")}. Omit to use the default device.`,
              ),
          }
        : def.inputSchema;

      const risk = riskOf(def.annotations);
      const callback = async (args: Record<string, unknown>): Promise<CallToolResult> => {
        // Peel the injected selector off before handing args to the handler.
        const { device, ...rest } = args as { device?: unknown };
        const deviceName = typeof device === "string" ? device : undefined;
        const ctx = createContext(sendLog, deviceName);
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
          // Backstop: if a handler returned a raw RouterOS parser error (an
          // unsupported/mistyped command on this device/version), surface it as a
          // real error instead of a success-looking result.
          if (containsRawParserError(out.text)) {
            ctx.error(`Device rejected the command: ${out.text.trim()}`);
            isErr = true;
            errMsg = out.text.trim();
            return { content: [{ type: "text", text: out.text }], isError: true };
          }
          // For an auto-attached records view, derive structured rows from the
          // handler's text so the table/detail view has data — unless the
          // handler already supplied its own `structuredContent`.
          if (auto && !out.structuredContent) {
            out.structuredContent = buildRecordsView(
              def.name,
              def.title,
              out.text,
              new Date().toISOString(),
            ) as unknown as Record<string, unknown>;
          }
          const result: CallToolResult = {
            content: [{ type: "text", text: out.text }],
          };
          // Structured data for the UI view (ignored by text-only hosts).
          if (out.structuredContent) {
            result.structuredContent = out.structuredContent;
            hasStructured = true;
          }
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.error(msg);
          isErr = true;
          errMsg = msg;
          outText = `Error: ${msg}`;
          return {
            content: [{ type: "text", text: `Error: ${msg}` }],
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
