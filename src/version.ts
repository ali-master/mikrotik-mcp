/**
 * Single source of truth for the server version.
 *
 * We read it from package.json at runtime (Bun can `import ... with { type: "json" }`)
 * so the npm version and the version advertised to MCP clients can never drift.
 */
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
export const SERVER_NAME = "mcp-mikrotik";
