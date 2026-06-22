/**
 * MAC-Telnet client facade for MikroTik / RouterOS devices.
 *
 * Deliberately mirrors {@link MikroTikSSHClient}'s shape — `connect()`,
 * `run(command)`, `disconnect()`, `lastError` — so the device choke point
 * (`src/core/connector.ts`) can pick a transport by config alone and every tool
 * inherits MAC-Telnet connectivity without change.
 *
 * Where SSH needs a routable IP, this reaches the device purely by **MAC
 * address** over Layer 2 (UDP 20561), so it works on a router with no IP, a
 * wrong IP, or an unroutable one — the classic provisioning / recovery case.
 * The heavy lifting (wire codec, MTWEI/MD5 auth, terminal→command capture)
 * lives in `protocol.ts` / `console.ts`; this binds them to a real UDP socket.
 *
 * Like `MikroTikSSHClient.run`, each `connect()` establishes a fresh session.
 * RouterOS adds a ~10s console-negotiation stall on *every* mac-telnet login
 * (documented in `console.ts`), so a one-command-per-connect pattern pays it
 * each call — acceptable for the recovery/provisioning use this transport
 * targets, but slower than SSH for bulk work.
 */
import { logger } from "../logger";
import { MacTelnetConsole } from "./console";
import {
  DEFAULT_MAC_TELNET_BROADCAST,
  isBroadcastHost,
  MAC_TELNET_PORT,
  createUdpMacTelnetTransport,
  parseMac,
  resolveMacTelnetRoute,
} from "./protocol";
import type { MacTelnetTransport } from "./protocol";

export interface MacTelnetClientOptions {
  /** Target device MAC, e.g. `48:A9:8A:C6:42:F7`. */
  mac: string;
  username: string;
  password?: string;
  /** UDP port the device's mac-server listens on (default 20561). */
  port?: number;
  /**
   * UDP delivery host. Defaults to the broadcast sentinel, which triggers
   * route discovery (spray every interface's directed broadcast and use the one
   * the device answers). Set an explicit subnet broadcast (e.g. `10.0.0.255`)
   * to pin delivery to one segment.
   */
  host?: string;
  /**
   * Explicit in-packet source MAC. Usually omitted — the resolver uses the real
   * MAC of the egress interface, which is what RouterOS's mac-server requires.
   */
  sourceMac?: string;
  /** Connect/discovery timeout in milliseconds. */
  timeoutMs?: number;
}

export class MikroTikMacTelnetClient {
  private transport: MacTelnetTransport | null = null;
  private console: MacTelnetConsole | null = null;
  private readonly opts: Required<
    Pick<MacTelnetClientOptions, "mac" | "username" | "port" | "timeoutMs">
  > &
    MacTelnetClientOptions;

  /** Human-readable reason the last `connect()` failed, if it did. */
  lastError?: string;

  constructor(opts: MacTelnetClientOptions) {
    this.opts = {
      port: MAC_TELNET_PORT,
      timeoutMs: 10_000,
      ...opts,
    };
  }

  /** Establish the MAC-Telnet session. Resolves `true` on success, `false` on failure. */
  async connect(): Promise<boolean> {
    this.lastError = undefined;
    try {
      const destinationMac = parseMac(this.opts.mac);
      const explicitSourceMac = this.opts.sourceMac ? parseMac(this.opts.sourceMac) : undefined;
      const host = this.opts.host ?? DEFAULT_MAC_TELNET_BROADCAST;

      const route = await resolveMacTelnetRoute({
        destinationMac,
        host,
        port: this.opts.port,
        timeoutMs: this.opts.timeoutMs,
        explicitSourceMac,
      });

      const transport = createUdpMacTelnetTransport({
        host: route.host,
        port: this.opts.port,
        broadcast: isBroadcastHost(route.host),
      });
      this.transport = transport;
      await transport.ready();

      const console = new MacTelnetConsole({
        sink: transport,
        sourceMac: route.sourceMac,
        destinationMac,
        username: this.opts.username,
        password: this.opts.password ?? "",
        // RouterOS stalls ~10s before the first prompt on every login, so the
        // prime budget must clear that floor regardless of a short connect timeout.
        primeTimeoutMs: Math.max(this.opts.timeoutMs, 30_000),
        commandTimeoutMs: Math.max(this.opts.timeoutMs, 15_000),
      });
      this.console = console;
      transport.onMessage((bytes) => console.handlePacket(bytes));

      await console.open();
      return true;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      logger.error(`Failed to connect to MikroTik over MAC-Telnet: ${this.lastError}`);
      this.disconnect();
      return false;
    }
  }

  /** Run a single command over the console and return its decoded output. */
  async run(command: string): Promise<string> {
    if (!this.console || !this.console.isReady) {
      throw new Error("Not connected to MikroTik device (MAC-Telnet)");
    }
    const { output } = await this.console.run(command);
    return output;
  }

  /** Close the session and socket. Safe to call multiple times. */
  disconnect(): void {
    try {
      this.console?.close();
    } catch {
      /* already closing */
    }
    try {
      this.transport?.close();
    } catch {
      /* already closed */
    }
    this.console = null;
    this.transport = null;
  }
}
