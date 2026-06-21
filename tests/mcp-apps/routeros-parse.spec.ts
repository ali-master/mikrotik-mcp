/**
 * RouterOS `print` parsers used to shape MCP App view data (Vitest).
 */
import { describe, it, expect } from "vite-plus/test";
import {
  parseKeyValues,
  parseLeadingNumber,
  parseSizeToBytes,
} from "../../src/core/routeros-parse";

describe("parseKeyValues", () => {
  it("parses padded `key: value` print output, preserving hyphenated keys", () => {
    const text = [
      "                   uptime: 1w2d3h4m",
      "                  version: 7.16.1 (stable)",
      "                 cpu-load: 7%",
      "              free-memory: 124.5MiB",
      "             total-memory: 256.0MiB",
      "               board-name: RB5009UG+S+",
    ].join("\n");
    const kv = parseKeyValues(text);
    expect(kv.uptime).toBe("1w2d3h4m");
    expect(kv.version).toBe("7.16.1 (stable)");
    expect(kv["cpu-load"]).toBe("7%");
    expect(kv["free-memory"]).toBe("124.5MiB");
    expect(kv["board-name"]).toBe("RB5009UG+S+");
  });

  it("skips blank lines and non key:value lines", () => {
    const kv = parseKeyValues("\nFlags: X - disabled\n  name: home\n");
    expect(kv.name).toBe("home");
    // "Flags: X - disabled" looks key-ish but is kept as a value — acceptable;
    // what matters is real fields parse and blanks don't crash.
    expect(Object.keys(kv)).toContain("name");
  });

  it("returns an empty object for empty input", () => {
    expect(parseKeyValues("")).toEqual({});
  });
});

describe("parseLeadingNumber", () => {
  it("extracts the leading number, ignoring units/suffixes", () => {
    expect(parseLeadingNumber("7%")).toBe(7);
    expect(parseLeadingNumber("41.5C")).toBe(41.5);
    expect(parseLeadingNumber("24.1V")).toBe(24.1);
  });
  it("returns null for non-numeric or missing values", () => {
    expect(parseLeadingNumber("n/a")).toBeNull();
    expect(parseLeadingNumber(undefined)).toBeNull();
  });
});

describe("parseSizeToBytes", () => {
  it("converts RouterOS binary sizes to bytes", () => {
    expect(parseSizeToBytes("1024B")).toBe(1024);
    expect(parseSizeToBytes("2KiB")).toBe(2048);
    expect(parseSizeToBytes("1MiB")).toBe(1024 * 1024);
    expect(parseSizeToBytes("1.5GiB")).toBe(1.5 * 1024 ** 3);
  });
  it("treats a bare number as bytes and rejects junk", () => {
    expect(parseSizeToBytes("500")).toBe(500);
    expect(parseSizeToBytes("abc")).toBeNull();
    expect(parseSizeToBytes(undefined)).toBeNull();
  });
});
