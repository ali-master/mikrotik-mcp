/** stdio transport — the default; used by Claude Desktop and most MCP clients. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../server";
import { logger } from "../logger";

export async function runStdio(): Promise<void> {
  const { server, toolCount, promptCount } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`MCP server ready on stdio — ${toolCount} tools, ${promptCount} prompts`);
}
