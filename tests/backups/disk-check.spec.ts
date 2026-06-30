/**
 * Unit tests for the disk-space check helper used by the backup tools to decide
 * whether to redirect output to the local vault.
 */
import { describe, expect, test } from "vite-plus/test";
import { DISK_THRESHOLD_PCT } from "../../src/backups/disk-check";
import { parseSystemResource } from "../../src/core/routeros-parse";

/** A sample `/system resource print` output with high disk usage (95%). */
const HIGH_USAGE = [
  "                   uptime: 2d3h45m",
  "                  version: 7.23 (stable)",
  "               board-name: hAP lite",
  "         architecture-name: mipsbe",
  "                cpu-count: 1",
  "                 cpu-load: 12%",
  "           free-hdd-space: 800.0KiB",
  "          total-hdd-space: 16.0MiB",
  "            free-memory: 28.0MiB",
  "           total-memory: 64.0MiB",
].join("\n");

/** A sample with plenty of disk space (25% used). */
const LOW_USAGE = [
  "                   uptime: 1w2d",
  "                  version: 7.23 (stable)",
  "               board-name: RB5009UPr+S+",
  "         architecture-name: arm64",
  "                cpu-count: 4",
  "                 cpu-load: 3%",
  "           free-hdd-space: 768.0MiB",
  "          total-hdd-space: 1024.0MiB",
  "            free-memory: 800.0MiB",
  "           total-memory: 1024.0MiB",
].join("\n");

describe("DISK_THRESHOLD_PCT", () => {
  test("threshold is 90%", () => {
    expect(DISK_THRESHOLD_PCT).toBe(90);
  });
});

describe("parseSystemResource disk metrics", () => {
  test("parses high usage correctly", () => {
    const sys = parseSystemResource(HIGH_USAGE);
    expect(sys).not.toBeNull();
    expect(sys!.hddUsedPct).toBeGreaterThanOrEqual(90);
    expect(sys!.freeHdd).toBeDefined();
    expect(sys!.totalHdd).toBeDefined();
  });

  test("parses low usage correctly", () => {
    const sys = parseSystemResource(LOW_USAGE);
    expect(sys).not.toBeNull();
    expect(sys!.hddUsedPct).toBeLessThan(90);
  });

  test("returns null for garbage input", () => {
    expect(parseSystemResource("")).toBeNull();
    expect(parseSystemResource("some random error text")).toBeNull();
  });

  test("threshold comparison works", () => {
    const high = parseSystemResource(HIGH_USAGE);
    const low = parseSystemResource(LOW_USAGE);
    expect(high!.hddUsedPct! >= DISK_THRESHOLD_PCT).toBe(true);
    expect(low!.hddUsedPct! >= DISK_THRESHOLD_PCT).toBe(false);
  });
});
