/**
 * Unit tests for the pure CAPsMAN engine + wire normaliser. No device I/O.
 *
 * Fixtures cover the plan §9 cases: co-channel conflict, resource-starved CAP
 * beside an idle one, FT-misconfigured SSID (inconsistent mobility domain), a
 * single-manager (no-HA) topology, a floor-tag-missing case that falls back to
 * signal adjacency, and an already-optimal fleet (must yield ZERO findings).
 */
import { describe, expect, test } from "vite-plus/test";
import {
  bandOf,
  buildAdjacency,
  buildChannelPlanCommands,
  channelToFrequencyMhz,
  buildLoadBalanceCommands,
  buildSteerCommands,
  emptyCapsmanState,
  loadBalancePlan,
  parseFloorTag,
  proposeChannelPlan,
  reportWeakClients,
  runCapsmanAudit,
  steerAlreadyPresent,
} from "../../src/core/capsman";
import type { CapRadio, CapsmanState, WifiClient } from "../../src/core/capsman";
import { normalizeCapsmanState } from "../../src/core/capsman-normalize";

// ── Builders ─────────────────────────────────────────────────────────────────

function radio(over: Partial<CapRadio> & Pick<CapRadio, "cap" | "radioId">): CapRadio {
  return { band: "2ghz", clientCount: 0, ...over };
}
function client(
  over: Partial<WifiClient> & Pick<WifiClient, "mac" | "radioId" | "signal">,
): WifiClient {
  return { band: "2ghz", ...over };
}
function state(over: Partial<CapsmanState>): CapsmanState {
  return { ...emptyCapsmanState(), ...over };
}

// ── Floor tag (plan §3-A) ────────────────────────────────────────────────────

describe("parseFloorTag", () => {
  test("parses an identity convention like AP-F3-E into floor and zone", () => {
    expect(parseFloorTag("AP-F3-E")).toEqual({ floor: "3", zone: "E" });
  });
  test("parses an explicit floor=/zone= comment tag", () => {
    expect(parseFloorTag(";;; floor=2 zone=west")).toEqual({ floor: "2", zone: "west" });
  });
  test("returns empty when nothing parses (falls back to adjacency)", () => {
    expect(parseFloorTag("office-ap")).toEqual({});
  });
});

// ── Band inference ───────────────────────────────────────────────────────────

describe("bandOf", () => {
  test("infers 5ghz from a 5180 MHz channel when band is unknown", () => {
    expect(bandOf(radio({ cap: "a", radioId: "r1", band: "unknown", channel: 5180 }))).toBe("5ghz");
  });
  test("infers 2ghz from channel 6 when band is unknown", () => {
    expect(bandOf(radio({ cap: "a", radioId: "r1", band: "unknown", channel: 6 }))).toBe("2ghz");
  });
});

// ── Adjacency (plan §3-C) ────────────────────────────────────────────────────

describe("buildAdjacency", () => {
  test("links two radios when a client on one is also heard on the other", () => {
    const adj = buildAdjacency([
      client({ mac: "aa", radioId: "r1", signal: -60, seenOn: { r2: -72 } }),
    ]);
    expect(adj.get("r1")?.has("r2")).toBe(true);
    expect(adj.get("r2")?.has("r1")).toBe(true); // symmetric
  });
  test("does not link a radio the client can barely hear (below noise floor)", () => {
    const adj = buildAdjacency([
      client({ mac: "aa", radioId: "r1", signal: -60, seenOn: { r2: -90 } }),
    ]);
    expect(adj.get("r1")?.has("r2") ?? false).toBe(false);
  });
});

// ── §4.A coverage / co-channel ───────────────────────────────────────────────

describe("coverage / co-channel", () => {
  test("flags two adjacent radios on the same 2.4 GHz channel", () => {
    const s = state({
      radios: [
        radio({ cap: "AP-F1-A", radioId: "r1", band: "2ghz", channel: 6, clientCount: 10 }),
        radio({ cap: "AP-F1-B", radioId: "r2", band: "2ghz", channel: 6, clientCount: 8 }),
      ],
      clients: [client({ mac: "aa", radioId: "r1", signal: -55, seenOn: { r2: -70 } })],
    });
    const f = runCapsmanAudit(s, { categories: ["coverage"] }).findings;
    expect(f.some((x) => x.finding_id.startsWith("cochannel:"))).toBe(true);
    expect(f[0].confidence).toBe("proven");
  });

  test("does NOT flag adjacent radios on different channels", () => {
    const s = state({
      radios: [
        radio({ cap: "a", radioId: "r1", band: "2ghz", channel: 1 }),
        radio({ cap: "b", radioId: "r2", band: "2ghz", channel: 11 }),
      ],
      clients: [client({ mac: "aa", radioId: "r1", signal: -55, seenOn: { r2: -70 } })],
    });
    expect(runCapsmanAudit(s, { categories: ["coverage"] }).total).toBe(0);
  });

  test("proposes non-overlapping 1/6/11 channels to two adjacent 2.4 GHz radios", () => {
    const s = state({
      radios: [
        radio({ cap: "a", radioId: "r1", band: "2ghz", channel: 6, clientCount: 20 }),
        radio({ cap: "b", radioId: "r2", band: "2ghz", channel: 6, clientCount: 5 }),
      ],
      clients: [client({ mac: "aa", radioId: "r1", signal: -55, seenOn: { r2: -70 } })],
    });
    const plan = proposeChannelPlan(s);
    expect(plan.get("r1")).not.toBe(plan.get("r2")); // adjacent → different channels
    expect([1, 6, 11]).toContain(plan.get("r1"));
  });
});

// ── §4.B weak-signal + neighbor recommendation ───────────────────────────────

describe("weak-signal clients", () => {
  test("recommends the neighbor radio a weak client hears meaningfully stronger", () => {
    const s = state({
      radios: [radio({ cap: "AP-F2-A", radioId: "r1" }), radio({ cap: "AP-F2-B", radioId: "r2" })],
      clients: [client({ mac: "aa", radioId: "r1", signal: -78, seenOn: { r2: -60 } })],
    });
    const [w] = reportWeakClients(s);
    expect(w.recommendCap).toBe("AP-F2-B");
    expect(w.gainDb).toBe(18);
  });

  test("reports a coverage gap (no recommendation) when no neighbor is better", () => {
    const s = state({
      radios: [radio({ cap: "a", radioId: "r1" })],
      clients: [client({ mac: "aa", radioId: "r1", signal: -80, seenOn: { r2: -84 } })],
    });
    const [w] = reportWeakClients(s);
    expect(w.recommendCap).toBeUndefined();
  });

  test("ignores clients at or above the threshold", () => {
    const s = state({
      radios: [radio({ cap: "a", radioId: "r1" })],
      clients: [client({ mac: "aa", radioId: "r1", signal: -65 })],
    });
    expect(reportWeakClients(s, -70)).toHaveLength(0);
  });

  test("honours a custom threshold", () => {
    const s = state({
      radios: [radio({ cap: "a", radioId: "r1" })],
      clients: [client({ mac: "aa", radioId: "r1", signal: -68 })],
    });
    expect(reportWeakClients(s, -60)).toHaveLength(1);
  });

  test("weak-signal findings are needs_live_verification (steering is advisory)", () => {
    const s = state({
      radios: [radio({ cap: "a", radioId: "r1" })],
      clients: [client({ mac: "aa", radioId: "r1", signal: -80 })],
    });
    expect(runCapsmanAudit(s, { categories: ["weak_signal"] }).findings[0].confidence).toBe(
      "needs_live_verification",
    );
  });
});

// ── §4.C resource-aware load ─────────────────────────────────────────────────

describe("resource-aware load", () => {
  test("flags a CPU-constrained CAP beside an idle neighbor and points at it", () => {
    const s = state({
      radios: [
        radio({ cap: "AP-F3-A", radioId: "r1", clientCount: 30, cpuLoad: 92 }),
        radio({ cap: "AP-F3-B", radioId: "r2", clientCount: 4, cpuLoad: 20 }),
      ],
      clients: [client({ mac: "aa", radioId: "r1", signal: -55, seenOn: { r2: -68 } })],
    });
    const f = runCapsmanAudit(s, { categories: ["load"] }).findings;
    expect(f[0].finding_id).toBe("load:r1");
    expect(f[0].detail).toContain("AP-F3-B");
  });

  test("does not flag radios within client + CPU limits", () => {
    const s = state({
      radios: [radio({ cap: "a", radioId: "r1", clientCount: 10, cpuLoad: 30 })],
    });
    expect(runCapsmanAudit(s, { categories: ["load"] }).total).toBe(0);
  });
});

// ── §4.D FT + HA ─────────────────────────────────────────────────────────────

describe("FT audit", () => {
  test("flags an SSID with fast-transition off", () => {
    const s = state({ securityConfigs: [{ name: "corp", ssid: "Corp", ft: false }] });
    expect(runCapsmanAudit(s, { categories: ["ft"] }).findings[0].finding_id).toBe("ft-off:corp");
  });

  test("flags inconsistent mobility domains across CAPs (the misconfig fixture)", () => {
    const s = state({
      securityConfigs: [
        { name: "a", ssid: "Corp", ft: true, rrm: true, wnm: true, ftMobilityDomain: "aa11" },
        { name: "b", ssid: "Corp", ft: true, rrm: true, wnm: true, ftMobilityDomain: "bb22" },
      ],
    });
    expect(
      runCapsmanAudit(s, { categories: ["ft"] }).findings.some(
        (f) => f.finding_id === "ft-domain-mismatch",
      ),
    ).toBe(true);
  });

  test("passes a fully-consistent FT config", () => {
    const s = state({
      securityConfigs: [
        { name: "a", ssid: "Corp", ft: true, rrm: true, wnm: true, ftMobilityDomain: "aa11" },
        { name: "b", ssid: "Corp", ft: true, rrm: true, wnm: true, ftMobilityDomain: "aa11" },
      ],
    });
    expect(runCapsmanAudit(s, { categories: ["ft"] }).total).toBe(0);
  });
});

describe("HA audit", () => {
  test("flags a single-manager topology as a single point of failure", () => {
    const s = state({ managerEnabled: true, managerCount: 1, capsHaveBackupManager: false });
    expect(
      runCapsmanAudit(s, { categories: ["ha"] }).findings.some(
        (f) => f.finding_id === "ha-single-manager",
      ),
    ).toBe(true);
  });

  test("flags HA present but without peer-certificate enforcement", () => {
    const s = state({
      managerEnabled: true,
      managerCount: 2,
      capsHaveBackupManager: true,
      requirePeerCertificate: false,
    });
    expect(
      runCapsmanAudit(s, { categories: ["ha"] }).findings.some(
        (f) => f.finding_id === "ha-no-cert",
      ),
    ).toBe(true);
  });

  test("is not applicable when this device is not a manager", () => {
    expect(runCapsmanAudit(state({ managerEnabled: false }), { categories: ["ha"] }).total).toBe(0);
  });
});

// ── Idempotency / clean fleet ────────────────────────────────────────────────

describe("orchestrator", () => {
  test("an already-optimal fleet yields ZERO findings", () => {
    const s = state({
      managerEnabled: true,
      managerCount: 2,
      capsHaveBackupManager: true,
      requirePeerCertificate: true,
      radios: [
        radio({
          cap: "AP-F1-A",
          radioId: "r1",
          band: "2ghz",
          channel: 1,
          clientCount: 10,
          cpuLoad: 30,
        }),
        radio({
          cap: "AP-F1-B",
          radioId: "r2",
          band: "5ghz",
          channel: 36,
          clientCount: 12,
          cpuLoad: 40,
        }),
      ],
      clients: [
        client({ mac: "aa", radioId: "r1", signal: -55, seenOn: { r2: -60 } }),
        client({ mac: "bb", radioId: "r2", signal: -58, band: "5ghz" }),
      ],
      securityConfigs: [
        { name: "corp", ssid: "Corp", ft: true, rrm: true, wnm: true, ftMobilityDomain: "aa11" },
      ],
    });
    expect(runCapsmanAudit(s).total).toBe(0);
  });

  test("ranks findings critical/high-first and tallies the summary", () => {
    const s = state({
      managerEnabled: true,
      managerCount: 1,
      radios: [
        radio({ cap: "a", radioId: "r1", band: "2ghz", channel: 6 }),
        radio({ cap: "b", radioId: "r2", band: "2ghz", channel: 6 }),
      ],
      clients: [client({ mac: "aa", radioId: "r1", signal: -80, seenOn: { r2: -55 } })],
    });
    const report = runCapsmanAudit(s);
    expect(report.total).toBe(report.findings.length);
    expect(report.summary.high).toBeGreaterThanOrEqual(1);
  });
});

// ── Normaliser (wire → model), incl. floor-tag-missing fallback ──────────────

describe("normalizeCapsmanState", () => {
  test("null (no wireless) yields an empty controller state", () => {
    expect(normalizeCapsmanState(null).managerEnabled).toBe(false);
  });

  test("maps radios + registrations and counts clients per radio", () => {
    const s = normalizeCapsmanState({
      path: "/interface wifi",
      manager: {
        enabled: "yes",
        "caps-man-addresses": "10.0.0.1,10.0.0.2",
        "require-peer-certificate": "yes",
      },
      remoteCaps: [],
      radios: [{ name: "cap1", identity: "AP-F2-A", band: "2ghz-g/n", channel: "2437" }],
      registrations: [
        { "mac-address": "aa:bb", interface: "cap1", signal: "-62" },
        { "mac-address": "cc:dd", interface: "cap1", signal: "-71" },
      ],
      securityConfigs: [{ name: "corp", ssid: "Corp", ft: "no" }],
      accessList: [],
      resources: { "AP-F2-A": { cpuLoad: 25 } },
    });
    expect(s.managerEnabled).toBe(true);
    expect(s.capsHaveBackupManager).toBe(true); // two caps-man addresses
    expect(s.requirePeerCertificate).toBe(true);
    expect(s.radios[0]).toMatchObject({
      cap: "AP-F2-A",
      band: "2ghz",
      floor: "2",
      zone: "A",
      clientCount: 2,
      cpuLoad: 25,
    });
    expect(s.clients).toHaveLength(2);
  });

  test("floor-tag-missing radio still normalises (adjacency will cover it)", () => {
    const s = normalizeCapsmanState({
      path: "/interface wifi",
      manager: { enabled: "yes" },
      remoteCaps: [],
      radios: [{ name: "cap1", identity: "office-ap", band: "5ghz-ac", channel: "5180" }],
      registrations: [],
      securityConfigs: [],
      accessList: [],
      resources: {},
    });
    expect(s.radios[0].floor).toBeUndefined();
    expect(s.radios[0].band).toBe("5ghz");
  });
});

// ── Phase 2: steering + load-balance write builders ──────────────────────────

describe("buildSteerCommands", () => {
  test("hard mode builds a signal-range reject on the client's current radio", () => {
    const s = state({ path: "/interface wifi" });
    const cmds = buildSteerCommands(s, "AA:BB:CC", "cap1", "hard", -72);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toContain("/interface wifi access-list add");
    expect(cmds[0]).toContain("mac-address=AA:BB:CC");
    expect(cmds[0]).toContain("interface=cap1");
    expect(cmds[0]).toContain("signal-range=-120..-72");
    expect(cmds[0]).toContain("action=reject");
    expect(cmds[0]).toContain('comment="capsman-steer: AA:BB:CC"');
  });

  test("soft mode writes nothing (802.11k/v is advisory-only)", () => {
    expect(buildSteerCommands(state({}), "AA:BB:CC", "cap1", "soft")).toHaveLength(0);
  });

  test("uses the legacy /caps-man access-list menu on a caps-man device", () => {
    const cmds = buildSteerCommands(state({ path: "/caps-man" }), "AA", "cap1", "hard");
    expect(cmds[0]).toContain("/caps-man access-list add");
  });
});

describe("steerAlreadyPresent (idempotency)", () => {
  test("true when a steer rule for the MAC already exists", () => {
    const s = state({ accessList: [{ macAddress: "aa:bb", comment: "capsman-steer: aa:bb" }] });
    expect(steerAlreadyPresent(s, "AA:BB")).toBe(true);
  });
  test("false when no steer rule exists for the MAC", () => {
    expect(steerAlreadyPresent(state({ accessList: [] }), "AA:BB")).toBe(false);
  });
});

describe("loadBalancePlan + buildLoadBalanceCommands", () => {
  test("plans an offload from an overloaded radio toward an idle adjacent neighbor", () => {
    const s = state({
      path: "/interface wifi",
      radios: [
        radio({ cap: "AP-A", radioId: "r1", clientCount: 40, cpuLoad: 90 }),
        radio({ cap: "AP-B", radioId: "r2", clientCount: 3, cpuLoad: 20 }),
      ],
      clients: [client({ mac: "aa", radioId: "r1", signal: -55, seenOn: { r2: -66 } })],
    });
    const plan = loadBalancePlan(s);
    expect(plan).toEqual([{ radioId: "r1", cap: "AP-A", targetRadioId: "r2", targetCap: "AP-B" }]);
    const cmds = buildLoadBalanceCommands(s, plan);
    expect(cmds[0]).toContain("interface=r1");
    expect(cmds[0]).toContain('comment="capsman-lb: r1 → r2"');
  });

  test("skips a radio whose load-balance rule already exists (idempotent)", () => {
    const s = state({
      path: "/interface wifi",
      accessList: [{ comment: "capsman-lb: r1 → r2" }],
      radios: [
        radio({ cap: "AP-A", radioId: "r1", clientCount: 40, cpuLoad: 90 }),
        radio({ cap: "AP-B", radioId: "r2", clientCount: 3 }),
      ],
      clients: [client({ mac: "aa", radioId: "r1", signal: -55, seenOn: { r2: -66 } })],
    });
    expect(buildLoadBalanceCommands(s, loadBalancePlan(s))).toHaveLength(0);
  });

  test("empty plan when no overloaded radio has an idle neighbor", () => {
    const s = state({
      radios: [radio({ cap: "AP-A", radioId: "r1", clientCount: 40, cpuLoad: 90 })],
    });
    expect(loadBalancePlan(s)).toHaveLength(0);
  });
});

// ── Phase 3: channel-plan apply ──────────────────────────────────────────────

describe("channelToFrequencyMhz", () => {
  test("maps 2.4 GHz channels 1/6/11 to 2412/2437/2462 MHz", () => {
    expect(channelToFrequencyMhz(1, "2ghz")).toBe(2412);
    expect(channelToFrequencyMhz(6, "2ghz")).toBe(2437);
    expect(channelToFrequencyMhz(11, "2ghz")).toBe(2462);
  });
  test("maps 5 GHz channel 36 to 5180 MHz", () => {
    expect(channelToFrequencyMhz(36, "5ghz")).toBe(5180);
  });
});

describe("buildChannelPlanCommands", () => {
  test("emits a frequency set for a radio not on its proposed channel", () => {
    const s = state({
      path: "/interface wifi",
      radios: [
        radio({ cap: "AP-A", radioId: "r1", band: "2ghz", channel: 6, clientCount: 20 }),
        radio({ cap: "AP-B", radioId: "r2", band: "2ghz", channel: 6, clientCount: 5 }),
      ],
      clients: [client({ mac: "aa", radioId: "r1", signal: -55, seenOn: { r2: -70 } })],
    });
    const cmds = buildChannelPlanCommands(s);
    // Both start on 6; the plan gives adjacent radios different channels, so at
    // least one radio is re-channeled to a clean 2.4 GHz frequency.
    expect(cmds.length).toBeGreaterThanOrEqual(1);
    expect(cmds.every((c) => c.includes("channel.frequency="))).toBe(true);
  });

  test("is a no-op (idempotent) when every radio is already on its proposed channel", () => {
    const s = state({
      path: "/interface wifi",
      radios: [
        radio({ cap: "AP-A", radioId: "r1", band: "2ghz", channel: 1 }),
        radio({ cap: "AP-B", radioId: "r2", band: "2ghz", channel: 6 }),
      ],
      clients: [client({ mac: "aa", radioId: "r1", signal: -55, seenOn: { r2: -70 } })],
    });
    // r1→1, r2→6 already satisfies the plan (adjacent, different) → no changes.
    expect(buildChannelPlanCommands(s)).toHaveLength(0);
  });

  test("scopes to radio_ids when provided", () => {
    const s = state({
      path: "/interface wifi",
      radios: [
        radio({ cap: "AP-A", radioId: "r1", band: "2ghz", channel: 6, clientCount: 20 }),
        radio({ cap: "AP-B", radioId: "r2", band: "2ghz", channel: 6, clientCount: 5 }),
      ],
      clients: [client({ mac: "aa", radioId: "r1", signal: -55, seenOn: { r2: -70 } })],
    });
    const cmds = buildChannelPlanCommands(s, new Set(["r1"]));
    expect(cmds.every((c) => !c.includes('name="r2"'))).toBe(true);
  });

  test("returns no commands on a legacy /caps-man device (manual channel objects)", () => {
    const s = state({
      path: "/caps-man",
      radios: [radio({ cap: "AP-A", radioId: "r1", band: "2ghz", channel: 6, clientCount: 20 })],
    });
    expect(buildChannelPlanCommands(s)).toHaveLength(0);
  });
});
