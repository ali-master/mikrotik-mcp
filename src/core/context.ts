/**
 * ToolContext is the lightweight per-call logging surface handed to every tool
 * handler — the TypeScript analog of FastMCP's `Context` object in the Python
 * server (`ctx.info()` / `ctx.error()`).
 *
 * Diagnostic messages are written to stderr (never stdout, which the stdio
 * transport reserves for JSON-RPC) and, when the MCP client has opted into
 * logging notifications, forwarded over the protocol too.
 */
import { logger } from "../logger";

export interface ToolContext {
  /** Informational progress message. */
  info: (message: string) => void;
  /** Error / failure message. */
  error: (message: string) => void;
}

export type SendLog = (level: "info" | "error", message: string) => void;

/**
 * Build a context. `sendLog`, when provided, forwards messages to the connected
 * MCP client as logging notifications in addition to the local stderr log.
 */
export function createContext(sendLog?: SendLog): ToolContext {
  return {
    info(message: string) {
      logger.info(message);
      sendLog?.("info", message);
    },
    error(message: string) {
      logger.error(message);
      sendLog?.("error", message);
    },
  };
}
