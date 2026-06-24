/**
 * Unit tests for the RouterOS command/error helpers — the parts that turn
 * device output into success/failure signals.
 */
import { describe, expect, test } from "vite-plus/test";
import { commandUnsupported } from "../../src/core/routeros";

describe("commandUnsupported", () => {
  test("matches a missing/unknown command path", () => {
    expect(commandUnsupported("bad command name (line 1 column 5)")).toBe(true);
    expect(commandUnsupported("no such command prefix")).toBe(true);
    expect(commandUnsupported("invalid command name")).toBe(true);
  });
  test("does NOT treat an argument syntax error as unsupported", () => {
    // "expected end of command" means the path was recognized but trailing
    // tokens were rejected — a real syntax error, not a missing feature.
    expect(commandUnsupported("expected end of command (line 1 column 14)")).toBe(false);
  });
});
