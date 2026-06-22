/**
 * Transport selection for a device — the single place that decides SSH vs.
 * MAC-Telnet.
 *
 * A device reached by `mac` (Layer-2, no IP) uses {@link MikroTikMacTelnetClient};
 * everything else uses {@link MikroTikSSHClient}. Both expose the same
 * `connect/run/disconnect/lastError` shape ({@link DeviceClient}), so every
 * caller — the command choke point, the CLI auth probe, the dashboard health
 * check — selects a transport here rather than re-deciding (and defaulting a
 * MAC device to `127.0.0.1:22`).
 */
import type { DeviceConfig } from "../config";
import { MikroTikMacTelnetClient } from "../mac-telnet/client";
import { MikroTikSSHClient } from "../ssh/client";

/** The minimal client surface shared by the SSH and MAC-Telnet transports. */
export interface DeviceClient {
  /** Establish the connection. Resolves true on success, false on failure. */
  connect(): Promise<boolean>;
  /** Run one command and return its decoded output. */
  run(command: string): Promise<string>;
  /** Close the connection. Safe to call multiple times. */
  disconnect(): void;
  /** Human-readable reason the last `connect()` failed, if it did. */
  lastError?: string;
}

/** True when this device config selects the MAC-Telnet transport. */
export function isMacTelnetDevice(dc: DeviceConfig): dc is DeviceConfig & { mac: string } {
  return Boolean(dc.mac);
}

/** Build the right transport client for a device config. */
export function createDeviceClient(dc: DeviceConfig): DeviceClient {
  if (isMacTelnetDevice(dc)) {
    return new MikroTikMacTelnetClient({
      mac: dc.mac,
      username: dc.username,
      password: dc.password,
      sourceMac: dc.sourceMac,
      host: dc.macHost,
      port: dc.macPort,
      timeoutMs: dc.timeoutMs,
    });
  }

  return new MikroTikSSHClient({
    host: dc.host,
    username: dc.username,
    password: dc.password,
    keyFilename: dc.keyFilename,
    privateKey: dc.privateKey,
    keyPassphrase: dc.keyPassphrase,
    port: dc.port,
    timeoutMs: dc.timeoutMs,
  });
}

/** How a device is addressed, for logs/errors (e.g. `MAC 48:…` or `1.2.3.4:22`). */
export function describeTransport(dc: DeviceConfig): string {
  return dc.mac ? `MAC ${dc.mac} (mac-telnet)` : `${dc.host}:${dc.port}`;
}

/** A connection-failure message tailored to the transport. */
export function connectErrorMessage(name: string, dc: DeviceConfig, lastError?: string): string {
  const reason = lastError ? ` — ${lastError}` : "";
  if (dc.mac) {
    return (
      `Failed to connect to MikroTik device '${name}' over MAC-Telnet at ${dc.mac}${reason}. ` +
      "Check you are on the same Layer-2 segment, MAC-Telnet is enabled (/tool mac-server) on a reachable interface, and the credentials are correct."
    );
  }
  const authMode =
    dc.keyFilename || dc.privateKey ? "SSH key" : dc.password ? "password" : "no credentials";
  return (
    `Failed to connect to MikroTik device '${name}' at ${dc.host}:${dc.port} (auth: ${authMode})${reason}. ` +
    "Check the host/port are reachable, the SSH service is enabled (/ip service), and the credentials are correct."
  );
}
