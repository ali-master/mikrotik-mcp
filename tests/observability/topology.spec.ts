/**
 * Unit tests for the pure topology model (neighbour parsing + graph building).
 * No device, no Bun, no SQLite.
 */
import { describe, expect, test } from "vite-plus/test";
import type { DeviceConfig } from "../../src/config";
import type { DeviceStatus } from "../../src/observability/health";
import { buildTopology, parseNeighbors } from "../../src/observability/topology";
import type { TopologyInput } from "../../src/observability/topology";

const NEIGHBOR_DETAIL = `Flags: X - disabled, I - invalid
 0   interface=ether1 address=192.168.88.2 mac-address=64:D1:54:AA:BB:01 identity="core-sw"
     platform="MikroTik" version="7.14.3" board=CRS326 age=9s

 1   interface=ether2 address=10.0.0.5 mac-address=64:D1:54:AA:BB:02 identity="router-b"
     platform="MikroTik" version="7.12" board=RB760iGS age=3s
`;

function device(
  name: string,
  config: Partial<DeviceConfig>,
  status: Partial<DeviceStatus> = {},
): TopologyInput["devices"][number] {
  return {
    name,
    config: { host: "127.0.0.1", port: 22, username: "admin", ...config } as DeviceConfig,
    status: { reachable: true, checkedAt: 1, latencyMs: 1, ...status },
  };
}

describe("parseNeighbors", () => {
  test("parses identity, mac, ip, interface, board and version", () => {
    const ns = parseNeighbors(NEIGHBOR_DETAIL);
    expect(ns).toHaveLength(2);
    const core = ns.find((n) => n.identity === "core-sw");
    expect(core).toMatchObject({
      interface: "ether1",
      ip: "192.168.88.2",
      mac: "64:D1:54:AA:BB:01",
      board: "CRS326",
      version: "7.14.3",
      platform: "MikroTik",
    });
  });

  test("returns an empty list for empty / no-data output", () => {
    expect(parseNeighbors("")).toEqual([]);
    expect(parseNeighbors("no such item")).toEqual([]);
  });
});

describe("buildTopology", () => {
  test("matches a neighbour to a configured device by IP, yielding a device↔device edge", () => {
    const input: TopologyInput = {
      devices: [
        device("gw", { host: "192.168.88.1" }, { cpuLoad: 12, memUsedPct: 40 }),
        device("router-b", { host: "10.0.0.5" }),
      ],
      neighborsByDevice: {
        gw: parseNeighbors(NEIGHBOR_DETAIL), // sees core-sw (external) + router-b (configured)
        "router-b": [],
      },
    };
    const g = buildTopology(input);

    // router-b is a configured device, so the neighbour folds into it — no extra node.
    const deviceNodes = g.nodes.filter((n) => n.kind === "device");
    expect(deviceNodes.map((n) => n.id).sort()).toEqual(["gw", "router-b"]);

    // The edge gw→router-b exists and is labelled with the local interface.
    expect(g.edges).toContainEqual({ from: "gw", to: "router-b", interface: "ether2" });

    // Inline health rode along on the configured node.
    const gw = g.nodes.find((n) => n.id === "gw");
    expect(gw?.cpuLoad).toBe(12);
    expect(gw?.memUsedPct).toBe(40);
  });

  test("an unmatched neighbour becomes an onboardable node with a config stub", () => {
    const input: TopologyInput = {
      devices: [device("gw", { host: "192.168.88.1" })],
      neighborsByDevice: { gw: parseNeighbors(NEIGHBOR_DETAIL) },
    };
    const g = buildTopology(input);

    const core = g.nodes.find((n) => n.identity === "core-sw");
    expect(core?.kind).toBe("neighbor");
    expect(core?.onboardable).toBe(true);
    expect(core?.suggestedConfig).toMatchObject({
      host: "192.168.88.2",
      port: 22,
      username: "admin",
    });
    // Only 'gw' is configured here, so BOTH discovered neighbours are onboardable.
    expect(g.stats.onboardable).toBe(2);
  });

  test("the same neighbour seen by two devices is deduplicated into one node with two edges", () => {
    const input: TopologyInput = {
      devices: [device("gw", { host: "192.168.88.1" }), device("spur", { host: "192.168.88.9" })],
      neighborsByDevice: {
        gw: parseNeighbors(NEIGHBOR_DETAIL),
        spur: parseNeighbors(NEIGHBOR_DETAIL),
      },
    };
    const g = buildTopology(input);
    const coreNodes = g.nodes.filter((n) => n.identity === "core-sw");
    expect(coreNodes).toHaveLength(1);
    const edgesToCore = g.edges.filter((e) => e.to === coreNodes[0].id);
    expect(edgesToCore.map((e) => e.from).sort()).toEqual(["gw", "spur"]);
  });

  test("matches a configured MAC-Telnet device by MAC address", () => {
    const input: TopologyInput = {
      devices: [
        device("gw", { host: "192.168.88.1" }),
        device("edge", { mac: "64:d1:54:aa:bb:01" }), // lower-case + same MAC as core-sw
      ],
      neighborsByDevice: { gw: parseNeighbors(NEIGHBOR_DETAIL), edge: [] },
    };
    const g = buildTopology(input);
    // core-sw's MAC matches the configured 'edge' device → folds in, not onboardable.
    expect(g.nodes.some((n) => n.identity === "core-sw" && n.kind === "neighbor")).toBe(false);
    expect(g.edges).toContainEqual({ from: "gw", to: "edge", interface: "ether1" });
  });

  test("never emits a self-link", () => {
    // A device that somehow reports itself (its own host) as a neighbour.
    const selfText = ` 0 interface=ether1 address=192.168.88.1 mac-address=00:00:00:00:00:01 identity="gw"\n`;
    const input: TopologyInput = {
      devices: [device("gw", { host: "192.168.88.1" }, { identity: "gw" })],
      neighborsByDevice: { gw: parseNeighbors(selfText) },
    };
    const g = buildTopology(input);
    expect(g.edges.every((e) => e.from !== e.to)).toBe(true);
  });
});
