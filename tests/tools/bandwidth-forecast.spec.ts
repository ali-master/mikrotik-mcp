/**
 * Unit tests for the bandwidth saturation projection.
 */
import { describe, expect, test } from "vite-plus/test";
import { projectSaturation } from "../../src/tools/bandwidth-forecast";

describe("projectSaturation", () => {
  test("computes utilization and a forward projection", () => {
    const s = projectSaturation(500, 1000, 10); // 50% used, +10%/mo
    expect(s.utilizationPct).toBe(50);
    // ln(2)/ln(1.1) ≈ 7.27 months ≈ 221 days
    expect(s.daysToSaturate).toBe(221);
  });
  test("already saturated → 0 days", () => {
    expect(projectSaturation(1000, 1000, 10).daysToSaturate).toBe(0);
    expect(projectSaturation(1200, 1000, 10).daysToSaturate).toBe(0);
  });
  test("no/negative growth → never (null)", () => {
    expect(projectSaturation(500, 1000, 0).daysToSaturate).toBeNull();
    expect(projectSaturation(500, 1000, -5).daysToSaturate).toBeNull();
  });
});
