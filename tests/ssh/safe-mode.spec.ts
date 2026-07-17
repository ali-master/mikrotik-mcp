/**
 * Unit test for Safe Mode activation detection — RouterOS confirms entry either
 * by redrawing the prompt with `<SAFE>` or by printing a textual confirmation,
 * and both must count as activated.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  SafeModeManager,
  classifyPrompt,
  isSafeModeActivated,
  isSafeModeReleased,
} from "../../src/ssh/safe-mode";

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

describe("unexpected session drop — no false success", () => {
  /**
   * Simulate the reported bug: the persistent shell drops WHILE Safe Mode is
   * active (changes staged, not committed), so RouterOS has auto-reverted them.
   * The manager must never then report a commit as succeeding.
   */
  function droppedManager(): SafeModeManager {
    const mgr = new SafeModeManager("test-device");
    // Mid-session state, then fire the shell's close listener.
    (mgr as unknown as { active: boolean }).active = true;
    (mgr as unknown as { handleUnexpectedDrop: () => void }).handleUnexpectedDrop();
    return mgr;
  }

  test("a drop clears active and records the revert", () => {
    const mgr = droppedManager();
    expect(mgr.isActive).toBe(false);
    expect(mgr.status()).toMatch(/DROPPED/i);
    expect(mgr.status()).toMatch(/NOT saved/i);
  });

  test("commit after a drop reports failure, not 'nothing to commit'", async () => {
    const result = await droppedManager().commit();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/reverted/i);
    expect(result.message).not.toMatch(/nothing to commit/i);
  });

  test("rollback after a drop explains the changes were already reverted", async () => {
    const msg = await droppedManager().rollback();
    expect(msg).toMatch(/auto-reverted/i);
  });

  test("a close while inactive (clean teardown) is a no-op", () => {
    const mgr = new SafeModeManager("test-device");
    (mgr as unknown as { handleUnexpectedDrop: () => void }).handleUnexpectedDrop();
    expect(mgr.status()).toMatch(/NOT active/i);
  });
});
