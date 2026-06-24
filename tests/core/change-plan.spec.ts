/**
 * Unit tests for the pure change-plan engine. No device I/O.
 */
import { describe, expect, test } from "vite-plus/test";
import { buildChangePlan, renderPlan, splitCommands } from "../../src/core/change-plan";

describe("splitCommands", () => {
  test("splits lines, trims, drops blanks and comments", () => {
    expect(
      splitCommands("/ip address add address=1.1.1.1/24\n\n# a comment\n  /interface print  "),
    ).toEqual(["/ip address add address=1.1.1.1/24", "/interface print"]);
  });
});

describe("buildChangePlan — classification", () => {
  test("derives path and op for add/set/remove, slash or spaced form", () => {
    const plan = buildChangePlan([
      "/ip firewall filter add chain=forward action=accept",
      "/ip/firewall/nat remove [find comment=old]",
      "/interface ethernet set ether2 mtu=1400",
    ]);
    const byCmd = new Map(plan.steps.map((s) => [s.command, s]));
    expect(byCmd.get("/ip firewall filter add chain=forward action=accept")).toMatchObject({
      path: "/ip firewall filter",
      op: "add",
    });
    expect(byCmd.get("/ip/firewall/nat remove [find comment=old]")).toMatchObject({
      path: "/ip firewall nat",
      op: "remove",
    });
    expect(byCmd.get("/interface ethernet set ether2 mtu=1400")).toMatchObject({
      path: "/interface ethernet",
      op: "set",
    });
  });

  test("counts use terraform add/modify/remove buckets", () => {
    const plan = buildChangePlan([
      "/ip address add address=10.0.0.1/24 interface=ether1",
      "/interface ethernet set ether2 mtu=1500",
      "/ip firewall nat remove [find comment=x]",
    ]);
    expect(plan.counts).toMatchObject({ add: 1, modify: 1, remove: 1, total: 3 });
  });
});

describe("buildChangePlan — lock-out detection", () => {
  test("flags an input-chain drop, an ip-service disable, and a factory reset", () => {
    const plan = buildChangePlan([
      "/ip firewall filter add chain=input action=drop",
      "/ip service set ssh disabled=yes",
      "/system reset-configuration no-defaults=yes",
    ]);
    const lockoutCmds = plan.steps.filter((s) => s.lockoutRisk).map((s) => s.op);
    expect(plan.steps.find((s) => s.command.includes("chain=input"))?.lockoutRisk).toBeTruthy();
    expect(plan.steps.find((s) => s.command.includes("ip service"))?.lockoutRisk).toBeTruthy();
    expect(
      plan.steps.find((s) => s.command.includes("reset-configuration"))?.lockoutRisk,
    ).toBeTruthy();
    expect(lockoutCmds.length).toBe(3);
    expect(plan.warnings.length).toBeGreaterThanOrEqual(3);
    expect(plan.grade).toBe("high"); // 3 high-risk steps × 20 = 60
  });

  test("a safe additive change has no lock-out warnings and low risk", () => {
    const plan = buildChangePlan(["/ip firewall address-list add list=admins address=10.0.0.5"]);
    expect(plan.warnings).toEqual([]);
    expect(plan.steps[0].lockoutRisk).toBeUndefined();
    expect(plan.grade).toBe("low");
  });
});

describe("buildChangePlan — safe ordering", () => {
  test("reorders so the new accept rule + new IP run before the old IP removal and the drop", () => {
    const plan = buildChangePlan([
      "/ip address remove [find address=192.168.88.1/24]", // destructive, given first
      "/ip firewall filter add chain=input action=drop", // destructive
      "/ip address add address=10.0.0.1/24 interface=ether1", // additive
      "/ip firewall filter add chain=input action=accept src-address=10.0.0.0/24", // additive
    ]);
    const order = plan.steps.map((s) => s.command);
    const addIp = order.indexOf("/ip address add address=10.0.0.1/24 interface=ether1");
    const addAccept = order.indexOf(
      "/ip firewall filter add chain=input action=accept src-address=10.0.0.0/24",
    );
    const removeIp = order.indexOf("/ip address remove [find address=192.168.88.1/24]");
    const addDrop = order.indexOf("/ip firewall filter add chain=input action=drop");
    expect(addIp).toBeLessThan(removeIp);
    expect(addAccept).toBeLessThan(addDrop);
    expect(plan.reordered).toBe(true);
    expect(plan.warnings[0]).toMatch(/reordered into a safe sequence/i);
  });

  test("preserves order when already safe", () => {
    const plan = buildChangePlan([
      "/ip address add address=10.0.0.1/24 interface=ether1",
      "/ip firewall filter add chain=input action=accept",
    ]);
    expect(plan.reordered).toBe(false);
  });
});

describe("renderPlan", () => {
  test("produces a terraform-style summary line", () => {
    const text = renderPlan(
      buildChangePlan(["/ip address add address=10.0.0.1/24 interface=ether1"]),
    );
    expect(text).toContain("Plan: +1 to add, ~0 to modify, -0 to remove");
  });
});
