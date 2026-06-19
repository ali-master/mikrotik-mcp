/**
 * Runtime configuration: SSH connection details + MCP transport settings.
 *
 * Resolution order (highest precedence last): defaults -> environment
 * variables -> command-line flags. The environment variable names are kept
 * **byte-for-byte compatible** with the legacy Python server (`MIKROTIK_*`,
 * nested via the `__` delimiter) so an existing deployment can swap binaries
 * without touching its configuration.
 */
import { z } from "zod";

export const TransportSchema = z.enum(["stdio", "sse", "streamable-http"]);
export type Transport = z.infer<typeof TransportSchema>;

export const McpServerSettingsSchema = z.object({
  transport: TransportSchema.default("stdio"),
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().positive().default(8000),
  /** Comma-separated Host header allowlist for DNS-rebinding protection. "*" disables it. */
  allowedHosts: z.string().default(""),
  /** Comma-separated Origin header allowlist for DNS-rebinding protection. */
  allowedOrigins: z.string().default(""),
});
export type McpServerSettings = z.infer<typeof McpServerSettingsSchema>;

export const MikrotikConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  username: z.string().default("admin"),
  password: z.string().default(""),
  port: z.coerce.number().int().positive().default(22),
  keyFilename: z.string().optional(),
  /** Optional inline private key (PEM). Takes precedence over keyFilename. */
  privateKey: z.string().optional(),
  /** Passphrase for an encrypted private key (keyFilename or privateKey). */
  keyPassphrase: z.string().optional(),
  /** SSH connect timeout in milliseconds. */
  timeoutMs: z.coerce.number().int().positive().default(10_000),
  mcp: McpServerSettingsSchema.default(() => McpServerSettingsSchema.parse({})),
});
export type MikrotikConfig = z.infer<typeof MikrotikConfigSchema>;

/** Reads a value from a list of candidate env var names (first non-empty wins). */
function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

/**
 * Parse `--flag value` / `--flag=value` style arguments into a flat map.
 * Booleans without a value default to "true".
 */
function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

/**
 * Build the effective configuration from the environment and CLI flags.
 * `argv` defaults to the process arguments (after `bun run <file>`).
 */
export function loadConfig(argv: string[] = process.argv.slice(2)): MikrotikConfig {
  const flags = parseFlags(argv);
  const pick = (flag: string, ...envNames: string[]) => flags[flag] ?? env(...envNames);

  const raw = {
    host: pick("host", "MIKROTIK_HOST"),
    username: pick("username", "MIKROTIK_USERNAME"),
    password: pick("password", "MIKROTIK_PASSWORD"),
    port: pick("port", "MIKROTIK_PORT"),
    keyFilename: pick("key-filename", "MIKROTIK_KEY_FILENAME"),
    privateKey: pick("private-key", "MIKROTIK_PRIVATE_KEY"),
    keyPassphrase: pick("key-passphrase", "MIKROTIK_KEY_PASSPHRASE"),
    timeoutMs: pick("timeout-ms", "MIKROTIK_TIMEOUT_MS"),
    mcp: {
      transport: pick("transport", "MIKROTIK_MCP__TRANSPORT", "MCP_TRANSPORT"),
      host: pick("mcp-host", "MIKROTIK_MCP__HOST"),
      port: pick("mcp-port", "MIKROTIK_MCP__PORT"),
      allowedHosts: pick("mcp-allowed-hosts", "MIKROTIK_MCP__ALLOWED_HOSTS"),
      allowedOrigins: pick("mcp-allowed-origins", "MIKROTIK_MCP__ALLOWED_ORIGINS"),
    },
  };

  // Drop undefined keys so zod applies its defaults instead of failing on them.
  const pruned = JSON.parse(JSON.stringify(raw));
  return MikrotikConfigSchema.parse(pruned);
}
