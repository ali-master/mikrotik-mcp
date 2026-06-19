#!/usr/bin/env bun
/**
 * Command-line entry point for the MikroTik MCP server.
 *
 *   mikrotik-mcp                 start the server (stdio by default)
 *   mikrotik-mcp serve           same, explicit
 *   mikrotik-mcp auth-check      verify SSH connectivity to the device
 *   mikrotik-mcp tools           list every registered tool (name + risk)
 *   mikrotik-mcp --version       print version
 *   mikrotik-mcp --help          usage
 *
 * Connection details come from MIKROTIK_* env vars or --flags (see config.ts).
 */
import { existsSync } from "node:fs";
import { loadConfig } from "./config";
import { setConfig } from "./core/runtime";
import { logger } from "./logger";
import { MikroTikSSHClient } from "./ssh/client";
import { allToolModules } from "./tools";
import { runHttp } from "./transport/http";
import { runStdio } from "./transport/stdio";
import { VERSION, SERVER_NAME } from "./version";

const HELP = `${SERVER_NAME} v${VERSION} — MikroTik RouterOS MCP server

USAGE
  mikrotik-mcp [command] [options]

COMMANDS
  serve         Start the MCP server (default)
  auth-check    Connect over SSH and run a probe command, then exit
  tools         Print the full tool catalog (name · risk · title)
  version       Print the version

CONNECTION OPTIONS  (env var in parentheses)
  --host           RouterOS host             (MIKROTIK_HOST, default 127.0.0.1)
  --username       SSH username              (MIKROTIK_USERNAME, default admin)
  --port           SSH port                  (MIKROTIK_PORT, default 22)

AUTHENTICATION — use a password OR an SSH key (key takes precedence)
  --password       SSH password              (MIKROTIK_PASSWORD)
  --key-filename   Path to a private key     (MIKROTIK_KEY_FILENAME)
  --private-key    Inline private key (PEM)  (MIKROTIK_PRIVATE_KEY)
  --key-passphrase Passphrase for an encrypted key (MIKROTIK_KEY_PASSPHRASE)

TRANSPORT OPTIONS
  --transport          stdio | sse | streamable-http   (MIKROTIK_MCP__TRANSPORT)
  --mcp-host           HTTP bind host                   (MIKROTIK_MCP__HOST)
  --mcp-port           HTTP bind port                   (MIKROTIK_MCP__PORT)
  --mcp-allowed-hosts  Host header allow-list (DNS-rebinding protection)
`;

function warnIfPlaintextPasswordInContainer(password: string): void {
  const inContainer = existsSync("/.dockerenv") || process.env.container === "docker";
  if (inContainer && password) {
    logger.warn(
      "Security notice: running inside a container with a plaintext password in the environment. " +
        "Environment variables are visible via 'docker inspect'. Prefer Docker secrets / a key file. See SECURITY.md.",
    );
  }
}

function listTools(): void {
  const risk = (a: { readOnlyHint?: boolean; destructiveHint?: boolean }) =>
    a.readOnlyHint ? "READ" : a.destructiveHint ? "DESTRUCTIVE" : "WRITE";
  let total = 0;
  for (const mod of allToolModules) {
    for (const t of mod) {
      total++;
      process.stdout.write(`${risk(t.annotations).padEnd(12)} ${t.name.padEnd(34)} ${t.title}\n`);
    }
  }
  process.stdout.write(`\n${total} tools across ${allToolModules.length} modules\n`);
}

async function authCheck(): Promise<number> {
  const cfg = loadConfig();
  logger.info(`Connecting to ${cfg.username}@${cfg.host}:${cfg.port} …`);
  const ssh = new MikroTikSSHClient({
    host: cfg.host,
    username: cfg.username,
    password: cfg.password,
    keyFilename: cfg.keyFilename,
    privateKey: cfg.privateKey,
    keyPassphrase: cfg.keyPassphrase,
    port: cfg.port,
    timeoutMs: cfg.timeoutMs,
  });
  const authMode = cfg.keyFilename || cfg.privateKey ? "SSH key" : "password";
  logger.info(`Auth mode: ${authMode}`);
  if (!(await ssh.connect())) {
    logger.error("Connection FAILED. Check host/credentials/reachability.");
    return 1;
  }
  try {
    const identity = await ssh.run("/system identity print");
    const version = await ssh.run("/system resource print");
    process.stdout.write(`\nConnection OK.\n\n${identity.trim()}\n\n${version.trim()}\n`);
    return 0;
  } finally {
    ssh.disconnect();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv.find((a) => !a.startsWith("--")) ?? "serve";

  if (argv.includes("--help") || argv.includes("-h") || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === "tools") {
    listTools();
    return;
  }
  if (command === "auth-check") {
    process.exit(await authCheck());
  }

  // serve
  const cfg = loadConfig();
  setConfig(cfg);
  warnIfPlaintextPasswordInContainer(cfg.password);
  logger.info(`Starting ${SERVER_NAME} v${VERSION} (transport=${cfg.mcp.transport})`);

  if (cfg.mcp.transport === "stdio") {
    await runStdio();
  } else {
    await runHttp(cfg.mcp);
  }
}

main().catch((e) => {
  logger.error(`Fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
