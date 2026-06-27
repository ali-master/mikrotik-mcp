/**
 * Pure-unit tests for backup filename slugging and `/export` command building.
 *
 * Guards the CRITICAL fix: a device name with a space/underscore must never land
 * raw in a backup filename (the vault's `safeName()` only permits
 * `[A-Za-z0-9._-]`, so a raw space would throw) — it is slugified to dashes.
 */
import { describe, expect, test } from "vite-plus/test";
import { buildExportCommand } from "../../src/backups/create";
import { deviceSlug } from "../../src/core/slug";
import { safeName } from "../../src/backups/vault";

describe("deviceSlug", () => {
  test("collapses spaces, underscores and punctuation to dashes", () => {
    expect(deviceSlug("Ali Home")).toBe("Ali-Home");
    expect(deviceSlug("core_rtr")).toBe("core-rtr");
    expect(deviceSlug("DC1/edge.lab")).toBe("DC1-edge-lab");
    expect(deviceSlug("  spaced  name  ")).toBe("spaced-name");
  });
  test("trims and never returns empty", () => {
    expect(deviceSlug("___")).toBe("device");
    expect(deviceSlug("")).toBe("device");
    expect(deviceSlug(undefined)).toBe("device");
  });
  test("the slug always passes the vault's safeName guard", () => {
    for (const raw of ["Ali Home", "core_rtr.lab", "DC1/edge", "ünïcödé!!!", ""]) {
      const fname = `${deviceSlug(raw)}_2026-06-27_1430.rsc`;
      expect(() => safeName(fname)).not.toThrow();
    }
  });
});

describe("buildExportCommand", () => {
  test("plain export with no options", () => {
    expect(buildExportCommand()).toBe("/export");
    expect(buildExportCommand({})).toBe("/export");
  });
  test("show-sensitive maps the secret-reveal flag", () => {
    expect(buildExportCommand({ showSensitive: true })).toBe("/export show-sensitive");
  });
  test("verbose and terse flags", () => {
    expect(buildExportCommand({ verbose: true })).toBe("/export verbose");
    expect(buildExportCommand({ terse: true })).toBe("/export terse");
  });
  test("verbose wins over compact (RouterOS rejects both together)", () => {
    expect(buildExportCommand({ verbose: true, compact: true })).toBe("/export verbose");
    expect(buildExportCommand({ compact: true })).toBe("/export compact");
  });
  test("flags combine in a stable order", () => {
    expect(buildExportCommand({ verbose: true, terse: true, showSensitive: true })).toBe(
      "/export verbose terse show-sensitive",
    );
  });
});
