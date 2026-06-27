/**
 * Unit test for Safe Mode activation detection — RouterOS confirms entry either
 * by redrawing the prompt with `<SAFE>` or by printing a textual confirmation,
 * and both must count as activated.
 */
import { describe, expect, test } from "vite-plus/test";
import { isSafeModeActivated, isSafeModeReleased } from "../../src/ssh/safe-mode";

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

describe("isSafeModeReleased", () => {
  test("true when the last prompt is normal (safe mode exited)", () => {
    expect(isSafeModeReleased("[admin@MikroTik] > ")).toBe(true);
    expect(isSafeModeReleased("\r\n[admin@MikroTik] > ")).toBe(true);
  });
  test("false while still on the <SAFE> prompt — must not tear down yet", () => {
    expect(isSafeModeReleased("[admin@MikroTik] <SAFE> > ")).toBe(false);
  });
  test("false on a lingering <SAFE> redraw even if a normal prompt appeared earlier", () => {
    // The buffer settles on <SAFE> last → not released; waiting must continue.
    expect(isSafeModeReleased("[admin@MikroTik] > \r\n[admin@MikroTik] <SAFE> > ")).toBe(false);
  });
  test("true once the normal prompt is the final line after the <SAFE> one", () => {
    expect(isSafeModeReleased("[admin@MikroTik] <SAFE> > \r\n[admin@MikroTik] > ")).toBe(true);
  });
  test("false on empty / no prompt", () => {
    expect(isSafeModeReleased("")).toBe(false);
  });
});
