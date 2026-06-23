/**
 * Unit tests for the pure line-diff engine. No device, no Bun, no SQLite.
 */
import { describe, expect, test } from "vite-plus/test";
import { diffLines } from "../../src/core/diff";

describe("diffLines", () => {
  test("identical inputs report no change and empty unified output", () => {
    const text = "a\nb\nc";
    const d = diffLines(text, text);
    expect(d.summary).toEqual({ added: 0, removed: 0, unchanged: 3, changed: false });
    expect(d.unified).toBe("");
  });

  test("counts pure additions and removals", () => {
    const d = diffLines("a\nb\nc", "a\nc");
    expect(d.summary.removed).toBe(1);
    expect(d.summary.added).toBe(0);
    expect(d.summary.unchanged).toBe(2);
    expect(d.summary.changed).toBe(true);
  });

  test("a replaced line is one removal plus one addition", () => {
    const d = diffLines("name=old\nport=22", "name=new\nport=22");
    expect(d.summary.added).toBe(1);
    expect(d.summary.removed).toBe(1);
    expect(d.summary.unchanged).toBe(1);
    // The ordered op stream keeps the deletion before the insertion.
    const types = d.ops.map((o) => o.type);
    expect(types).toEqual(["del", "add", "eq"]);
  });

  test("unified output carries a hunk header and +/- prefixes", () => {
    const d = diffLines("a\nb\nc\nd\ne", "a\nb\nX\nd\ne", { contextLines: 1 });
    const lines = d.unified.split("\n");
    expect(lines[0]).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/);
    expect(d.unified).toContain("-c");
    expect(d.unified).toContain("+X");
    // Context line "b" before and "d" after the change are present and unprefixed.
    expect(d.unified).toContain(" b");
    expect(d.unified).toContain(" d");
  });

  test("context grouping merges nearby changes into one hunk and isolates distant ones", () => {
    const from = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
    // Change line2 and line17 — far apart, so two separate hunks at context 2.
    const toArr = Array.from({ length: 20 }, (_, i) => `line${i}`);
    toArr[2] = "CHANGED2";
    toArr[17] = "CHANGED17";
    const d = diffLines(from, toArr.join("\n"), { contextLines: 2 });
    const hunks = d.unified.split("\n").filter((l) => l.startsWith("@@"));
    expect(hunks).toHaveLength(2);
  });

  test("from/to labels render as ---/+++ headers", () => {
    const d = diffLines("a", "b", { fromLabel: "snap_1", toLabel: "live" });
    expect(d.unified.startsWith("--- snap_1\n+++ live\n")).toBe(true);
  });

  test("empty-to-nonempty is all additions", () => {
    const d = diffLines("", "x\ny");
    expect(d.summary).toEqual({ added: 2, removed: 0, unchanged: 0, changed: true });
  });

  test("trailing newline differences do not register as changes", () => {
    const d = diffLines("a\nb\n", "a\nb");
    expect(d.summary.changed).toBe(false);
  });
});
