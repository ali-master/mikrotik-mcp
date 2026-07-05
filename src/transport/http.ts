/**
 * Streamable-HTTP (and legacy SSE) transport on Bun's native `Bun.serve`.
 *
 * The SDK ships a Web-standard transport whose `handleRequest(Request)` returns
 * a `Response`, which slots directly into `Bun.serve` with no Node `http` shim.
 *
 * DNS-rebinding protection is reconciled with the actual bind host the same way
 * the Bun server did: a localhost bind gets a secure localhost
 * allowlist; an explicit allowlist is honored; binding to a public interface
 * with no allowlist disables the Host check (with a loud warning) so a reverse
 * proxy doesn't get every request rejected with HTTP 421.
 */
import { randomUUID } from "node:crypto";
import { serve } from "bun";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServerSettings } from "../config";
import { getConfig } from "../core/runtime";
import { checkForUpdate } from "../core/update-check";
import { corsHeaders } from "./cors";
import { logger } from "../logger";
import { createServer } from "../server";
import { VERSION } from "../version";

const LOCALHOST = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);

interface SecuritySettings {
  enableDnsRebindingProtection: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
}

function buildSecurity(mcp: McpServerSettings): SecuritySettings {
  const hosts = mcp.allowedHosts
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const origins = mcp.allowedOrigins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (hosts.includes("*")) {
    logger.warn(
      "DNS-rebinding protection is DISABLED (allowed-hosts=*). Ensure the server is only reachable by trusted clients.",
    );
    return { enableDnsRebindingProtection: false };
  }
  if (hosts.length || origins.length) {
    logger.info(
      `DNS-rebinding protection enabled for hosts=[${hosts.join(",")}] origins=[${origins.join(",")}]`,
    );
    return {
      enableDnsRebindingProtection: true,
      allowedHosts: hosts,
      allowedOrigins: origins,
    };
  }
  if (LOCALHOST.has(mcp.host) && mcp.host !== "0.0.0.0") {
    return {
      enableDnsRebindingProtection: true,
      allowedHosts: ["127.0.0.1:*", "localhost:*", "[::1]:*"],
      allowedOrigins: ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"],
    };
  }
  logger.warn(
    `Serving HTTP on a non-localhost host (${mcp.host}) without an allow-list, so DNS-rebinding ` +
      "protection is disabled. Behind a reverse proxy, set --mcp-allowed-hosts to your domain.",
  );
  return { enableDnsRebindingProtection: false };
}

export async function runHttp(mcp: McpServerSettings): Promise<void> {
  const security = buildSecurity(mcp);
  // Counts for the startup banner (a throwaway build — served sessions get their
  // own server instances below).
  const { toolCount, promptCount, uiViewCount, readOnly } = createServer();

  // Session-keyed transports. The SDK forbids reusing a stateless transport
  // across requests, so we run in session mode: an `initialize` request creates
  // a transport (+ its own server) and returns an `Mcp-Session-Id`; later
  // requests reuse the transport for that id, and close evicts it.
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  async function transportFor(req: Request): Promise<WebStandardStreamableHTTPServerTransport> {
    const sid = req.headers.get("mcp-session-id") ?? undefined;
    const existing = sid ? transports.get(sid) : undefined;
    if (existing) return existing;

    const transport: WebStandardStreamableHTTPServerTransport =
      new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        ...security,
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    const { server } = createServer();
    await server.connect(transport);
    return transport;
  }

  const mcpPath = "/mcp";
  serve({
    hostname: mcp.host,
    port: mcp.port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const cors = corsHeaders(req.headers.get("origin"), mcp.corsOrigins);

      // CORS preflight — answer before anything else (ChatGPT/Claude send this).
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }
      if (url.pathname === "/health") {
        return new Response("OK", {
          headers: { "content-type": "text/plain", ...cors },
        });
      }
      if (url.pathname === mcpPath || url.pathname === `${mcpPath}/`) {
        const transport = await transportFor(req);
        const res = await transport.handleRequest(req);
        if (Object.keys(cors).length === 0) return res;
        // Merge CORS onto the transport's response (its headers are preserved).
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(cors)) headers.set(k, v);
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      }
      return new Response("Not Found", { status: 404, headers: cors });
    },
  });

  logger.info(
    `MCP server ready on http://${mcp.host}:${mcp.port}${mcpPath} — ${toolCount} tools, ${promptCount} prompts, ${uiViewCount} app views ` +
      `(${mcp.transport})${readOnly ? " [READ-ONLY]" : ""}`,
  );

  // Background update whisper — seed the file cache so the next session's
  // instructions injection has data, and log the result to stderr.
  if (!getConfig().disableUpdateCheck) {
    void checkForUpdate()
      .then((r) => {
        if (r.release?.isNewer) {
          logger.info(
            `[update] MikroTik MCP v${r.release.version} available (running v${VERSION}). ` +
              `Upgrade: bun i -g @usex/mikrotik-mcp@latest`,
          );
        }
      })
      .catch(() => {});
  }
}
