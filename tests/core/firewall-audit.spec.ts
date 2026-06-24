/**
 * Unit tests for the pure firewall audit engine. No device I/O.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  auditFirewall,
  cidrContains,
  renderReport,
  rulesFromRows,
} from "../../src/core/firewall-audit";

/** Build a parsed `print detail` row quickly. */
function row(index: number, fields: Record<string, string>): Record<string, string> {
  return { "#": String(index), ...fields };
}

describe("cidrContains", () => {
  test("a broader prefix contains a narrower one", () => {
    expect(cidrContains("10.0.0.0/8", "10.1.2.0/24")).toBe(true);
    expect(cidrContains("0.0.0.0/0", "8.8.8.8")).toBe(true);
    expect(cidrContains("192.168.1.0/24", "192.168.2.0/24")).toBe(false);
    expect(cidrContains("10.1.2.0/24", "10.0.0.0/8")).toBe(false); // narrower can't contain broader
  });

  test("non-CIDR values are not treated as containing", () => {
    expect(cidrContains("list-name", "10.0.0.1")).toBe(false);
    expect(cidrContains("10.0.0.1-10.0.0.9", "10.0.0.5")).toBe(false); // ranges are conservative
  });

  test("handles IPv6 containment (via ipaddr.js)", () => {
    expect(cidrContains("2001:db8::/32", "2001:db8:abcd::/48")).toBe(true);
    expect(cidrContains("2001:db8:1::/48", "2001:db8:2::/48")).toBe(false);
    // Mixed families never contain each other.
    expect(cidrContains("0.0.0.0/0", "2001:db8::1")).toBe(false);
  });
});

describe("rulesFromRows", () => {
  test("separates match conditions from admin/transform fields and flags", () => {
    const [r] = rulesFromRows([
      row(0, {
        flags: "X",
        chain: "srcnat",
        action: "masquerade",
        "out-interface": "ether1",
        "to-addresses": "1.2.3.4",
        packets: "0",
        bytes: "0",
        comment: "nat",
      }),
    ]);
    expect(r.disabled).toBe(true);
    expect(r.match).toEqual({ "out-interface": "ether1" });
    expect(r.transform).toEqual({ "to-addresses": "1.2.3.4" });
    expect(r.packets).toBe(0);
  });
});

describe("auditFirewall — filter", () => {
  test("flags a totally missing firewall", () => {
    const report = auditFirewall({ filter: [] });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].kind).toBe("no-firewall");
    expect(report.grade).not.toBe("clean");
  });

  test("detects an unreachable rule shadowed by a broader earlier accept (CIDR)", () => {
    const filter = rulesFromRows([
      row(0, { chain: "input", action: "accept", "src-address": "10.0.0.0/8", packets: "5" }),
      row(1, { chain: "input", action: "accept", "src-address": "10.1.1.0/24", packets: "3" }),
      row(2, { chain: "input", action: "drop", packets: "9" }),
    ]);
    const report = auditFirewall({ filter });
    const shadow = report.findings.find((f) => f.kind === "shadowed");
    expect(shadow?.ruleIndex).toBe(1);
    expect(shadow?.relatedIndex).toBe(0);
    expect(shadow?.action).toEqual({
      tool: "disable_filter_rule",
      args: { rule_id: "1" },
      label: "Disable rule 1",
    });
  });

  test("a rate-limited earlier rule does NOT shadow (non-deterministic match)", () => {
    const filter = rulesFromRows([
      row(0, {
        chain: "input",
        action: "drop",
        protocol: "tcp",
        limit: "10,5:packet",
        packets: "1",
      }),
      row(1, { chain: "input", action: "drop", protocol: "tcp", packets: "1" }),
      row(2, { chain: "input", action: "drop", packets: "1" }),
    ]);
    const report = auditFirewall({ filter });
    expect(report.findings.some((f) => f.kind === "shadowed")).toBe(false);
  });

  test("flags an overly broad accept and a missing default-drop", () => {
    const filter = rulesFromRows([row(0, { chain: "input", action: "accept", packets: "100" })]);
    const report = auditFirewall({ filter });
    expect(report.findings.some((f) => f.kind === "broad-accept" && f.severity === "high")).toBe(
      true,
    );
    expect(report.findings.some((f) => f.kind === "missing-default-drop")).toBe(true);
  });

  test("a clean ruleset with a default-drop scores well", () => {
    const filter = rulesFromRows([
      row(0, {
        chain: "input",
        action: "accept",
        "connection-state": "established,related",
        packets: "9",
      }),
      row(1, { chain: "input", action: "drop", "connection-state": "invalid", packets: "2" }),
      row(2, { chain: "input", action: "accept", protocol: "icmp", packets: "4" }),
      row(3, { chain: "input", action: "drop", packets: "7" }),
    ]);
    const report = auditFirewall({ filter });
    expect(report.findings.some((f) => f.kind === "missing-default-drop")).toBe(false);
    expect(report.findings.some((f) => f.kind === "broad-accept")).toBe(false);
    expect(report.findings.some((f) => f.kind === "shadowed")).toBe(false);
  });

  test("reports dead rules (zero packets) at low severity", () => {
    const filter = rulesFromRows([
      row(0, { chain: "input", action: "accept", protocol: "tcp", "dst-port": "22", packets: "0" }),
      row(1, { chain: "input", action: "drop", packets: "5" }),
    ]);
    const report = auditFirewall({ filter });
    const dead = report.findings.find((f) => f.kind === "dead-rule");
    expect(dead?.ruleIndex).toBe(0);
    expect(dead?.severity).toBe("low");
  });
});

describe("auditFirewall — NAT duplicates", () => {
  test("flags a second identical NAT rule as a duplicate", () => {
    const nat = rulesFromRows([
      row(0, { chain: "srcnat", action: "masquerade", "out-interface": "ether1", packets: "9" }),
      row(1, { chain: "srcnat", action: "masquerade", "out-interface": "ether1", packets: "0" }),
    ]);
    const report = auditFirewall({ nat });
    const dup = report.findings.find((f) => f.kind === "duplicate");
    expect(dup?.ruleIndex).toBe(1);
    expect(dup?.relatedIndex).toBe(0);
    expect(dup?.action?.tool).toBe("disable_nat_rule");
  });
});

describe("renderReport", () => {
  test("produces a clean summary when nothing is wrong", () => {
    const filter = rulesFromRows([
      row(0, {
        chain: "input",
        action: "accept",
        "connection-state": "established,related",
        packets: "1",
      }),
      row(1, { chain: "input", action: "drop", packets: "1" }),
    ]);
    const report = auditFirewall({ filter });
    const text = renderReport(report, "gw");
    expect(text).toContain("FIREWALL AUDIT — gw");
    expect(text).toContain("Risk score:");
  });
});
