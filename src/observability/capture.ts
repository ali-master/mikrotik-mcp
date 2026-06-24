/**
 * Live packet-capture receiver — a host-side TZSP listener for the dashboard's
 * Packet Capture Studio.
 *
 * RouterOS streams mirrored packets to us as TZSP over UDP (default 37008); this
 * binds that port, unwraps each datagram ({@link decodeTzsp}), summarises the
 * inner frame ({@link summarizePacket}) for the live view, and keeps a bounded
 * ring of summaries + raw frames (for pcap export) plus running protocol and
 * top-talker stats. One process-wide session — the dashboard reads it and the
 * `start_packet_capture`/`stop_packet_capture` tools drive it (same process as
 * the dashboard, so the singleton is shared).
 *
 * Like the SQLite store, the socket is only opened when capture is actually
 * started, so importing this module never binds a port (safe in the test graph).
 */
import { createSocket } from "node:dgram";
import type { Socket } from "node:dgram";
import { decodeTzsp, pcapGlobalHeader, pcapRecord, summarizePacket } from "../core/tzsp";
import type { PacketSummary } from "../core/tzsp";

export const DEFAULT_TZSP_PORT = 37008;
const MAX_SUMMARIES = 2000; // ring buffer for the live view
const MAX_PCAP_FRAMES = 5000; // raw frames kept for pcap export
const MAX_PCAP_BYTES = 16 * 1024 * 1024; // 16 MiB cap on retained frames

export interface CaptureStats {
  running: boolean;
  port: number;
  startedAt: number | null;
  packets: number;
  bytes: number;
  /** Protocol → packet count (TCP/UDP/ICMP/ARP/…). */
  protocols: Record<string, number>;
  /** Top source talkers, busiest first. */
  topTalkers: { addr: string; count: number }[];
  /** Frames retained for pcap export. */
  pcapFrames: number;
}

type Subscriber = (p: PacketSummary) => void;

class CaptureSession {
  private socket: Socket | null = null;
  private port = DEFAULT_TZSP_PORT;
  private startedAt: number | null = null;
  private summaries: PacketSummary[] = [];
  private frames: { frame: Uint8Array; ts: number }[] = [];
  private pcapBytes = 0;
  private packets = 0;
  private bytes = 0;
  private protocols = new Map<string, number>();
  private talkers = new Map<string, number>();
  private subscribers = new Set<Subscriber>();

  get running(): boolean {
    return this.socket !== null;
  }

  /** Bind the TZSP port and begin collecting. Resolves once bound (or on error). */
  start(port = DEFAULT_TZSP_PORT): Promise<{ ok: boolean; error?: string; port: number }> {
    if (this.socket) return Promise.resolve({ ok: true, port: this.port });
    this.reset();
    this.port = port;
    return new Promise((resolve) => {
      const socket = createSocket({ type: "udp4", reuseAddr: true });
      socket.on("error", (e) => {
        if (!this.socket) resolve({ ok: false, error: e.message, port });
        else this.stop();
      });
      socket.on("message", (msg) => this.ingest(new Uint8Array(msg)));
      socket.bind(port, () => {
        this.socket = socket;
        this.startedAt = Date.now();
        resolve({ ok: true, port });
      });
    });
  }

  /** Stop the receiver (does not touch the device). */
  stop(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* already closed */
      }
      this.socket = null;
    }
  }

  private ingest(buf: Uint8Array): void {
    const d = decodeTzsp(buf);
    if (!d || d.keepalive || !d.frame || d.encap !== 1) return; // only Ethernet frames
    const ts = Date.now();
    const summary = summarizePacket(d.frame, ts);

    this.packets += 1;
    this.bytes += summary.len;
    const proto = summary.protocol ?? summary.ethType;
    this.protocols.set(proto, (this.protocols.get(proto) ?? 0) + 1);
    if (summary.src) this.talkers.set(summary.src, (this.talkers.get(summary.src) ?? 0) + 1);

    this.summaries.push(summary);
    if (this.summaries.length > MAX_SUMMARIES) this.summaries.shift();
    if (this.frames.length < MAX_PCAP_FRAMES && this.pcapBytes < MAX_PCAP_BYTES) {
      this.frames.push({ frame: d.frame.slice(), ts });
      this.pcapBytes += d.frame.length;
    }
    for (const cb of this.subscribers) {
      try {
        cb(summary);
      } catch {
        /* a bad subscriber must not break ingestion */
      }
    }
  }

  /** The most recent `limit` summaries, newest first. */
  recent(limit = 200): PacketSummary[] {
    return this.summaries.slice(-Math.max(1, limit)).reverse();
  }

  stats(): CaptureStats {
    const protocols: Record<string, number> = {};
    for (const [k, v] of [...this.protocols.entries()].sort((a, b) => b[1] - a[1])) {
      protocols[k] = v;
    }
    const topTalkers = [...this.talkers.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([addr, count]) => ({ addr, count }));
    return {
      running: this.running,
      port: this.port,
      startedAt: this.startedAt,
      packets: this.packets,
      bytes: this.bytes,
      protocols,
      topTalkers,
      pcapFrames: this.frames.length,
    };
  }

  subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  /** Serialise the retained frames as a classic pcap (Ethernet link type). */
  pcap(): Uint8Array {
    const header = pcapGlobalHeader();
    const records = this.frames.map((f) => pcapRecord(f.frame, f.ts));
    const total = header.length + records.reduce((n, r) => n + r.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    out.set(header, off);
    off += header.length;
    for (const r of records) {
      out.set(r, off);
      off += r.length;
    }
    return out;
  }

  private reset(): void {
    this.startedAt = null;
    this.summaries = [];
    this.frames = [];
    this.pcapBytes = 0;
    this.packets = 0;
    this.bytes = 0;
    this.protocols.clear();
    this.talkers.clear();
  }
}

/** The process-wide capture session (shared by the dashboard and the tools). */
export const capture = new CaptureSession();
