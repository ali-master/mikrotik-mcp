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
  formatMac,
  listBroadcastInterfaces,
  parseMac,
  resolveMacTelnetRoute,
} from "@tikoci/centrs/protocols";
import type { MacTelnetTransport } from "@tikoci/centrs/protocols";

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
  /** A route-resolution diagnostic, appended to {@link lastError} on failure. */
  private routeHint?: string;

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

      // When no host/sourceMac is pinned, the resolver sprays every interface's
      // directed broadcast and uses whichever the device answers. If nothing
      // answers it silently falls back to the *limited* broadcast — which on most
      // OSes only egresses the default-route NIC, so a device on any other segment
      // becomes unreachable. Detect that fallback to give a precise failure reason.
      const askedDiscovery = host === DEFAULT_MAC_TELNET_BROADCAST && !explicitSourceMac;
      if (askedDiscovery) {
        // Log the interfaces discovery will spray, with the source MAC it
        // resolved for each. A same-LAN timeout is usually visible here: the LAN
        // NIC is missing, or shows an all-zero MAC the device will silently reject.
        const candidates = listBroadcastInterfaces();
        logger.info(
          `[mac-telnet] discovery candidates: ${
            candidates.length
              ? candidates.map((i) => `${i.name}(${formatMac(i.mac)}→${i.broadcast})`).join(", ")
              : "NONE — no usable non-internal IPv4 interface found"
          }`,
        );
      }
      logger.info(`[mac-telnet] resolving route to ${this.opts.mac}…`);
      const route = await resolveMacTelnetRoute({
        destinationMac,
        host,
        port: this.opts.port,
        timeoutMs: this.opts.timeoutMs,
        explicitSourceMac,
      });
      const discoveryFailed = askedDiscovery && route.host === DEFAULT_MAC_TELNET_BROADCAST;
      this.routeHint = discoveryFailed
        ? "no local interface got a reply from the device during discovery — it is likely on a " +
          "different Layer-2 segment, mac-server is disabled on the facing interface, or a host " +
          "firewall is dropping the UDP 20561 reply. Pin the segment by setting `macHost` to the " +
          "device subnet's broadcast (e.g. 192.168.88.255) and, if needed, `sourceMac`."
        : undefined;
      logger.info(
        `[mac-telnet] route: source ${formatMac(route.sourceMac)} → ${route.host} ` +
          `(${explicitSourceMac ? "explicit" : discoveryFailed ? "DISCOVERY FAILED — limited broadcast" : "discovered"})`,
      );

      const transport = createUdpMacTelnetTransport({
        host: route.host,
        port: this.opts.port,
        broadcast: isBroadcastHost(route.host),
      });
      this.transport = transport;
      await transport.ready();
      logger.info(`[mac-telnet] socket ready; starting login (this can take ~10–30s)…`);

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
      const base = e instanceof Error ? e.message : String(e);
      // Surface the discovery diagnostic alongside the raw failure — for a
      // timeout it usually IS the reason (the device never saw our SESSIONSTART).
      this.lastError = this.routeHint ? `${base} (${this.routeHint})` : base;
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
