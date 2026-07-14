/**
 * Offline tests for the pure CAPsMAN-trend helper. `summariseRadioSamples` is
 * pure and the module only loads `bun:sqlite` lazily inside `openCapsmanStore`,
 * so importing it here is safe (no database).
 */
import { describe, expect, test } from "vite-plus/test";
import { summariseRadioSamples } from "../../src/observability/capsman-store";
import type { RadioSampleRow } from "../../src/observability/capsman-store";

const D1 = Date.UTC(2026, 0, 1);
const row = (over: Partial<RadioSampleRow> = {}): RadioSampleRow => ({
  radioId: "r1",
  cap: "ap-1",
  band: "5ghz",
  ts: D1,
  clients: 0,
  channel: 5180,
  ...over,
});

describe("summariseRadioSamples", () => {
  test("groups per radio and sorts points by time regardless of input order", () => {
    const out = summariseRadioSamples([
      row({ radioId: "r1", ts: D1 + 2000, clients: 3 }),
      row({ radioId: "r2", band: "2ghz", ts: D1, clients: 9 }),
      row({ radioId: "r1", ts: D1, clients: 1 }),
    ]);
    expect(out.map((s) => s.radioId)).toEqual(["r1", "r2"]);
    expect(out[0].points.map((p) => p.ts)).toEqual([D1, D1 + 2000]);
    expect(out[0].points.map((p) => p.clients)).toEqual([1, 3]);
  });

  test("computes peak and rounded average client load", () => {
    const out = summariseRadioSamples([
      row({ clients: 2 }),
      row({ ts: D1 + 1000, clients: 5 }),
      row({ ts: D1 + 2000, clients: 2 }), // avg (2+5+2)/3 = 3, peak 5
    ]);
    expect(out[0].peak).toBe(5);
    expect(out[0].avg).toBe(3);
  });

  test("carries the latest cap/band identity and preserves null channel", () => {
    const out = summariseRadioSamples([
      row({ ts: D1, cap: "old", channel: null }),
      row({ ts: D1 + 1000, cap: "new", band: "2ghz", channel: 2412 }),
    ]);
    expect(out[0].cap).toBe("new");
    expect(out[0].band).toBe("2ghz");
    expect(out[0].points[0].channel).toBeNull();
  });

  test("returns an empty array for no rows", () => {
    expect(summariseRadioSamples([])).toEqual([]);
  });
});
