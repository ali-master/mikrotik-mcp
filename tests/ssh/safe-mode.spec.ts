/**
 * Unit test for Safe Mode activation detection — RouterOS confirms entry either
 * by redrawing the prompt with `<SAFE>` or by printing a textual confirmation,
 * and both must count as activated.
 */
import { describe, expect, test } from "vite-plus/test";
import { classifyPrompt, isSafeModeActivated, isSafeModeReleased } from "../../src/ssh/safe-mode";

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

describe("classifyPrompt — commit-side mode detection", () => {
  test("'released' on a settled normal prompt", () => {
    expect(classifyPrompt("[admin@MikroTik] > ")).toBe("released");
    expect(classifyPrompt("\r\n[Safe mode released]\r\n[admin@MikroTik] > ")).toBe("released");
  });
  test("'safe' while the prompt still shows <SAFE> (commit not taken → retry, don't loop)", () => {
    expect(classifyPrompt("[admin@MikroTik] <SAFE> > ")).toBe("safe");
    // A transient normal line followed by a settled <SAFE> prompt is still 'safe'.
    expect(classifyPrompt("[admin@MikroTik] > \r\n[admin@MikroTik] <SAFE> > ")).toBe("safe");
  });
  test("'unknown' when no prompt was captured (timed out / wedged — never claim success)", () => {
    expect(classifyPrompt("")).toBe("unknown");
    expect(classifyPrompt("...some banner with no prompt...")).toBe("unknown");
  });
  test("settles on the LAST prompt after a Ctrl+X then Enter nudge", () => {
    // Ctrl+X redraws <SAFE>, Enter then renders the real post-commit prompt.
    expect(classifyPrompt("[admin@MikroTik] <SAFE> > \r\n[admin@MikroTik] > ")).toBe("released");
  });
});
