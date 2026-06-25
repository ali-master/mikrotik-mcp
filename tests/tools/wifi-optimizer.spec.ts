/**
 * Unit test for the Wi-Fi Optimizer channel picker.
 */
import { describe, expect, test } from "vite-plus/test";
import { pickBestFrequency } from "../../src/tools/wifi-optimizer";

describe("pickBestFrequency", () => {
  test("picks the least-congested 2.4 GHz channel", () => {
    const monitor = [
      " FREQ  USE  NF",
      " 2412  45%  -110",
      " 2437  12%  -108",
      " 2462  78%  -106",
    ].join("\n");
    expect(pickBestFrequency(monitor)).toEqual({ frequency: 2437, usePct: 12 });
  });
  test("handles 5 GHz frequencies", () => {
    const monitor = "5180 30%\n5500 8%\n5745 60%";
    expect(pickBestFrequency(monitor)?.frequency).toBe(5500);
  });
  test("returns null when nothing parses", () => {
    expect(pickBestFrequency("no usable data here")).toBeNull();
  });
});
