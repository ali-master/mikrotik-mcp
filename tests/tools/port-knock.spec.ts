/**
 * Unit tests for the Port-Knock Guardian rule-builder.
 */
import { describe, expect, test } from "vite-plus/test";
import { KNOCK_TAG, buildKnockRules } from "../../src/tools/port-knock";

const base = { protectPorts: "22,8291", openTimeout: "1h", stageTimeout: "10s" };

describe("buildKnockRules", () => {
  test("builds a staged ladder ending in the allow-list, plus accept + drop", () => {
    const rules = buildKnockRules({ ...base, sequence: [7001, 8002, 9003] });
    // 3 knock rules + accept + drop
    expect(rules).toHaveLength(5);
    // first knock has no prior stage requirement
    expect(rules[0]).toContain("dst-port=7001");
    expect(rules[0]).not.toContain("src-address-list");
    // second knock requires stage 1
    expect(rules[1]).toContain(`src-address-list=${KNOCK_TAG}-1`);
    // last knock promotes to the allow-list with the open timeout
    expect(rules[2]).toContain(`address-list=${KNOCK_TAG}-allowed`);
    expect(rules[2]).toContain("address-list-timeout=1h");
    // accept management only when knocked, then hide it
    expect(rules[3]).toContain(`src-address-list=${KNOCK_TAG}-allowed`);
    expect(rules[3]).toContain("action=accept");
    expect(rules[4]).toContain("action=drop");
    expect(rules[4]).toContain("dst-port=22,8291");
  });

  test("every rule is tagged", () => {
    const rules = buildKnockRules({ ...base, sequence: [1, 2] });
    expect(rules.every((r) => r.includes(`comment="${KNOCK_TAG}:`))).toBe(true);
  });
});
