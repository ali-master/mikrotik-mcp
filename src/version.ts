/**
 * Single source of truth for the server version.
 *
 * We read it from package.json at runtime (Bun can `import ... with { type: "json" }`)
 * so the npm version and the version advertised to MCP clients can never drift.
 */
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
export const WEBSITE_URL: string = pkg.homepage;
export const LOGO_URL: string = pkg.logoIcon;
export const SERVER_TITLE: string = pkg.name;
export const SERVER_DESCRIPTION: string = pkg.description;
export const SERVER_NAME = "mcp-mikrotik";
