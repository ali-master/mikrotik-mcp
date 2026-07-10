/**
 * Per-host traffic parsing for the Clients page, for both RouterOS sources:
 * `/ip accounting` (v6) and Kid Control (v7).
 *
 * Accounting: a snapshot row is `src → dst → bytes`; for a host, bytes where it
 * is the *destination* are download and where it is the *source* are upload.
 * Kid Control: rows carry rate/bytes per device directly, keyed by IP.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  aggregateHostTraffic,
  parseKidDevices,
  parseMagnitude,
} from "../src/tools/connected-devices";
import { parseRecords } from "../src/core/routeros-parse";

describe("aggregateHostTraffic", () => {
  test("dst = download (rx), src = upload (tx)", () => {
    const hosts = aggregateHostTraffic([
      { "src-address": "192.168.88.10", "dst-address": "142.250.0.1", bytes: "1500000" },
      { "src-address": "142.250.0.1", "dst-address": "192.168.88.10", bytes: "42000000" },
    ]);
    expect(hosts["192.168.88.10"]).toEqual({ rxBytes: 42000000, txBytes: 1500000 });
  });

  test("sums multiple rows per host", () => {
    const hosts = aggregateHostTraffic([
      { "src-address": "10.0.0.5", "dst-address": "8.8.8.8", bytes: "100" },
      { "src-address": "10.0.0.5", "dst-address": "9.9.9.9", bytes: "250" },
      { "src-address": "1.1.1.1", "dst-address": "10.0.0.5", bytes: "900" },
    ]);
    expect(hosts["10.0.0.5"]).toEqual({ rxBytes: 900, txBytes: 350 });
  });

  test("a LAN↔LAN transfer counts up for sender, down for receiver", () => {
    const hosts = aggregateHostTraffic([
      { "src-address": "192.168.88.10", "dst-address": "192.168.88.20", bytes: "5000" },
    ]);
    expect(hosts["192.168.88.10"]!.txBytes).toBe(5000); // sender uploaded
    expect(hosts["192.168.88.20"]!.rxBytes).toBe(5000); // receiver downloaded
  });

  test("skips zero-byte and address-less rows", () => {
    const hosts = aggregateHostTraffic([
      { "src-address": "10.0.0.1", "dst-address": "10.0.0.2", bytes: "0" },
      { "src-address": "", "dst-address": "", bytes: "500" },
    ]);
    expect(hosts).toEqual({});
  });

  test("parses real `/ip accounting snapshot print` output", () => {
    const snap = ` # SRC-ADDRESS     DST-ADDRESS     PACKETS  BYTES
 0 192.168.88.10   142.250.185.14  1200     1500000
 1 142.250.185.14  192.168.88.10   3400     42000000
 2 192.168.88.20   9.9.9.9         50       6000`;
    const hosts = aggregateHostTraffic(parseRecords(snap).rows);
    expect(hosts["192.168.88.10"]).toEqual({ rxBytes: 42000000, txBytes: 1500000 });
    expect(hosts["192.168.88.20"]).toEqual({ rxBytes: 0, txBytes: 6000 });
  });
});

describe("parseMagnitude", () => {
  test("plain integers and decimals", () => {
    expect(parseMagnitude("512000")).toBe(512000);
    expect(parseMagnitude("1.5")).toBe(1.5);
  });
  test("k/M/G/T suffixes (decimal, RouterOS style)", () => {
    expect(parseMagnitude("1.5M")).toBe(1_500_000);
    expect(parseMagnitude("512k")).toBe(512_000);
    expect(parseMagnitude("2G")).toBe(2_000_000_000);
  });
  test("empty / junk → 0", () => {
    expect(parseMagnitude(undefined)).toBe(0);
    expect(parseMagnitude("")).toBe(0);
    expect(parseMagnitude("n/a")).toBe(0);
  });
});

describe("parseKidDevices (RouterOS v7 Kid Control)", () => {
  test("maps rate-down/up → rx/tx and bytes, keyed by ip", () => {
    const hosts = parseKidDevices([
      {
        "mac-address": "AA:BB:CC:DD:EE:01",
        "ip-address": "192.168.88.10",
        "rate-down": "8000000",
        "rate-up": "512000",
        "bytes-down": "42000000",
        "bytes-up": "1500000",
      },
    ]);
    expect(hosts["192.168.88.10"]).toEqual({
      rxRate: 8_000_000, // download
      txRate: 512_000, // upload
      rxBytes: 42_000_000,
      txBytes: 1_500_000,
    });
  });

  test("honours k/M suffixes in rate/byte fields", () => {
    const hosts = parseKidDevices([
      {
        "ip-address": "10.0.0.5",
        "rate-down": "1.5M",
        "rate-up": "256k",
        "bytes-down": "2G",
        "bytes-up": "10M",
      },
    ]);
    expect(hosts["10.0.0.5"]).toEqual({
      rxRate: 1_500_000,
      txRate: 256_000,
      rxBytes: 2_000_000_000,
      txBytes: 10_000_000,
    });
  });

  test("skips devices with no ip-address (MAC-only)", () => {
    const hosts = parseKidDevices([
      { "mac-address": "AA:BB:CC:DD:EE:02", "rate-down": "1000", "rate-up": "500" },
    ]);
    expect(hosts).toEqual({});
  });

  test("parses real `/ip kid-control device print detail` output", () => {
    const out = ` Flags: E - enabled, B - blocked, D - dynamic, R - rate-limited
 0 E name="phone" user="mcp-monitor" mac-address=AA:BB:CC:DD:EE:10
     ip-address=192.168.88.30 rate-down=3200000 rate-up=180000
     bytes-down=91000000 bytes-up=4200000 idle-time=1s activity=browsing`;
    const hosts = parseKidDevices(parseRecords(out).rows);
    expect(hosts["192.168.88.30"]).toEqual({
      rxRate: 3_200_000,
      txRate: 180_000,
      rxBytes: 91_000_000,
      txBytes: 4_200_000,
    });
  });
});
