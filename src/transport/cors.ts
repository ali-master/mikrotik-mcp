/**
 * CORS for the `/mcp` endpoint.
 *
 * The ChatGPT Apps connector (and browser-side App views) issue a CORS
 * preflight before talking to `/mcp`, so the endpoint must answer `OPTIONS`
 * and echo the right `Access-Control-*` headers. We reflect the request Origin
 * only when it's allow-listed (never a blanket `*` with credentials), defaulting
 * to the known MCP-host origins; operators can override via `--mcp-cors-origins`.
 */

/** Built-in allow-list: the origins ChatGPT and Claude render Apps from. */
export const DEFAULT_CORS_ORIGINS = [
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://claude.ai",
  "https://web.claude.ai",
];

const CORS_METHODS = "GET, POST, DELETE, OPTIONS";
const CORS_HEADERS =
  "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID";

/** Parse the configured allow-list ("" → defaults, "*" → any, else CSV). */
export function corsAllowList(configured: string): string[] | "*" {
  const trimmed = (configured ?? "").trim();
  if (trimmed === "*") return "*";
  if (!trimmed) return DEFAULT_CORS_ORIGINS;
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve the `Access-Control-Allow-Origin` value for a request: the echoed
 * origin if allowed, `"*"` when the operator opted into any origin, or null to
 * omit CORS entirely (e.g. same-origin / server-to-server calls with no Origin).
 */
export function resolveCorsOrigin(origin: string | null, configured: string): string | null {
  const allow = corsAllowList(configured);
  if (allow === "*") return "*";
  if (!origin) return null;
  return allow.includes(origin) ? origin : null;
}

/** Build the CORS response headers for a request Origin (empty if not allowed). */
export function corsHeaders(origin: string | null, configured: string): Record<string, string> {
  const allowOrigin = resolveCorsOrigin(origin, configured);
  if (!allowOrigin) return {};
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": CORS_METHODS,
    "access-control-allow-headers": CORS_HEADERS,
    "access-control-expose-headers": "Mcp-Session-Id",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}
