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
import { resolveDeviceName, getDevice } from "./runtime";
import { MikroTikSSHClient } from "../ssh/client";
import { getSafeModeManager } from "../ssh/safe-mode";

async function runOnce(command: string, deviceName?: string): Promise<string> {
  const dc = getDevice(deviceName);
  const ssh = new MikroTikSSHClient({
    host: dc.host,
    username: dc.username,
    password: dc.password,
    keyFilename: dc.keyFilename,
    privateKey: dc.privateKey,
    keyPassphrase: dc.keyPassphrase,
    port: dc.port,
    timeoutMs: dc.timeoutMs,
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
 * The target device is taken from `ctx.device` (set by the registry from the
 * tool call's `device` argument); when unset, the configured default is used.
 * Safe Mode is tracked per device, so each router has its own session.
 *
 * @param command  Fully-formed RouterOS CLI command (e.g. `/ip address print`).
 * @param ctx      Per-call context carrying the target device.
 */
export async function executeMikrotikCommand(command: string, ctx: ToolContext): Promise<string> {
  const deviceName = resolveDeviceName(ctx.device);
  const safe = getSafeModeManager(deviceName);
  let result: string;

  if (safe.isActive) {
    ctx.info(`[${deviceName}] Executing (safe mode): ${command}`);
    try {
      result = await safe.execute(command);
    } catch (e) {
      result = `Error executing command in safe mode session: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    ctx.info(`[${deviceName}] Executing MikroTik command: ${command}`);
    result = await runOnce(command, ctx.device);
  }

  if (result.startsWith("Error")) ctx.error(result);
  return result;
}
