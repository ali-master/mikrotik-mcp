/**
 * Tool declaration + registration layer.
 *
 * `defineTool()` is the TypeScript counterpart of the Python `@mcp.tool(...)`
 * decorator. It pairs a Zod input schema (validation + auto-generated JSON
 * Schema) with one of the shared *risk presets* (READ / WRITE / DESTRUCTIVE …)
 * so MCP clients can reason about each tool's blast radius, and wraps the
 * handler so every tool returns the protocol's `{ content: [...] }` shape and
 * funnels failures through a single error path.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import {   createContext } from "./context";
import type {ToolContext, SendLog} from "./context";

// ── Behaviour presets (MCP §Tool Annotations) ──────────────────────────────
/** Read-only, side-effect free, repeatable. */
export const READ: ToolAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
/** Creates/changes state; not inherently destructive; not idempotent. */
export const WRITE: ToolAnnotations = { destructiveHint: false, openWorldHint: false };
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
export const DANGEROUS: ToolAnnotations = { destructiveHint: true, openWorldHint: false };

export interface ToolDef<Shape extends ZodRawShape> {
  /** Stable tool id exposed to MCP clients (snake_case, matches the Python names). */
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
  register: (server: McpServer, sendLog?: SendLog) => void;
}

export function defineTool<Shape extends ZodRawShape>(def: ToolDef<Shape>): RegisterableTool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    annotations: def.annotations,
    inputSchema: def.inputSchema,
    register(server: McpServer, sendLog?: SendLog) {
      const callback = async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const ctx = createContext(sendLog);
        try {
          const text = await def.handler(args, ctx);
          return { content: [{ type: "text", text }] };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.error(msg);
          return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
        }
      };

      server.registerTool(
        def.name,
        {
          title: def.title,
          description: def.description,
          inputSchema: def.inputSchema,
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
export function registerTools(server: McpServer, modules: ToolModule[], sendLog?: SendLog): number {
  let count = 0;
  const seen = new Set<string>();
  for (const mod of modules) {
    for (const tool of mod) {
      if (seen.has(tool.name)) {
        throw new Error(`Duplicate tool name registered: ${tool.name}`);
      }
      seen.add(tool.name);
      tool.register(server, sendLog);
      count++;
    }
  }
  return count;
}
