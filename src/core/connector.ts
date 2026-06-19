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
  const name = resolveDeviceName(deviceName);
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
      const authMode =
        dc.keyFilename || dc.privateKey
          ? "SSH key"
          : dc.password
            ? "password"
            : "no credentials";
      const reason = ssh.lastError ? ` — ${ssh.lastError}` : "";
      // Throwing (vs. returning an "Error:" string) makes this a real tool
      // error: the registry catches it and marks the result isError, instead of
      // a handler wrapping it in a success message like "INTERFACES: …".
      throw new Error(
        `Failed to connect to MikroTik device '${name}' at ${dc.host}:${dc.port} (auth: ${authMode})${reason}. ` +
          "Check the host/port are reachable, the SSH service is enabled (/ip service), and the credentials are correct.",
      );
    }
    return await ssh.run(command);
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
export async function executeMikrotikCommand(
  command: string,
  ctx: ToolContext,
): Promise<string> {
  const deviceName = resolveDeviceName(ctx.device);
  const safe = getSafeModeManager(deviceName);

  // Transport/connection failures throw here and propagate to the registry,
  // which turns them into a proper `isError` tool result. Device-reported
  // command errors (syntax/failure) come back as normal output and are handled
  // by each tool via looksLikeError().
  if (safe.isActive) {
    ctx.info(`[${deviceName}] Executing (safe mode): ${command}`);
    return safe.execute(command);
  }
  ctx.info(`[${deviceName}] Executing MikroTik command: ${command}`);
  return runOnce(command, ctx.device);
}
