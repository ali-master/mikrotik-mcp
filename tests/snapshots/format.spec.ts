/**
 * Unit tests for the pure export-parsing helpers. No device, no Bun, no SQLite.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  contentSha,
  countLines,
  normalizeExport,
  parseExportMeta,
} from "../../src/snapshots/format";

const EXPORT = `# 2024-01-15 10:30:05 by RouterOS 7.14.3
# software id = ABCD-1234
#
/interface bridge
add name=bridge1
/ip address
add address=192.168.88.1/24 interface=bridge1
`;

describe("parseExportMeta", () => {
  test("extracts RouterOS version and export timestamp", () => {
    const meta = parseExportMeta(EXPORT);
    expect(meta.rosVersion).toBe("7.14.3");
    expect(meta.exportedAt).toBe("2024-01-15 10:30:05");
  });

  test("returns undefined fields when the header is absent", () => {
    const meta = parseExportMeta("/ip address\nadd address=10.0.0.1/24");
    expect(meta.rosVersion).toBeUndefined();
    expect(meta.exportedAt).toBeUndefined();
  });
});

describe("normalizeExport", () => {
  test("strips the volatile timestamp header line so identical configs match", () => {
    const later = EXPORT.replace("2024-01-15 10:30:05", "2024-06-23 22:00:00");
    expect(normalizeExport(EXPORT)).toBe(normalizeExport(later));
  });

  test("keeps the software-id and the actual configuration lines", () => {
    const norm = normalizeExport(EXPORT);
    expect(norm).toContain("# software id = ABCD-1234");
    expect(norm).toContain("add name=bridge1");
    expect(norm).not.toContain("by RouterOS");
  });

  test("normalises CRLF line endings", () => {
    expect(normalizeExport("a\r\nb\r\n")).toBe("a\nb");
  });
});

describe("contentSha", () => {
  test("is stable and differs when content differs", () => {
    const a = contentSha(normalizeExport(EXPORT));
    const aAgain = contentSha(normalizeExport(EXPORT));
    const b = contentSha(normalizeExport(EXPORT.replace("bridge1", "bridge2")));
    expect(a).toBe(aAgain);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  test("a pure timestamp change produces an identical hash", () => {
    const later = EXPORT.replace("10:30:05", "22:00:00");
    expect(contentSha(normalizeExport(EXPORT))).toBe(contentSha(normalizeExport(later)));
  });
});

describe("countLines", () => {
  test("ignores trailing blank lines", () => {
    expect(countLines("a\nb\nc\n")).toBe(3);
    expect(countLines("")).toBe(0);
    expect(countLines("\n\n")).toBe(0);
  });
});
