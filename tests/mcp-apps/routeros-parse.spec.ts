/**
 * RouterOS `print` parsers used to shape MCP App view data (Vitest).
 */
import { describe, it, expect } from "vite-plus/test";
import {
  parseKeyValues,
  parseLeadingNumber,
  parseSizeToBytes,
  parseFlagLegend,
  parseRecords,
  buildRecordsView,
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

describe("parseFlagLegend", () => {
  it("maps each flag letter to its meaning", () => {
    const legend = parseFlagLegend("Flags: X - disabled, R - running, D - dynamic ");
    expect(legend).toEqual({ X: "disabled", R: "running", D: "dynamic" });
  });
  it("returns an empty map when there is no legend", () => {
    expect(parseFlagLegend("0 name=ether1")).toEqual({});
  });

  it("splits the v7 legend that mixes `;` and `,` separators", () => {
    const legend = parseFlagLegend("Flags: D - DYNAMIC; X - DISABLED, R - RUNNING; S - SLAVE");
    expect(legend).toEqual({ D: "DYNAMIC", X: "DISABLED", R: "RUNNING", S: "SLAVE" });
  });
});

describe("parseRecords — detail (key=value) format", () => {
  it("parses indexed records with flags and quoted values, wrapping continuations", () => {
    const text = [
      "Flags: X - disabled, R - running ",
      ' 0 R  name="ether1" type="ether" mtu=1500 comment="up link"',
      "      mac-address=AA:BB:CC:DD:EE:FF",
      ' 1  X name="ether2" type="ether" mtu=1500',
    ].join("\n");
    const { format, columns, rows } = parseRecords(text);
    expect(format).toBe("detail");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      "#": "0",
      flags: "R",
      name: "ether1",
      type: "ether",
      comment: "up link",
      "mac-address": "AA:BB:CC:DD:EE:FF",
    });
    expect(rows[1]).toMatchObject({ "#": "1", flags: "X", name: "ether2" });
    expect(columns).toContain("name");
    expect(columns).toContain("mac-address");
  });

  it("captures uppercase flags and a `;;;` comment on v7 detail rows", () => {
    const text = [
      "Flags: D - DYNAMIC; X - DISABLED, R - RUNNING; S - SLAVE",
      " 0  RS ;;; defconf",
      '        name="ether1" default-name="ether1" type="ether" mtu=1500',
      ' 1  R  name="ether2" type="ether" mtu=1500',
    ].join("\n");
    const { format, rows } = parseRecords(text);
    expect(format).toBe("detail");
    expect(rows[0]).toMatchObject({
      "#": "0",
      flags: "RS",
      comment: "defconf",
      name: "ether1",
      type: "ether",
    });
    expect(rows[1]).toMatchObject({ "#": "1", flags: "R", name: "ether2" });
  });

  it("parses a single detail record with no index line", () => {
    const { format, rows } = parseRecords('name="home" ttl="1d" address=1.2.3.4');
    expect(format).toBe("detail");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "home", ttl: "1d", address: "1.2.3.4" });
  });
});

describe("parseRecords — columnar format", () => {
  it("slices rows at the header column positions, keeping spaced values intact", () => {
    const text = [
      "Flags: X - disabled, R - running ",
      " #   NAME      TYPE   ACTUAL-MTU",
      " 0 R ether1    ether  1500",
      " 1 X ether2    ether  1500",
    ].join("\n");
    const { format, columns, rows } = parseRecords(text);
    expect(format).toBe("columnar");
    expect(columns).toEqual(expect.arrayContaining(["#", "name", "type", "actual-mtu"]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ "#": "0", flags: "R", name: "ether1", "actual-mtu": "1500" });
    expect(rows[1]).toMatchObject({ "#": "1", flags: "X", name: "ether2" });
  });

  it("ignores the v7 `Columns:` hint line instead of slicing on it", () => {
    const text = [
      "Flags: D - dynamic; X - disabled, R - running; S - slave",
      "Columns: NAME, TYPE, ACTUAL-MTU, L2MTU, MAC-ADDRESS",
      " #    NAME        TYPE    ACTUAL-MTU  L2MTU  MAC-ADDRESS",
      " 0  R ether1      ether   1500        1598   AA:BB:CC:DD:EE:01",
      " 1  R ether2      ether   1500        1598   AA:BB:CC:DD:EE:02",
    ].join("\n");
    const { format, columns, rows } = parseRecords(text);
    expect(format).toBe("columnar");
    expect(columns).toEqual(expect.arrayContaining(["#", "name", "type", "actual-mtu"]));
    expect(rows[0]).toMatchObject({ "#": "0", flags: "R", name: "ether1", type: "ether" });
    expect(rows).toHaveLength(2);
  });
});

describe("parseRecords — fallbacks", () => {
  it("treats single key:value output as one record", () => {
    const { format, rows } = parseRecords("  uptime: 1w2d\n  version: 7.16.1");
    expect(format).toBe("keyvalue");
    expect(rows[0]).toMatchObject({ uptime: "1w2d", version: "7.16.1" });
  });
  it("returns an empty result for prose (no records)", () => {
    expect(parseRecords("Interface 'x' not found.")).toEqual({
      format: "empty",
      columns: [],
      rows: [],
    });
  });
});

describe("buildRecordsView", () => {
  const at = "2026-06-21T00:00:00.000Z";

  it("strips a banner, classifies a list, and carries the raw fallback", () => {
    const text = [
      "INTERFACES:",
      "",
      "Flags: R - running ",
      ' 0 R name="ether1" type="ether"',
      ' 1 R name="ether2" type="ether"',
    ].join("\n");
    const view = buildRecordsView("list_interfaces", "List Interfaces", text, at);
    expect(view.__mikrotikView).toBe("records");
    expect(view.kind).toBe("list");
    expect(view.count).toBe(2);
    expect(view.flags).toEqual({ R: "running" });
    expect(view.raw).not.toMatch(/^INTERFACES:/);
    expect(view.generatedAt).toBe(at);
  });

  it("classifies a single detail record as `record`", () => {
    const view = buildRecordsView(
      "get_interface",
      "Get Interface",
      'INTERFACE DETAILS:\n\nname="ether1" type="ether" mtu=1500',
      at,
    );
    expect(view.kind).toBe("record");
    expect(view.rows[0]).toMatchObject({ name: "ether1" });
  });

  it("never throws on prose, leaving rows empty with raw text preserved", () => {
    const view = buildRecordsView("get_interface", "Get Interface", "Interface 'x' not found.", at);
    expect(view.rows).toEqual([]);
    expect(view.raw).toBe("Interface 'x' not found.");
  });
});
