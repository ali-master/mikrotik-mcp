/**
 * Unit tests for the Security Shield rule-builder — the pure function that turns
 * selected protections into RouterOS firewall commands.
 */
import { describe, expect, test } from "vite-plus/test";
import { PRESETS, SHIELD_TAG, buildShieldRules } from "../../src/tools/security-shield";
import type { Protection } from "../../src/tools/security-shield";

const base = {
  mgmtPorts: "22,8291,8728",
  sshPorts: "22",
  connLimit: 100,
  synRate: "200,50:packet",
  icmpRate: "50,10:packet",
};

describe("buildShieldRules", () => {
  test("tags every rule with the shield comment", () => {
    const groups = buildShieldRules({ ...base, enabled: PRESETS.standard });
    const cmds = groups.flatMap((g) => g.commands);
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds.every((c) => c.includes(`comment="${SHIELD_TAG}:`))).toBe(true);
  });

  test("trusted source is accepted before any drop", () => {
    const groups = buildShieldRules({
      ...base,
      enabled: ["state_hygiene"],
      trustedSources: "10.0.0.5",
    });
    expect(groups[0].protection).toBe("trusted");
    expect(groups[0].commands[0]).toContain("src-address=10.0.0.5");
    expect(groups[0].commands[0]).toContain("action=accept");
  });

  test("an address-list name (not an IP) maps to src-address-list", () => {
    const groups = buildShieldRules({
      ...base,
      enabled: [],
      trustedSources: "admins",
    });
    expect(groups[0].commands[0]).toContain("src-address-list=admins");
  });

  test("brute-force ladder builds the staged address-lists", () => {
    const groups = buildShieldRules({ ...base, enabled: ["ssh_bruteforce"] });
    const ladder = groups.find((g) => g.protection === "ssh_bruteforce");
    const joined = ladder?.commands.join("\n") ?? "";
    expect(joined).toContain(`address-list=${SHIELD_TAG}-blacklist`);
    expect(joined).toContain(`${SHIELD_TAG}-stage1`);
    expect(joined).toContain("action=add-src-to-address-list");
  });

  test("anti_spoof only emits when a WAN interface is given", () => {
    const without = buildShieldRules({ ...base, enabled: ["anti_spoof"] });
    expect(without.some((g) => g.protection === "anti_spoof")).toBe(false);
    const withWan = buildShieldRules({ ...base, enabled: ["anti_spoof"], wanInterface: "ether1" });
    const spoof = withWan.find((g) => g.protection === "anti_spoof");
    expect(spoof?.commands.some((c) => c.includes("src-address=192.168.0.0/16"))).toBe(true);
    expect(spoof?.commands.every((c) => c.includes("in-interface=ether1"))).toBe(true);
  });

  test("syn-flood emits an accept-within-rate then a drop", () => {
    const groups = buildShieldRules({ ...base, enabled: ["syn_flood"] });
    const syn = groups.find((g) => g.protection === "syn_flood");
    expect(syn?.commands[0]).toContain("limit=200,50:packet");
    expect(syn?.commands[0]).toContain("action=accept");
    expect(syn?.commands[1]).toContain("action=drop");
  });

  test("nothing selected yields no commands", () => {
    expect(buildShieldRules({ ...base, enabled: [] as Protection[] })).toEqual([]);
  });
});
