/**
 * Runtime configuration: one or more named MikroTik devices + MCP transport.
 *
 * Resolution order (highest precedence last): defaults -> environment
 * variables -> command-line flags. The single-device `MIKROTIK_*` variables are
 * kept **byte-for-byte compatible** with the legacy Python server (they define a
 * device named `default`), so an existing deployment swaps binaries unchanged.
 *
 * For multi-device setups (e.g. building a tunnel between two routers) define a
 * `devices` map via a JSON config file (`--config` / `MIKROTIK_CONFIG_FILE`) or
 * the `MIKROTIK_DEVICES` env var. Each device gets a name the AI can target
 * per tool call.
 */
import { readFileSync } from "node:fs";
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

/** Connection details for a single MikroTik device. */
export const DeviceConfigSchema = z.object({
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
  /** Free-text label shown to the AI (e.g. "HQ edge router"). */
  description: z.string().optional(),
});
export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;

export const MikrotikConfigSchema = z.object({
  /** Named devices the server can reach. Always has at least one entry. */
  devices: z
    .record(z.string(), DeviceConfigSchema)
    .default(() => ({ default: DeviceConfigSchema.parse({}) })),
  /** Device used when a tool call doesn't specify one. */
  defaultDevice: z.string().default("default"),
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

/** Parse a multi-device source (JSON file or inline JSON) into a devices map. */
function parseDevicesSource(raw: string, fromFile: boolean): {
  devices: Record<string, unknown>;
  defaultDevice?: string;
} {
  let json: unknown;
  try {
    json = JSON.parse(fromFile ? readFileSync(raw, "utf8") : raw);
  } catch (e) {
    throw new Error(
      `Failed to load MikroTik devices from ${fromFile ? `file ${raw}` : "MIKROTIK_DEVICES"}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  const obj = json as Record<string, unknown>;
  // Accept either { devices: {...}, defaultDevice } or a bare { name: {...} } map.
  const devices = (obj.devices ?? obj) as Record<string, unknown>;
  const defaultDevice = typeof obj.defaultDevice === "string" ? obj.defaultDevice : undefined;
  return { devices, defaultDevice };
}

/**
 * Build the effective configuration from the environment and CLI flags.
 * `argv` defaults to the process arguments (after `bun run <file>`).
 */
export function loadConfig(argv: string[] = process.argv.slice(2)): MikrotikConfig {
  const flags = parseFlags(argv);
  const pick = (flag: string, ...envNames: string[]) => flags[flag] ?? env(...envNames);

  // 1) Single-device fields (legacy MIKROTIK_* / flags) → the "default" device.
  const single = {
    host: pick("host", "MIKROTIK_HOST"),
    username: pick("username", "MIKROTIK_USERNAME"),
    password: pick("password", "MIKROTIK_PASSWORD"),
    port: pick("port", "MIKROTIK_PORT"),
    keyFilename: pick("key-filename", "MIKROTIK_KEY_FILENAME"),
    privateKey: pick("private-key", "MIKROTIK_PRIVATE_KEY"),
    keyPassphrase: pick("key-passphrase", "MIKROTIK_KEY_PASSPHRASE"),
    timeoutMs: pick("timeout-ms", "MIKROTIK_TIMEOUT_MS"),
  };
  const hasSingle = Object.values(single).some((v) => v !== undefined);

  const devices: Record<string, unknown> = {};
  let defaultDevice: string | undefined;
  if (hasSingle) {
    devices.default = single;
    defaultDevice = "default";
  }

  // 2) Multi-device source (file wins over the inline env var).
  const configFile = pick("config", "MIKROTIK_CONFIG_FILE");
  const devicesInline = flags.devices ?? env("MIKROTIK_DEVICES");
  if (configFile || devicesInline) {
    const src = configFile
      ? parseDevicesSource(configFile, true)
      : parseDevicesSource(devicesInline!, false);
    for (const [name, dc] of Object.entries(src.devices)) devices[name] = dc;
    if (src.defaultDevice) defaultDevice = src.defaultDevice;
    else if (!defaultDevice) defaultDevice = Object.keys(src.devices)[0];
  }

  const mcp = {
    transport: pick("transport", "MIKROTIK_MCP__TRANSPORT", "MCP_TRANSPORT"),
    host: pick("mcp-host", "MIKROTIK_MCP__HOST"),
    port: pick("mcp-port", "MIKROTIK_MCP__PORT"),
    allowedHosts: pick("mcp-allowed-hosts", "MIKROTIK_MCP__ALLOWED_HOSTS"),
    allowedOrigins: pick("mcp-allowed-origins", "MIKROTIK_MCP__ALLOWED_ORIGINS"),
  };

  const raw = {
    devices: Object.keys(devices).length ? devices : { default: {} },
    defaultDevice: defaultDevice ?? "default",
    mcp,
  };

  // Drop undefined keys so zod applies its defaults instead of failing on them.
  const pruned = JSON.parse(JSON.stringify(raw));
  const parsed = MikrotikConfigSchema.parse(pruned);

  // Guarantee the default device actually exists.
  if (!parsed.devices[parsed.defaultDevice]) {
    parsed.defaultDevice = Object.keys(parsed.devices)[0] ?? "default";
  }
  return parsed;
}
