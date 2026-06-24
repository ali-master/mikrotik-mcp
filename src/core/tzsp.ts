/**
 * TZSP (TaZmen Sniffer Protocol) decoder + pcap writer — pure, no I/O.
 *
 * RouterOS's `/tool sniffer` (streaming) and the firewall `action=sniff-tzsp`
 * mangle action mirror packets to a remote host by wrapping the original
 * Ethernet frame in a small UDP/TZSP envelope (default port 37008):
 *
 *   TZSP header (4 bytes) → tags … → TAG_END (0x01) → original Ethernet frame
 *
 * This module unwraps that envelope ({@link decodeTzsp}), summarises the inner
 * frame for the live capture view ({@link summarizePacket}), and serialises
 * frames to classic pcap ({@link pcapGlobalHeader}/{@link pcapRecord}) for
 * download. All functions are pure and unit-tested; the UDP receiver that feeds
 * them lives in `src/observability/capture.ts`.
 */

const TAG_END = 0x01;
const TAG_PADDING = 0x00;

/** TZSP packet types we care about (0 = received packet, 4 = keepalive/NULL). */
export interface DecodedTzsp {
  version: number;
  type: number;
  /** Encapsulated protocol: 1 = Ethernet, 18 = IEEE 802.11. */
  encap: number;
  /** True for a type-4 NULL keepalive (no inner frame). */
  keepalive: boolean;
  /** The inner frame (present when not a keepalive and tags were well-formed). */
  frame?: Uint8Array;
}

/** Unwrap a TZSP datagram. Returns null when it is too short to be TZSP. */
export function decodeTzsp(buf: Uint8Array): DecodedTzsp | null {
  if (buf.length < 4) return null;
  const version = buf[0];
  const type = buf[1];
  const encap = (buf[2] << 8) | buf[3];
  const keepalive = type === 4;
  let offset = 4;
  // Walk the tag list to TAG_END; the inner frame follows it.
  while (offset < buf.length) {
    const tag = buf[offset++];
    if (tag === TAG_END) break;
    if (tag === TAG_PADDING) continue;
    if (offset >= buf.length) return { version, type, encap, keepalive }; // truncated tag
    const len = buf[offset++];
    offset += len; // skip the tag value
  }
  const frame = keepalive || offset > buf.length ? undefined : buf.subarray(offset);
  return { version, type, encap, keepalive, frame };
}

function mac(buf: Uint8Array, at: number): string {
  return Array.from(buf.subarray(at, at + 6), (b) => b.toString(16).padStart(2, "0")).join(":");
}

function ipv4(buf: Uint8Array, at: number): string {
  return `${buf[at]}.${buf[at + 1]}.${buf[at + 2]}.${buf[at + 3]}`;
}

function ipv6(buf: Uint8Array, at: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    parts.push(((buf[at + i] << 8) | buf[at + i + 1]).toString(16));
  }
  return parts.join(":").replace(/(^|:)0(:0)+(:|$)/, "::"); // collapse one zero run
}

const IP_PROTO: Record<number, string> = {
  1: "ICMP",
  2: "IGMP",
  6: "TCP",
  17: "UDP",
  47: "GRE",
  50: "ESP",
  51: "AH",
  58: "ICMPv6",
  89: "OSPF",
  112: "VRRP",
  132: "SCTP",
};

const ETHERTYPE: Record<number, string> = {
  0x0800: "IPv4",
  0x0806: "ARP",
  0x86dd: "IPv6",
  0x8100: "VLAN",
  0x88cc: "LLDP",
};

/** A decoded packet projected for the live capture view. */
export interface PacketSummary {
  /** Capture time (epoch ms), stamped by the receiver. */
  ts: number;
  /** Inner frame length in bytes. */
  len: number;
  srcMac?: string;
  dstMac?: string;
  /** Layer-3 family label (`IPv4`/`IPv6`/`ARP`/ethertype hex). */
  ethType: string;
  src?: string;
  dst?: string;
  /** Transport/L4 protocol name (or number). */
  protocol?: string;
  srcPort?: number;
  dstPort?: number;
  /** Human one-liner, e.g. `TCP 10.0.0.1:443 → 10.0.0.2:51000`. */
  info: string;
}

/** Summarise an Ethernet frame (the inner TZSP payload) for display. */
export function summarizePacket(frame: Uint8Array, ts: number): PacketSummary {
  const s: PacketSummary = { ts, len: frame.length, ethType: "?", info: "" };
  if (frame.length < 14) {
    s.info = `runt frame (${frame.length}B)`;
    return s;
  }
  s.dstMac = mac(frame, 0);
  s.srcMac = mac(frame, 6);
  let ethType = (frame[12] << 8) | frame[13];
  let l3 = 14;
  if (ethType === 0x8100 && frame.length >= 18) {
    // 802.1Q VLAN tag → real ethertype is 4 bytes further in.
    ethType = (frame[16] << 8) | frame[17];
    l3 = 18;
  }
  s.ethType = ETHERTYPE[ethType] ?? `0x${ethType.toString(16).padStart(4, "0")}`;

  if (ethType === 0x0800 && frame.length >= l3 + 20) {
    const ihl = (frame[l3] & 0x0f) * 4;
    const proto = frame[l3 + 9];
    s.src = ipv4(frame, l3 + 12);
    s.dst = ipv4(frame, l3 + 16);
    s.protocol = IP_PROTO[proto] ?? String(proto);
    readPorts(frame, l3 + ihl, proto, s);
  } else if (ethType === 0x86dd && frame.length >= l3 + 40) {
    const proto = frame[l3 + 6];
    s.src = ipv6(frame, l3 + 8);
    s.dst = ipv6(frame, l3 + 24);
    s.protocol = IP_PROTO[proto] ?? String(proto);
    readPorts(frame, l3 + 40, proto, s);
  }

  s.info = buildInfo(s);
  return s;
}

function readPorts(frame: Uint8Array, l4: number, proto: number, s: PacketSummary): void {
  if ((proto === 6 || proto === 17) && frame.length >= l4 + 4) {
    s.srcPort = (frame[l4] << 8) | frame[l4 + 1];
    s.dstPort = (frame[l4 + 2] << 8) | frame[l4 + 3];
  }
}

function buildInfo(s: PacketSummary): string {
  if (s.src && s.dst) {
    const sp = s.srcPort != null ? `:${s.srcPort}` : "";
    const dp = s.dstPort != null ? `:${s.dstPort}` : "";
    return `${s.protocol ?? "IP"} ${s.src}${sp} → ${s.dst}${dp}`;
  }
  if (s.ethType === "ARP") return `ARP ${s.srcMac} → ${s.dstMac}`;
  return `${s.ethType} ${s.srcMac ?? "?"} → ${s.dstMac ?? "?"}`;
}

// ── pcap (classic, little-endian) ────────────────────────────────────────────

/** The 24-byte pcap global header (Ethernet link type, microsecond resolution). */
export function pcapGlobalHeader(): Uint8Array {
  const h = new Uint8Array(24);
  const v = new DataView(h.buffer);
  v.setUint32(0, 0xa1b2c3d4, true); // magic
  v.setUint16(4, 2, true); // version major
  v.setUint16(6, 4, true); // version minor
  v.setUint32(8, 0, true); // thiszone
  v.setUint32(12, 0, true); // sigfigs
  v.setUint32(16, 0x40000, true); // snaplen (262144)
  v.setUint32(20, 1, true); // network = LINKTYPE_ETHERNET
  return h;
}

/** A 16-byte pcap record header + the frame bytes, timestamped at `tsMs`. */
export function pcapRecord(frame: Uint8Array, tsMs: number): Uint8Array {
  const rec = new Uint8Array(16 + frame.length);
  const v = new DataView(rec.buffer);
  v.setUint32(0, Math.floor(tsMs / 1000), true); // ts seconds
  v.setUint32(4, Math.floor((tsMs % 1000) * 1000), true); // ts microseconds
  v.setUint32(8, frame.length, true); // captured length
  v.setUint32(12, frame.length, true); // original length
  rec.set(frame, 16);
  return rec;
}
