/**
 * Per-host traffic aggregation for the Clients page.
 *
 * The Traffic column was empty because it read `/queue simple`, which only
 * exists for clients that have a queue. It now reads `/ip accounting`, which
 * measures every LAN host. The one subtle part is direction: a snapshot row is
 * `src → dst → bytes`, and for a host, bytes where it is the *destination* are
 * download, bytes where it is the *source* are upload. These pin that mapping,
 * and that it parses real RouterOS snapshot output.
 */
import { describe, expect, test } from "vite-plus/test";
import { aggregateHostTraffic } from "../src/tools/connected-devices";
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
