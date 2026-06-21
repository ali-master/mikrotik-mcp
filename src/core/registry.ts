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

/** Options threaded into every tool registration. */
export interface RegisterOptions {
  sendLog?: SendLog;
  /** Configured device names; when more than one, a `device` selector is injected. */
  deviceNames?: string[];
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
  /** Handler returning the textual result shown to the model. */
  handler: (args: any, ctx: ToolContext) => Promise<string> | string;
}

export interface RegisterableTool {
  name: string;
  title: string;
  annotations: ToolAnnotations;
  inputSchema?: ZodRawShape;
  description: string;
  register: (server: McpServer, opts?: RegisterOptions) => void;
}

export function defineTool<Shape extends ZodRawShape>(def: ToolDef<Shape>): RegisterableTool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    annotations: def.annotations,
    inputSchema: def.inputSchema,
    register(server: McpServer, opts: RegisterOptions = {}) {
      const { sendLog, deviceNames } = opts;
      const multiDevice = !!deviceNames && deviceNames.length > 1;

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

      const callback = async (args: Record<string, unknown>): Promise<CallToolResult> => {
        // Peel the injected selector off before handing args to the handler.
        const { device, ...rest } = args as { device?: unknown };
        const ctx = createContext(sendLog, typeof device === "string" ? device : undefined);
        try {
          const text = await def.handler(rest, ctx);
          // Backstop: if a handler returned a raw RouterOS parser error (an
          // unsupported/mistyped command on this device/version), surface it as a
          // real error instead of a success-looking result.
          if (containsRawParserError(text)) {
            ctx.error(`Device rejected the command: ${text.trim()}`);
            return { content: [{ type: "text", text }], isError: true };
          }
          return { content: [{ type: "text", text }] };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.error(msg);
          return {
            content: [{ type: "text", text: `Error: ${msg}` }],
            isError: true,
          };
        }
      };

      server.registerTool(
        def.name,
        {
          title: def.title,
          description: def.description,
          inputSchema,
          annotations: { ...def.annotations, title: def.title },
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
      tool.register(server, opts);
      count++;
    }
  }
  return count;
}
