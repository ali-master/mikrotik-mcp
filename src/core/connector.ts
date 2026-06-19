/**
 * The single choke point through which every tool talks to the device.
 *
 * Centralising command execution here means all 169 tools inherit the same
 * connection handling, error surfacing, and — crucially — Safe Mode routing:
 * when Safe Mode is active the command is sent through the persistent
 * interactive session so it runs inside that transactional context; otherwise a
 * fresh one-shot SSH channel is opened, used, and closed.
 */
import type { ToolContext } from "./context";
import { getConfig } from "./runtime";
import { MikroTikSSHClient } from "../ssh/client";
import { getSafeModeManager } from "../ssh/safe-mode";

async function runOnce(command: string): Promise<string> {
  const cfg = getConfig();
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
  try {
    if (!(await ssh.connect())) {
      return "Error: Failed to connect to MikroTik device";
    }
    return await ssh.run(command);
  } catch (e) {
    return `Error executing command: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    ssh.disconnect();
  }
}

/**
 * Execute a RouterOS command and return its raw text output.
 *
 * @param command  Fully-formed RouterOS CLI command (e.g. `/ip address print`).
 * @param ctx      Per-call logging context.
 */
export async function executeMikrotikCommand(command: string, ctx: ToolContext): Promise<string> {
  const safe = getSafeModeManager();
  let result: string;

  if (safe.isActive) {
    ctx.info(`Executing (safe mode): ${command}`);
    try {
      result = await safe.execute(command);
    } catch (e) {
      result = `Error executing command in safe mode session: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    ctx.info(`Executing MikroTik command: ${command}`);
    result = await runOnce(command);
  }

  if (result.startsWith("Error")) ctx.error(result);
  return result;
}
