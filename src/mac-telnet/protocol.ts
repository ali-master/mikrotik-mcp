/**
 * MikroTik MAC-Telnet protocol (Layer-2 execute/terminal path).
 *
 * MAC-Telnet reaches a RouterOS device by its **MAC address** with no IP — it
 * works across an L2 broadcast domain even when the target has no IP, a wrong
 * IP, or an IP you cannot route to. Transport is UDP port 20561, but the
 * protocol carries its own 6+6-byte source/destination MAC addressing inside
 * every packet header (independent of the outer L2/UDP delivery).
 *
 * This is split into a pure **codec** and a **session** state machine driven
 * over an injectable datagram sink, so the wire format and handshake can be
 * unit-tested without an L2 network. Wire format grounded against Håkon
 * Nessjøen's reference `mactelnet` (`protocol.c/.h`, `mactelnet.c`,
 * `mactelnetd.c`) via the `tikoci/centrs` port.
 *
 * Both auth modes are supported. The session offers MTWEI (EC-SRP, the modern
 * default — see `mtwei.ts`) in its BEGINAUTH and computes the 32-byte proof when
 * the device replies with a 49-byte PASSSALT; it falls back to classic MD5 when
 * the device offers a 16-byte salt (legacy gear). END_AUTH alone does not mean
 * success — a failed login also sends END_AUTH, then a "Login failed" message +
 * END — so success is confirmed only when real terminal output arrives.
 *
 * NOTE: device I/O here is UDP via `node:dgram` — not SSH and not an OS shell.
 * This is the one non-SSH transport in the server, deliberately isolated to
 * this module so the SSH choke point (`src/ssh`) is unaffected.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { MTWEI_PUBKEY_LEN, mtweiDocrypto, mtweiId, mtweiKeygen, mtweiOfferValue } from "./mtwei";
import type { MtweiKeypair } from "./mtwei";

/** UDP port MAC-Telnet listens on. */
export const MAC_TELNET_PORT = 20561;
/** Fixed MT header length for SESSIONSTART/DATA/ACK/END packets. */
export const MAC_TELNET_HEADER_LEN = 22;
/** Control-block header length: 4-byte magic + 1-byte type + 4-byte length. */
export const MAC_TELNET_CONTROL_HEADER_LEN = 9;
/** Control-block magic bytes: `56 34 12 FF`. */
export const MAC_TELNET_CONTROL_MAGIC = Uint8Array.of(0x56, 0x34, 0x12, 0xff);
/** Client type identifier sent in every header (`00 15`). */
export const MAC_TELNET_CLIENT_TYPE = Uint8Array.of(0x00, 0x15);

/**
 * Retransmission backoff (ms) for an unacknowledged outbound frame, from the
 * reference `mactelnet` client (`retransmit_intervals`). Up to 9 tries; UDP
 * gives no delivery guarantee, so the protocol layers ACK-by-byte-counter +
 * timed retransmission on top. Driven by {@link MacTelnetSession.tick}.
 */
export const MAC_TELNET_RETRANSMIT_SCHEDULE_MS: readonly number[] = [
  15, 20, 30, 50, 90, 170, 330, 660, 1000,
];
/**
 * Idle window before an empty-ACK keepalive is sent. The reference client sends
 * one after ~10s of inactivity and the server drops a session after ~15s
 * (`MT_CONNECTION_TIMEOUT`), so keep it under that ceiling.
 */
export const MAC_TELNET_KEEPALIVE_IDLE_MS = 8000;

/** MT packet types (`enum mt_ptype`). */
export const MacTelnetPacketType = {
  sessionStart: 0,
  data: 1,
  ack: 2,
  ping: 4,
  pong: 5,
  end: 255,
} as const;
export type MacTelnetPacketType = (typeof MacTelnetPacketType)[keyof typeof MacTelnetPacketType];

/** MT control-packet types (`enum mt_cptype`). */
export const MacTelnetControlType = {
  beginAuth: 0,
  passwordSalt: 1,
  password: 2,
  username: 3,
  terminalType: 4,
  terminalWidth: 5,
  terminalHeight: 6,
  packetError: 7,
  endAuth: 9,
} as const;
export type MacTelnetControlType = (typeof MacTelnetControlType)[keyof typeof MacTelnetControlType];

/** A MAC address as six octets. */
export type MacAddress = Uint8Array;

/** Parse `aa:bb:cc:dd:ee:ff` (or `-`/`.` separated) into six octets. */
export function parseMac(value: string): MacAddress {
  const parts = value.trim().split(/[:\-.]/);
  if (parts.length !== 6) {
    throw new Error(
      `"${value}" is not a 6-octet MAC address. Provide a MAC like aa:bb:cc:dd:ee:ff.`,
    );
  }
  const octets = new Uint8Array(6);
  for (let index = 0; index < 6; index += 1) {
    const octet = Number.parseInt(parts[index] as string, 16);
    if (!Number.isInteger(octet) || octet < 0 || octet > 0xff) {
      throw new Error(
        `"${value}" has an invalid octet "${parts[index]}". Each octet must be a two-digit hex value (00–ff).`,
      );
    }
    octets[index] = octet;
  }
  return octets;
}

/** Format six octets as `aa:bb:cc:dd:ee:ff`. */
export function formatMac(mac: MacAddress): string {
  return [...mac].map((octet) => octet.toString(16).padStart(2, "0")).join(":");
}

function macEquals(a: MacAddress, b: MacAddress): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export interface MacTelnetHeader {
  version: number;
  type: number;
  sourceMac: MacAddress;
  destinationMac: MacAddress;
  sessionKey: number;
  counter: number;
}

export interface EncodeHeaderOptions {
  type: number;
  sourceMac: MacAddress;
  destinationMac: MacAddress;
  sessionKey: number;
  counter: number;
  /** Direction flag. Client→server (default) puts the session key at offset 14. */
  fromServer?: boolean;
}

/**
 * Encode a 22-byte MT header. The session-key and client-type fields swap
 * positions by direction, mirroring `init_packet`'s `mt_direction_fromserver`.
 */
export function encodeHeader(options: EncodeHeaderOptions): Uint8Array {
  const data = new Uint8Array(MAC_TELNET_HEADER_LEN);
  const view = new DataView(data.buffer);
  data[0] = 1;
  data[1] = options.type;
  data.set(options.sourceMac, 2);
  data.set(options.destinationMac, 8);
  const sessionKeyOffset = options.fromServer ? 16 : 14;
  const clientTypeOffset = options.fromServer ? 14 : 16;
  view.setUint16(sessionKeyOffset, options.sessionKey & 0xffff, false);
  data.set(MAC_TELNET_CLIENT_TYPE, clientTypeOffset);
  view.setUint32(18, options.counter >>> 0, false);
  return data;
}

/** Decode a 22-byte MT header. Defaults to decoding a server→client packet. */
export function decodeHeader(
  bytes: Uint8Array,
  options: { fromServer?: boolean } = {},
): MacTelnetHeader {
  if (bytes.length < MAC_TELNET_HEADER_LEN) {
    throw new Error(
      `MAC-Telnet packet is too short (${bytes.length} bytes, need at least ${MAC_TELNET_HEADER_LEN}).`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fromServer = options.fromServer ?? true;
  const sessionKeyOffset = fromServer ? 16 : 14;
  return {
    version: bytes[0] as number,
    type: bytes[1] as number,
    sourceMac: bytes.slice(2, 8),
    destinationMac: bytes.slice(8, 14),
    sessionKey: view.getUint16(sessionKeyOffset, false),
    counter: view.getUint32(18, false),
  };
}

/** Encode one control block: magic + type + big-endian length + value. */
export function encodeControlBlock(
  type: MacTelnetControlType,
  value: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const block = new Uint8Array(MAC_TELNET_CONTROL_HEADER_LEN + value.length);
  block.set(MAC_TELNET_CONTROL_MAGIC, 0);
  block[4] = type;
  new DataView(block.buffer).setUint32(5, value.length >>> 0, false);
  block.set(value, MAC_TELNET_CONTROL_HEADER_LEN);
  return block;
}

export interface ParsedControlBlock {
  type: MacTelnetControlType | "plaindata";
  value: Uint8Array;
}

/**
 * Parse the payload of a DATA packet into control blocks. Bytes that do not
 * start with the control magic are returned as a single `plaindata` block,
 * matching the reference `parse_control_packet` fallback.
 */
export function parseControlBlocks(payload: Uint8Array): ParsedControlBlock[] {
  const blocks: ParsedControlBlock[] = [];
  let offset = 0;
  while (offset < payload.length) {
    const remaining = payload.length - offset;
    const hasMagic =
      remaining >= MAC_TELNET_CONTROL_HEADER_LEN &&
      payload[offset] === MAC_TELNET_CONTROL_MAGIC[0] &&
      payload[offset + 1] === MAC_TELNET_CONTROL_MAGIC[1] &&
      payload[offset + 2] === MAC_TELNET_CONTROL_MAGIC[2] &&
      payload[offset + 3] === MAC_TELNET_CONTROL_MAGIC[3];
    if (!hasMagic) {
      blocks.push({ type: "plaindata", value: payload.slice(offset) });
      break;
    }
    const type = payload[offset + 4] as MacTelnetControlType;
    const length = new DataView(payload.buffer, payload.byteOffset + offset + 5, 4).getUint32(
      0,
      false,
    );
    const valueStart = offset + MAC_TELNET_CONTROL_HEADER_LEN;
    const valueEnd = valueStart + length;
    if (valueEnd > payload.length) {
      throw new Error(
        `MAC-Telnet control block claims ${length} bytes but only ${payload.length - valueStart} remain.`,
      );
    }
    blocks.push({ type, value: payload.slice(valueStart, valueEnd) });
    offset = valueEnd;
  }
  return blocks;
}

/**
 * Compute the 17-byte MAC-Telnet password value:
 * `0x00 || MD5(0x00 || password || salt)`.
 */
export function macTelnetPasswordHash(password: string, salt: Uint8Array): Uint8Array {
  const digest = createHash("md5")
    .update(Buffer.from([0]))
    .update(Buffer.from(password, "utf8"))
    .update(salt)
    .digest();
  const out = new Uint8Array(17);
  out[0] = 0x00;
  out.set(digest, 1);
  return out;
}

/** Encode a 2-byte little-endian terminal dimension (width/height). */
export function encodeTerminalDimension(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value & 0xffff, true);
  return out;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

export interface BuildPacketOptions {
  type: number;
  sourceMac: MacAddress;
  destinationMac: MacAddress;
  sessionKey: number;
  counter: number;
  payload?: Uint8Array;
}

/** Build a complete client→server packet (header + optional payload). */
export function buildPacket(options: BuildPacketOptions): Uint8Array {
  const header = encodeHeader({
    type: options.type,
    sourceMac: options.sourceMac,
    destinationMac: options.destinationMac,
    sessionKey: options.sessionKey,
    counter: options.counter,
  });
  if (!options.payload || options.payload.length === 0) return header;
  return concatBytes([header, options.payload]);
}

/** Datagram sink the session writes encoded packets to. */
export interface MacTelnetDatagramSink {
  /** Send a UDP datagram. */
  send(bytes: Uint8Array): void;
  /** Close the underlying socket. */
  close(): void;
}

/** A datagram sink that also delivers inbound datagrams to a handler. */
export interface MacTelnetTransport extends MacTelnetDatagramSink {
  /** Register the inbound-datagram handler (e.g. wired to a session). */
  onMessage(handler: (bytes: Uint8Array) => void): void;
  /** Resolve once the socket is bound and ready to send. */
  ready(): Promise<void>;
}

/**
 * Production datagram transport: a UDP socket that sends each MAC-Telnet packet
 * to `host:port` and forwards inbound datagrams to the registered handler.
 *
 * MAC-Telnet's addressing is in-packet (the 6+6 MACs), so UDP delivery is just
 * the carrier: callers pass `host` as an L2 broadcast address (chosen by
 * {@link resolveMacTelnetRoute}) and the device claims the session by matching
 * the in-packet destination MAC. The socket binds `0.0.0.0` (not a specific
 * egress IP) because the device's reply is itself an L2 broadcast.
 */
export function createUdpMacTelnetTransport(options: {
  host: string;
  port: number;
  /** Enable `SO_BROADCAST` (needed when `host` is a broadcast address). */
  broadcast?: boolean;
}): MacTelnetTransport {
  const socket = createSocket({ type: "udp4", reuseAddr: true });
  let handler: ((bytes: Uint8Array) => void) | undefined;
  socket.on("message", (message: Buffer) => {
    handler?.(new Uint8Array(message));
  });
  const readyPromise = new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, () => {
      if (options.broadcast) {
        try {
          socket.setBroadcast(true);
        } catch {
          /* not all platforms allow it on an unbound family; non-fatal */
        }
      }
      resolve();
    });
  });
  return {
    send(bytes) {
      socket.send(bytes, options.port, options.host);
    },
    close() {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    },
    onMessage(next) {
      handler = next;
    },
    ready() {
      return readyPromise;
    },
  };
}

function isZeroMac(mac: MacAddress): boolean {
  return mac.every((octet) => octet === 0);
}

function tryParseMac(value: string | undefined): MacAddress | undefined {
  if (!value) return undefined;
  try {
    return parseMac(value);
  } catch {
    return undefined;
  }
}

/**
 * Read an interface's real hardware MAC from sysfs when {@link networkInterfaces}
 * reports an all-zero MAC (some virtual NICs do this). Linux exposes it at
 * `/sys/class/net/<name>/address`. Returns `undefined` on any failure — the
 * caller then falls back to a random locally-administered source MAC. (We do
 * not shell out to `ifconfig` here: this server forbids OS-shell usage.)
 */
function hardwareMacOf(name: string): MacAddress | undefined {
  try {
    const sys = readFileSync(`/sys/class/net/${name}/address`, "utf8").trim();
    const mac = tryParseMac(sys);
    if (mac && !isZeroMac(mac)) return mac;
  } catch {
    /* not Linux / no sysfs entry */
  }
  return undefined;
}

function ipv4ToInt(addr: string): number | undefined {
  const parts = addr.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join(".");
}

/** The IPv4 subnet-directed broadcast for `address`/`netmask` (e.g. `172.29.8.255`). */
export function directedBroadcast(address: string, netmask: string): string | undefined {
  const addr = ipv4ToInt(address);
  const mask = ipv4ToInt(netmask);
  if (addr === undefined || mask === undefined) return undefined;
  return intToIpv4(((addr & mask) | (~mask >>> 0)) >>> 0);
}

/** A local interface usable for MAC-Telnet broadcast: real MAC + directed broadcast. */
export interface BroadcastInterface {
  name: string;
  address: string;
  broadcast: string;
  mac: MacAddress;
}

/**
 * Enumerate up, non-internal IPv4 interfaces that can carry a MAC-Telnet
 * broadcast, each with its **real** MAC (via {@link hardwareMacOf} when the OS
 * reports zeros) and subnet-directed broadcast. The directed broadcast — not
 * the limited `255.255.255.255` — is what reaches a device on a
 * non-default-route NIC.
 */
export function listBroadcastInterfaces(): BroadcastInterface[] {
  const out: BroadcastInterface[] = [];
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      let mac = tryParseMac(info.mac);
      if (!mac || isZeroMac(mac)) mac = hardwareMacOf(name);
      if (!mac || isZeroMac(mac)) continue;
      const broadcast = directedBroadcast(info.address, info.netmask);
      if (!broadcast) continue;
      out.push({ name, address: info.address, broadcast, mac });
    }
  }
  return out;
}

/** The local source address the OS would pick to reach `host:port` (sends nothing). */
async function egressAddressFor(host: string, port: number): Promise<string | undefined> {
  return await new Promise<string | undefined>((resolve) => {
    const probe = createSocket("udp4");
    const done = (addr?: string): void => {
      try {
        probe.close();
      } catch {
        /* already closed */
      }
      resolve(addr);
    };
    probe.on("error", () => done(undefined));
    try {
      // `connect` only fixes the peer + selects a route; it sends no packet.
      probe.connect(port, host, () => {
        try {
          done(probe.address().address);
        } catch {
          done(undefined);
        }
      });
    } catch {
      done(undefined);
    }
  });
}

/**
 * Resolve the **real MAC of the interface that egresses toward `host:port`**,
 * for use as the in-packet source MAC. RouterOS's mac-server only replies to a
 * SESSIONSTART whose in-packet source MAC is the sending interface's real MAC —
 * a synthetic MAC gets no reply. Returns `undefined` when no interface matches,
 * so the caller can fall back to a synthetic source MAC.
 */
export async function resolveEgressMac(
  host: string,
  port: number,
): Promise<MacAddress | undefined> {
  const localAddr = await egressAddressFor(host, port);
  if (!localAddr) return undefined;
  for (const ifc of listBroadcastInterfaces()) {
    if (ifc.address === localAddr) return ifc.mac;
  }
  return undefined;
}

/** Which interface (source MAC + delivery host) reaches a target over MAC-Telnet. */
export interface MacTelnetRoute {
  sourceMac: MacAddress;
  host: string;
}

/**
 * Find which local interface can reach `destinationMac` over MAC-Telnet by
 * spraying a SESSIONSTART to **every interface's directed broadcast** (each with
 * that interface's real MAC, all sharing one session key) and matching the
 * device's reply. This is how connecting by MAC alone reaches a device wherever
 * it lives — the default-route LAN, a VPN tap, etc. — without naming an
 * interface.
 *
 * The reply is the device's broadcast ACK; its in-packet *destination* MAC tells
 * us which interface's source MAC the device accepted. Resolves `undefined`
 * when no interface answers within `timeoutMs`.
 */
export async function discoverMacTelnetRoute(opts: {
  destinationMac: MacAddress;
  port: number;
  timeoutMs: number;
  sessionKey?: number;
}): Promise<MacTelnetRoute | undefined> {
  const interfaces = listBroadcastInterfaces();
  if (interfaces.length === 0) return undefined;
  const sessionKey = opts.sessionKey ?? randomInt(0x10000);
  return await new Promise<MacTelnetRoute | undefined>((resolve) => {
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    let settled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (route?: MacTelnetRoute): void => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(route);
    };
    socket.on("error", () => finish(undefined));
    socket.on("message", (message: Buffer) => {
      let header: MacTelnetHeader;
      try {
        header = decodeHeader(new Uint8Array(message), { fromServer: true });
      } catch {
        return; // stray/truncated datagram on the shared segment
      }
      if (header.version !== 1 || header.sessionKey !== sessionKey) return;
      if (header.type !== MacTelnetPacketType.ack && header.type !== MacTelnetPacketType.data) {
        return;
      }
      if (!macEquals(header.sourceMac, opts.destinationMac)) return;
      const winner = interfaces.find((ifc) => macEquals(ifc.mac, header.destinationMac));
      if (winner) finish({ sourceMac: winner.mac, host: winner.broadcast });
    });
    const spray = (): void => {
      for (const ifc of interfaces) {
        const packet = buildPacket({
          type: MacTelnetPacketType.sessionStart,
          sourceMac: ifc.mac,
          destinationMac: opts.destinationMac,
          sessionKey,
          counter: 0,
        });
        try {
          socket.send(packet, opts.port, ifc.broadcast);
        } catch {
          /* one interface failing must not abort the spray */
        }
      }
    };
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* some platforms forbid it on an unbound family; sends may still work */
      }
      spray();
      // A couple of retransmits cover an early dropped SESSIONSTART (UDP).
      timers.push(setTimeout(spray, 250));
      timers.push(setTimeout(spray, 700));
      timers.push(setTimeout(() => finish(undefined), opts.timeoutMs));
    });
  });
}

/** Resolver default delivery host for mac-telnet; signals "discover the route". */
export const DEFAULT_MAC_TELNET_BROADCAST = "255.255.255.255";

/** A random locally-administered unicast MAC (`02:xx:…`) for the in-packet source. */
export function randomLocalMac(): MacAddress {
  const octets = new Uint8Array(randomBytes(6));
  octets[0] = ((octets[0] as number) & 0xfe) | 0x02; // locally administered, unicast
  return octets;
}

/** True when `host` is a broadcast delivery address (needs `SO_BROADCAST`). */
export function isBroadcastHost(host: string): boolean {
  return host === DEFAULT_MAC_TELNET_BROADCAST || host.endsWith(".255");
}

export interface MacTelnetRouteConfig {
  destinationMac: MacAddress;
  host: string;
  port: number;
  timeoutMs: number;
  /** Explicit client MAC; when set it always wins and the host is kept as-is. */
  explicitSourceMac?: MacAddress;
}

/**
 * Decide the in-packet source MAC and UDP delivery host for a mac-telnet session.
 *
 * - An explicit configured source MAC always wins (keeps the configured host).
 * - The default delivery host (the `255.255.255.255` sentinel) means "find the
 *   device": spray every interface's directed broadcast and use the one that
 *   answers — the only path that reaches a device on a non-default-route NIC.
 * - An explicit host is honored, using that interface's real egress MAC (falling
 *   back to a random locally-administered MAC when the OS reports none).
 */
export async function resolveMacTelnetRoute(config: MacTelnetRouteConfig): Promise<MacTelnetRoute> {
  if (config.explicitSourceMac) {
    return { sourceMac: config.explicitSourceMac, host: config.host };
  }
  if (config.host === DEFAULT_MAC_TELNET_BROADCAST) {
    const route = await discoverMacTelnetRoute({
      destinationMac: config.destinationMac,
      port: config.port,
      timeoutMs: Math.min(config.timeoutMs, 5_000),
    });
    if (route) return route;
  }
  const sourceMac = (await resolveEgressMac(config.host, config.port)) ?? randomLocalMac();
  return { sourceMac, host: config.host };
}

export interface MacTelnetSessionOptions {
  sink: MacTelnetDatagramSink;
  /** Client MAC (the in-payload source address). */
  sourceMac: MacAddress;
  /** Target device MAC (the in-payload destination address). */
  destinationMac: MacAddress;
  username: string;
  password: string;
  /** 16-bit session key. Random when omitted. */
  sessionKey?: number;
  terminalType?: string;
  terminalWidth?: number;
  terminalHeight?: number;
  /**
   * Offer MTWEI (EC-SRP) in BEGINAUTH. Default `true` — required by current
   * RouterOS. Set `false` to force the legacy classic flow (BEGINAUTH only),
   * which yields an MD5 salt on devices that still allow it.
   */
  offerMtwei?: boolean;
  /** Called with terminal output bytes. */
  onData?: (bytes: Uint8Array) => void;
  /** Called once the auth handshake completes and the terminal is ready. */
  onReady?: () => void;
  /** Called when the session ends or fails. */
  onClose?: (error?: Error) => void;
}

type SessionState =
  | "init"
  | "session-start-sent"
  | "auth-begin-sent"
  | "auth-sent"
  | "auth-complete"
  | "ready"
  | "closed";

/**
 * MAC-Telnet client session state machine over an injectable datagram sink.
 *
 * Drives the handshake: SESSIONSTART → BEGINAUTH (+ MTWEI offer) →
 * (server PASSSALT) → PASSWORD/USERNAME/terminal → (server END_AUTH) → ready.
 * Feed inbound datagrams via {@link handlePacket}.
 */
export class MacTelnetSession {
  private readonly options: MacTelnetSessionOptions;
  private readonly sessionKey: number;
  private state: SessionState = "init";
  private outCounter = 0;
  private lastInCounter: number | null = null;
  private mtweiKeypair: MtweiKeypair | undefined;
  /** Counter last sent in an ACK, re-sent verbatim as the empty-ACK keepalive. */
  private lastAckCounter = 0;
  /** Highest inbound ACK counter seen, used to clear {@link pending}. */
  private maxOutAck = -1;
  /** Last unacked retransmittable outbound frame (SESSIONSTART or DATA). */
  private pending:
    | {
        bytes: Uint8Array;
        ackTarget: number;
        attempts: number;
        elapsedMs: number;
      }
    | undefined;
  /** Set on any send/accepted-recv; consumed by {@link tick} to reset the idle clock. */
  private activitySinceTick = false;
  /** Idle accumulator (ms) for the keepalive, advanced by {@link tick} deltas. */
  private idleMs = 0;
  /** Last `tick` timestamp, for delta accumulation (clockless between ticks). */
  private lastTickMs: number | undefined;

  constructor(options: MacTelnetSessionOptions) {
    this.options = options;
    this.sessionKey = options.sessionKey ?? randomInt(0x10000);
  }

  /** Current session key. */
  get key(): number {
    return this.sessionKey;
  }

  /** Begin the handshake by sending SESSIONSTART. */
  start(): void {
    if (this.state !== "init") return;
    const bytes = this.sendPacket(MacTelnetPacketType.sessionStart);
    // Retransmit SESSIONSTART until any ACK arrives (ackTarget 0).
    this.pending = { bytes, ackTarget: 0, attempts: 0, elapsedMs: 0 };
    this.state = "session-start-sent";
  }

  /** Feed an inbound datagram (a full UDP payload) into the state machine. */
  handlePacket(bytes: Uint8Array): void {
    if (this.state === "closed") return;
    let header: MacTelnetHeader;
    try {
      header = decodeHeader(bytes, { fromServer: true });
    } catch {
      // A truncated / not-MAC-Telnet datagram on the shared UDP/L2 segment is
      // not our session's problem — drop it rather than tearing the session
      // down. Loss of one of our own frames is recovered by retransmit/timeout.
      return;
    }

    switch (header.type) {
      case MacTelnetPacketType.ack:
        if (this.matchesSession(header)) this.onAck(header);
        return;
      case MacTelnetPacketType.data:
        if (this.matchesSession(header)) this.onDataPacket(header, bytes);
        return;
      case MacTelnetPacketType.end:
        if (this.matchesSession(header)) this.onEnd(header);
        return;
      case MacTelnetPacketType.ping:
        // MAC-Ping (18-byte, zeroed session key) does not carry our session
        // key, so it cannot pass matchesSession; only answer pings addressed
        // to our MAC, and ignore everyone else's on the shared segment.
        if (header.version === 1 && macEquals(header.destinationMac, this.options.sourceMac)) {
          this.onPing(header);
        }
      // pong/unknown packet types fall through and are ignored.
    }
  }

  /**
   * Accept a packet only when it belongs to this session: protocol version 1,
   * matching session key, and MAC addresses that mirror our own (server src =
   * our destination, server dst = our source). Stray or spoofed datagrams on
   * the shared UDP/L2 segment are ignored.
   */
  private matchesSession(header: MacTelnetHeader): boolean {
    return (
      header.version === 1 &&
      header.sessionKey === this.sessionKey &&
      macEquals(header.sourceMac, this.options.destinationMac) &&
      macEquals(header.destinationMac, this.options.sourceMac)
    );
  }

  private onPing(header: MacTelnetHeader): void {
    // Reply to MAC-Ping probes with PONG. (This is the MAC-Ping liveness tool,
    // not the session keepalive — idle sessions are kept alive by empty ACKs.)
    this.activitySinceTick = true;
    this.emit(
      encodeHeader({
        type: MacTelnetPacketType.pong,
        sourceMac: this.options.sourceMac,
        destinationMac: this.options.destinationMac,
        sessionKey: header.sessionKey,
        counter: header.counter,
      }),
    );
  }

  private onAck(header: MacTelnetHeader): void {
    this.activitySinceTick = true;
    // Clear the pending retransmit once the peer has acknowledged it.
    this.maxOutAck = Math.max(this.maxOutAck, header.counter);
    if (this.pending && this.maxOutAck >= this.pending.ackTarget) {
      this.pending = undefined;
    }
    if (this.state !== "session-start-sent") return;
    const blocks: Uint8Array[] = [encodeControlBlock(MacTelnetControlType.beginAuth)];
    if (this.options.offerMtwei !== false) {
      // Advertise MTWEI: the device replies with a 49-byte PASSSALT and expects
      // the EC-SRP proof. Without this, current RouterOS only offers MD5, which
      // it then refuses.
      this.mtweiKeypair = mtweiKeygen();
      blocks.push(
        encodeControlBlock(
          MacTelnetControlType.passwordSalt,
          mtweiOfferValue(this.identityUsername(), this.mtweiKeypair.publicKey),
        ),
      );
    }
    this.sendData(blocks);
    this.state = "auth-begin-sent";
  }

  /** Login name with any `+console-parameter` suffix stripped (for the SRP id). */
  private identityUsername(): string {
    return this.options.username.split("+", 1)[0] ?? this.options.username;
  }

  private onDataPacket(header: MacTelnetHeader, bytes: Uint8Array): void {
    this.activitySinceTick = true;
    const payload = bytes.subarray(MAC_TELNET_HEADER_LEN);
    // Always ACK, even for retransmitted/non-advancing frames, so the peer
    // stops retransmitting; only deliver the payload when it advances.
    this.acknowledge(header.counter, payload.length);
    if (!this.acceptCounter(header.counter)) return; // duplicate / out-of-window

    let blocks: ParsedControlBlock[];
    try {
      blocks = parseControlBlocks(payload);
    } catch (error) {
      this.fail(error as Error);
      return;
    }

    for (const block of blocks) this.handleControlBlock(block);
  }

  private handleControlBlock(block: ParsedControlBlock): void {
    switch (block.type) {
      case MacTelnetControlType.passwordSalt:
        this.handlePasswordSalt(block.value);
        return;
      case MacTelnetControlType.endAuth:
        if (this.state === "auth-sent") {
          // END_AUTH begins terminal mode but does NOT confirm success: a
          // failed login also sends END_AUTH, then a "Login failed" message and
          // END. Defer onReady until real terminal output arrives.
          this.state = "auth-complete";
        }
        return;
      case "plaindata":
        this.handleTerminalData(block.value);
        return;
      case MacTelnetControlType.packetError:
        this.fail(
          new Error(
            `The device reported a MAC-Telnet error: ${new TextDecoder().decode(block.value)}. ` +
              "Check the credentials and that MAC-Telnet is enabled on the device.",
          ),
        );
      // unknown control types fall through and are ignored.
    }
  }

  /**
   * Terminal-stream bytes (PLAINDATA). In `auth-complete` the first content
   * decides the login outcome: a "Login failed" message means the device
   * rejected the credentials; anything else means success → fire onReady and
   * deliver. Once `ready`, all content flows to onData.
   */
  private handleTerminalData(data: Uint8Array): void {
    if (this.state === "auth-complete") {
      if (/login failed/i.test(new TextDecoder().decode(data))) {
        this.fail(new Error("MAC-Telnet login failed: incorrect username or password."));
        return;
      }
      this.state = "ready";
      this.options.onReady?.();
      if (data.length > 0) this.options.onData?.(data);
      return;
    }
    if (this.state === "ready" && data.length > 0) this.options.onData?.(data);
  }

  private handlePasswordSalt(salt: Uint8Array): void {
    if (this.state !== "auth-begin-sent") return;

    let passwordValue: Uint8Array;
    if (salt.length === 16) {
      // Classic MD5 — legacy devices, or the fallback when MTWEI was not
      // offered. Current RouterOS offers this salt but refuses the proof.
      passwordValue = macTelnetPasswordHash(this.options.password, salt);
    } else if (salt.length === MTWEI_PUBKEY_LEN + 16) {
      // MTWEI: 33-byte server public key ‖ 16-byte salt → 32-byte EC-SRP proof.
      if (!this.mtweiKeypair) {
        this.fail(
          new Error(
            "The device requires MTWEI but this session did not offer it. " +
              "Leave MTWEI enabled (the default) so the client advertises a public key.",
          ),
        );
        return;
      }
      const serverKey = salt.subarray(0, MTWEI_PUBKEY_LEN);
      const mtweiSalt = salt.subarray(MTWEI_PUBKEY_LEN);
      const validator = mtweiId(this.identityUsername(), this.options.password, mtweiSalt);
      passwordValue = mtweiDocrypto(
        this.mtweiKeypair.privateKey,
        serverKey,
        this.mtweiKeypair.publicKey,
        validator,
      );
    } else {
      this.fail(
        new Error(
          `The device offered an unsupported MAC-Telnet salt length (${salt.length}). ` +
            "Expected 16 (MD5) or 49 (MTWEI); confirm the device and RouterOS version.",
        ),
      );
      return;
    }

    const username = new TextEncoder().encode(this.options.username);
    const terminalType = new TextEncoder().encode(this.options.terminalType ?? "vt102");
    const blocks = [
      encodeControlBlock(MacTelnetControlType.password, passwordValue),
      encodeControlBlock(MacTelnetControlType.username, username),
      encodeControlBlock(MacTelnetControlType.terminalType, terminalType),
      encodeControlBlock(
        MacTelnetControlType.terminalWidth,
        encodeTerminalDimension(this.options.terminalWidth ?? 80),
      ),
      encodeControlBlock(
        MacTelnetControlType.terminalHeight,
        encodeTerminalDimension(this.options.terminalHeight ?? 24),
      ),
    ];
    this.sendData(blocks);
    this.state = "auth-sent";
  }

  private onEnd(header: MacTelnetHeader): void {
    // Echo END to acknowledge.
    this.emit(
      encodeHeader({
        type: MacTelnetPacketType.end,
        sourceMac: this.options.sourceMac,
        destinationMac: this.options.destinationMac,
        sessionKey: header.sessionKey,
        counter: 0,
      }),
    );
    if (this.state === "auth-complete") {
      // Closed right after END_AUTH without any prompt → the login failed.
      this.fail(
        new Error(
          "MAC-Telnet login failed: the device closed the session after authentication. " +
            "Check the credentials configured for this device.",
        ),
      );
      return;
    }
    this.close();
  }

  /** Send terminal input bytes (only valid once ready). */
  sendInput(bytes: Uint8Array): void {
    if (this.state !== "ready") {
      throw new Error("Cannot send input before the MAC-Telnet session is ready.");
    }
    // Terminal data is raw PLAINDATA (no control header).
    this.sendData([bytes]);
  }

  /** Send END and close the session. */
  end(): void {
    if (this.state === "closed") return;
    this.emit(
      encodeHeader({
        type: MacTelnetPacketType.end,
        sourceMac: this.options.sourceMac,
        destinationMac: this.options.destinationMac,
        sessionKey: this.sessionKey,
        counter: this.outCounter,
      }),
    );
    this.close();
  }

  private close(error?: Error): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.pending = undefined;
    this.options.sink.close();
    this.options.onClose?.(error);
  }

  private fail(error: Error): void {
    this.close(error);
  }

  /**
   * Fault-tolerant outbound send. A transient transport error (socket already
   * closed, write-after-end during teardown) must never propagate out of an
   * inbound-datagram handler and crash the caller's event loop; recovery is the
   * peer's retransmit or our own timeout. All session sends go through here.
   */
  private emit(bytes: Uint8Array): void {
    try {
      this.options.sink.send(bytes);
    } catch {
      /* transport closing / transient send failure — ignore */
    }
  }

  private acceptCounter(counter: number): boolean {
    if (this.lastInCounter === null) {
      this.lastInCounter = counter;
      return true;
    }
    if (counter > this.lastInCounter) {
      this.lastInCounter = counter;
      return true;
    }
    return false;
  }

  private acknowledge(counter: number, payloadLength: number): void {
    this.lastAckCounter = (counter + payloadLength) >>> 0;
    this.activitySinceTick = true;
    this.emit(
      encodeHeader({
        type: MacTelnetPacketType.ack,
        sourceMac: this.options.sourceMac,
        destinationMac: this.options.destinationMac,
        sessionKey: this.sessionKey,
        counter: this.lastAckCounter,
      }),
    );
  }

  private sendPacket(type: number, payload?: Uint8Array): Uint8Array {
    const bytes = buildPacket({
      type,
      sourceMac: this.options.sourceMac,
      destinationMac: this.options.destinationMac,
      sessionKey: this.sessionKey,
      counter: this.outCounter,
      payload,
    });
    this.activitySinceTick = true;
    this.emit(bytes);
    return bytes;
  }

  private sendData(parts: readonly Uint8Array[]): void {
    const payload = concatBytes(parts);
    const bytes = this.sendPacket(MacTelnetPacketType.data, payload);
    // Control blocks include their 9-byte headers in `payload.length`;
    // PLAINDATA contributes its raw bytes. Both advance the counter by the
    // number of payload bytes actually sent.
    this.outCounter = (this.outCounter + payload.length) >>> 0;
    // Retransmit this frame until the peer's ACK reaches its end (outCounter).
    this.pending = {
      bytes,
      ackTarget: this.outCounter,
      attempts: 0,
      elapsedMs: 0,
    };
  }

  /**
   * Advance the session's internal timers. The owner (e.g. the console) calls
   * this on a short interval with `Date.now()`. It is the only clocked behavior:
   * it retransmits the last unacknowledged frame on the reference backoff
   * schedule and emits an empty-ACK keepalive after an idle window. Unit tests
   * that never call `tick` see a purely reactive session.
   */
  tick(nowMs: number): void {
    if (this.state === "closed") return;
    const delta = this.lastTickMs === undefined ? 0 : Math.max(0, nowMs - this.lastTickMs);
    this.lastTickMs = nowMs;

    // Keepalive: an empty ACK after an idle window keeps the server from
    // dropping a held-open or slow session.
    if (this.activitySinceTick) {
      this.idleMs = 0;
      this.activitySinceTick = false;
    } else {
      this.idleMs += delta;
    }
    if (this.idleMs >= MAC_TELNET_KEEPALIVE_IDLE_MS) {
      this.sendKeepalive();
      this.idleMs = 0;
    }

    // Retransmit the last unacked frame (idempotent: the peer dedupes on the
    // byte counter, so re-sending a command frame never double-executes it).
    const pending = this.pending;
    if (pending && pending.attempts < MAC_TELNET_RETRANSMIT_SCHEDULE_MS.length) {
      pending.elapsedMs += delta;
      const wait = MAC_TELNET_RETRANSMIT_SCHEDULE_MS[pending.attempts] as number;
      if (pending.elapsedMs >= wait) {
        this.emit(pending.bytes);
        pending.attempts += 1;
        pending.elapsedMs = 0;
      }
    }
  }

  /** Re-send the last ACK as an empty-ACK keepalive (no payload, no counter advance). */
  private sendKeepalive(): void {
    this.emit(
      encodeHeader({
        type: MacTelnetPacketType.ack,
        sourceMac: this.options.sourceMac,
        destinationMac: this.options.destinationMac,
        sessionKey: this.sessionKey,
        counter: this.lastAckCounter,
      }),
    );
  }
}
