/**
 * Runtime configuration: one or more named MikroTik devices + MCP transport.
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

/**
 * Optional S3-compatible object storage for shipping backup/export files off
 * the device. When omitted, the S3 backup tools are inert. Credentials follow
 * Bun's native S3 conventions (`S3_*`, then `AWS_*` env fallbacks) and may be
 * overridden here or via a JSON config `s3` block.
 */
export const S3ConfigSchema = z.object({
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  sessionToken: z.string().optional(),
  region: z.string().optional(),
  /** Custom endpoint for R2/MinIO/Spaces/etc. Omit for AWS S3. */
  endpoint: z.string().optional(),
  bucket: z.string().optional(),
  /** Key prefix prepended to backup object keys, e.g. "mikrotik/". */
  prefix: z.string().default(""),
  /** Presigned-URL lifetime (seconds) used for device `/tool fetch` transfers. */
  presignExpiresIn: z.coerce.number().int().positive().default(3600),
});
export type S3Config = z.infer<typeof S3ConfigSchema>;

export const MikrotikConfigSchema = z.object({
  /** Named devices the server can reach. Always has at least one entry. */
  devices: z
    .record(z.string(), DeviceConfigSchema)
    .default(() => ({ default: DeviceConfigSchema.parse({}) })),
  /** Device used when a tool call doesn't specify one. */
  defaultDevice: z.string().default("default"),
  mcp: McpServerSettingsSchema.default(() => McpServerSettingsSchema.parse({})),
  /** Optional S3 storage; absent unless configured (feature is opt-in). */
  s3: S3ConfigSchema.optional(),
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
function parseDevicesSource(
  raw: string,
  fromFile: boolean,
): {
  devices: Record<string, unknown>;
  defaultDevice?: string;
  s3?: Record<string, unknown>;
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
  const structured = obj.devices !== undefined;
  const devices = (obj.devices ?? obj) as Record<string, unknown>;
  const defaultDevice = typeof obj.defaultDevice === "string" ? obj.defaultDevice : undefined;
  // Only read an `s3` block from the structured form, so a device literally
  // named "s3" in a bare map isn't mistaken for storage config.
  const s3 =
    structured && obj.s3 && typeof obj.s3 === "object"
      ? (obj.s3 as Record<string, unknown>)
      : undefined;
  return { devices, defaultDevice, s3 };
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
  let fileS3: Record<string, unknown> | undefined = {};
  if (configFile || devicesInline) {
    const src = configFile
      ? parseDevicesSource(configFile, true)
      : parseDevicesSource(devicesInline!, false);
    for (const [name, dc] of Object.entries(src.devices)) devices[name] = dc;
    if (src.defaultDevice) defaultDevice = src.defaultDevice;
    else if (!defaultDevice) defaultDevice = Object.keys(src.devices)[0];
    fileS3 = src.s3;
  }

  // 3) Optional S3 storage. Credentials follow Bun's native S3 lookup order
  // (S3_* then AWS_*); flags and the config-file `s3` block override env.
  const s3 = {
    accessKeyId: pick("s3-access-key-id", "S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
    secretAccessKey: pick("s3-secret-access-key", "S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
    sessionToken: pick("s3-session-token", "S3_SESSION_TOKEN", "AWS_SESSION_TOKEN"),
    region: pick("s3-region", "S3_REGION", "AWS_REGION"),
    endpoint: pick("s3-endpoint", "S3_ENDPOINT", "AWS_ENDPOINT"),
    bucket: pick("s3-bucket", "S3_BUCKET", "AWS_BUCKET"),
    prefix: pick("s3-prefix", "MIKROTIK_S3_PREFIX"),
    presignExpiresIn: pick("s3-presign-expires-in", "MIKROTIK_S3_PRESIGN_EXPIRES_IN"),
    // The config-file block overrides anything from env/flags.
    ...fileS3,
  };

  const mcp = {
    transport: pick("transport", "MIKROTIK_MCP__TRANSPORT", "MCP_TRANSPORT"),
    host: pick("mcp-host", "MIKROTIK_MCP__HOST"),
    port: pick("mcp-port", "MIKROTIK_MCP__PORT"),
    allowedHosts: pick("mcp-allowed-hosts", "MIKROTIK_MCP__ALLOWED_HOSTS"),
    allowedOrigins: pick("mcp-allowed-origins", "MIKROTIK_MCP__ALLOWED_ORIGINS"),
  };

  // S3 is opt-in: only attach the block when something meaningful is set, so an
  // unconfigured deployment leaves `config.s3` undefined and the tools inert.
  const hasS3 = !!(s3.accessKeyId || s3.bucket || s3.endpoint);

  const raw = {
    devices: Object.keys(devices).length ? devices : { default: {} },
    defaultDevice: defaultDevice ?? "default",
    mcp,
    ...(hasS3 ? { s3 } : {}),
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
