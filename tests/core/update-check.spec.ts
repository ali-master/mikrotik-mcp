/**
 * Regression: a cached release payload (memory or the 6-hour file cache) bakes in
 * `currentVersion`/`isNewer`/`isAhead` against whatever version wrote it. After the
 * server is upgraded, those stale fields must be re-derived against the RUNNING
 * version — otherwise the "What's New" modal shows e.g. "v4.13.0 new, you're on
 * v4.12.0" while the sidebar correctly reads v4.14.0.
 */
import { describe, expect, test } from "vite-plus/test";
import { compareVersions, withCurrentRelation } from "../../src/core/update-check";
import type { ReleasePayload } from "../../src/core/update-check";
import { VERSION } from "../../src/version";

function payload(version: string, staleCurrent: string): ReleasePayload {
  return {
    version,
    name: `v${version}`,
    body: "",
    publishedAt: "2026-07-12T00:00:00Z",
    url: "https://example.test",
    // Deliberately wrong / stale relative fields, as a cache from an older build
    // would carry.
    isNewer: true,
    isAhead: false,
    currentVersion: staleCurrent,
  };
}

describe("withCurrentRelation", () => {
  test("overwrites a stale currentVersion with the running VERSION", () => {
    const r = withCurrentRelation(payload("0.0.1", "0.0.0"));
    expect(r.currentVersion).toBe(VERSION);
  });

  test("marks a release OLDER than the running version as not-newer (the reported bug)", () => {
    // A cache that said "isNewer: true" for an older release must be corrected.
    const older = "0.0.1"; // guaranteed below any real VERSION
    const r = withCurrentRelation(payload(older, "0.0.0"));
    expect(compareVersions(older, VERSION)).toBeLessThan(0);
    expect(r.isNewer).toBe(false);
    expect(r.isAhead).toBe(true);
  });

  test("marks a release NEWER than the running version as newer", () => {
    const newer = "9999.0.0";
    const r = withCurrentRelation(payload(newer, VERSION));
    expect(r.isNewer).toBe(true);
    expect(r.isAhead).toBe(false);
  });

  test("preserves the raw release facts (version/name/body/url) unchanged", () => {
    const r = withCurrentRelation(payload("9999.0.0", "0.0.0"));
    expect(r.version).toBe("9999.0.0");
    expect(r.url).toBe("https://example.test");
  });
});
