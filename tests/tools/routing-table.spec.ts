/**
 * Regression tests for `/routing table` command construction.
 *
 * `fib` is a VALUE-LESS RouterOS property: the default `main` table prints as a
 * bare `fib` flag, and writing `fib=yes`/`fib=no` makes RouterOS reject the
 * command with "expected end of command (line 1 column N)". These tests lock the
 * bare-flag rendering so the bug can't silently come back.
 */
import { describe, expect, test } from "vite-plus/test";
import { buildAddRoutingTableCommand, fibToken } from "../../src/tools/routing-table";

describe("fibToken", () => {
  test("add: true → bare `fib`, false → omitted (RIB-only)", () => {
    expect(fibToken(true)).toBe("fib");
    expect(fibToken(false)).toBeUndefined();
    expect(fibToken(undefined)).toBeUndefined();
  });
  test("set: true → `fib`, false → `!fib` (unset idiom)", () => {
    expect(fibToken(true, true)).toBe("fib");
    expect(fibToken(false, true)).toBe("!fib");
    expect(fibToken(undefined, true)).toBeUndefined();
  });
  test("never emits the rejected `fib=yes` / `fib=no` form", () => {
    for (const v of [true, false, undefined]) {
      for (const onSet of [true, false]) {
        expect(fibToken(v, onSet) ?? "").not.toMatch(/fib=/);
      }
    }
  });
});

describe("buildAddRoutingTableCommand", () => {
  test("emits a bare `fib` flag, never `fib=yes` (the reported bug)", () => {
    const cmd = buildAddRoutingTableCommand({ name: "nlexit", fib: true, disabled: false });
    expect(cmd).toBe("/routing table add name=nlexit fib");
    expect(cmd).not.toMatch(/fib=/);
  });

  test("omits fib entirely when false (RIB-only table)", () => {
    const cmd = buildAddRoutingTableCommand({ name: "lookup", fib: false, disabled: false });
    expect(cmd).toBe("/routing table add name=lookup");
    expect(cmd).not.toContain("fib");
  });

  test("includes comment and disabled flag alongside the bare fib", () => {
    const cmd = buildAddRoutingTableCommand({
      name: "nl-gre",
      fib: true,
      comment: "Foreign exit via Ali NL (GRE primary, ovpn-maha backup)",
      disabled: true,
    });
    expect(cmd).toContain(" fib");
    expect(cmd).not.toMatch(/fib=/);
    expect(cmd).toContain('comment="Foreign exit via Ali NL (GRE primary, ovpn-maha backup)"');
    expect(cmd).toContain("disabled=yes");
  });
});
