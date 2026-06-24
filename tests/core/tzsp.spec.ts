/**
 * Unit tests for the pure TZSP decoder + pcap writer. No sockets.
 */
import { describe, expect, test } from "vite-plus/test";
import { decodeTzsp, pcapGlobalHeader, pcapRecord, summarizePacket } from "../../src/core/tzsp";

/** Build an Ethernet/IPv4/UDP frame: 10.0.0.1:53 → 10.0.0.2:1024. */
function ethIpv4Udp(): Uint8Array {
  const f = new Uint8Array(14 + 20 + 8);
  // Ethernet
  f.set([0x11, 0x22, 0x33, 0x44, 0x55, 0x66], 0); // dst mac
  f.set([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff], 6); // src mac
  f[12] = 0x08;
  f[13] = 0x00; // ethertype IPv4
  // IPv4 header (IHL=5)
  f[14] = 0x45;
  f[14 + 9] = 17; // protocol UDP
  f.set([10, 0, 0, 1], 14 + 12); // src ip
  f.set([10, 0, 0, 2], 14 + 16); // dst ip
  // UDP header
  const l4 = 14 + 20;
  f[l4] = 0x00;
  f[l4 + 1] = 53; // src port 53
  f[l4 + 2] = 0x04;
  f[l4 + 3] = 0x00; // dst port 1024
  return f;
}

/** Wrap a frame in a minimal TZSP envelope (version 1, type 0, Ethernet, TAG_END). */
function tzsp(frame: Uint8Array, type = 0): Uint8Array {
  const out = new Uint8Array(5 + frame.length);
  out[0] = 1; // version
  out[1] = type; // type
  out[2] = 0;
  out[3] = 1; // encap = Ethernet
  out[4] = 0x01; // TAG_END
  out.set(frame, 5);
  return out;
}

describe("decodeTzsp", () => {
  test("unwraps an Ethernet frame after TAG_END", () => {
    const frame = ethIpv4Udp();
    const d = decodeTzsp(tzsp(frame));
    expect(d?.encap).toBe(1);
    expect(d?.keepalive).toBe(false);
    expect(d?.frame && [...d.frame]).toEqual([...frame]);
  });

  test("skips tags with length+value before the frame", () => {
    const frame = ethIpv4Udp();
    // version, type, encap, then tag 0x0a len=2 value, then TAG_END, then frame.
    const env = new Uint8Array([1, 0, 0, 1, 0x0a, 0x02, 0xde, 0xad, 0x01, ...frame]);
    const d = decodeTzsp(env);
    expect(d?.frame && [...d.frame]).toEqual([...frame]);
  });

  test("flags a type-4 keepalive and yields no frame", () => {
    const d = decodeTzsp(tzsp(ethIpv4Udp(), 4));
    expect(d?.keepalive).toBe(true);
    expect(d?.frame).toBeUndefined();
  });

  test("returns null for a too-short datagram", () => {
    expect(decodeTzsp(new Uint8Array([1, 0]))).toBeNull();
  });
});

describe("summarizePacket", () => {
  test("decodes Ethernet/IPv4/UDP into addresses, ports and an info line", () => {
    const s = summarizePacket(ethIpv4Udp(), 1000);
    expect(s).toMatchObject({
      ethType: "IPv4",
      src: "10.0.0.1",
      dst: "10.0.0.2",
      protocol: "UDP",
      srcPort: 53,
      dstPort: 1024,
      srcMac: "aa:bb:cc:dd:ee:ff",
      dstMac: "11:22:33:44:55:66",
    });
    expect(s.info).toBe("UDP 10.0.0.1:53 → 10.0.0.2:1024");
  });

  test("handles a runt frame without throwing", () => {
    const s = summarizePacket(new Uint8Array(4), 0);
    expect(s.info).toMatch(/runt/);
  });
});

describe("pcap", () => {
  test("global header carries the pcap magic and Ethernet link type", () => {
    const h = pcapGlobalHeader();
    expect(h.length).toBe(24);
    const v = new DataView(h.buffer);
    expect(v.getUint32(0, true)).toBe(0xa1b2c3d4);
    expect(v.getUint32(20, true)).toBe(1); // LINKTYPE_ETHERNET
  });

  test("record header has 16 bytes + the frame, with split second/microsecond ts", () => {
    const frame = ethIpv4Udp();
    const rec = pcapRecord(frame, 1500); // 1.5s → 1s + 500000us
    expect(rec.length).toBe(16 + frame.length);
    const v = new DataView(rec.buffer);
    expect(v.getUint32(0, true)).toBe(1); // seconds
    expect(v.getUint32(4, true)).toBe(500_000); // microseconds
    expect(v.getUint32(8, true)).toBe(frame.length); // incl_len
    expect([...rec.subarray(16)]).toEqual([...frame]);
  });
});
