/**
 * Unit test for Safe Mode activation detection — RouterOS confirms entry either
 * by redrawing the prompt with `<SAFE>` or by printing a textual confirmation,
 * and both must count as activated.
 */
import { describe, expect, test } from "vite-plus/test";
import { isSafeModeActivated } from "../../src/ssh/safe-mode";

describe("isSafeModeActivated", () => {
  test("accepts the <SAFE> prompt marker", () => {
    expect(isSafeModeActivated("[admin@MikroTik] <SAFE> > ")).toBe(true);
  });
  test("accepts a textual confirmation (dumb terminal / some v7 builds)", () => {
    expect(isSafeModeActivated("\r\nTaking Safe Mode session... Success!\r\n")).toBe(true);
    expect(isSafeModeActivated("[Safe Mode taken]")).toBe(true);
  });
  test("rejects output with no activation signal", () => {
    expect(isSafeModeActivated("[admin@MikroTik] > ")).toBe(false);
    expect(isSafeModeActivated("")).toBe(false);
  });
});
