/**
 * Unit test for the DR Drill ping-summary parser.
 */
import { describe, expect, test } from "vite-plus/test";
import { parsePingSummary } from "../../src/tools/dr-drill";

describe("parsePingSummary", () => {
  test("parses the RouterOS ping summary line", () => {
    const out = "    sent=5 received=5 packet-loss=0% min-rtt=10ms avg-rtt=12ms";
    expect(parsePingSummary(out)).toEqual({ sent: 5, received: 5, lossPct: 0 });
  });
  test("captures a partial/total loss", () => {
    expect(parsePingSummary("sent=5 received=2 packet-loss=60%")).toEqual({
      sent: 5,
      received: 2,
      lossPct: 60,
    });
    expect(parsePingSummary("sent=5 received=0 packet-loss=100%")?.received).toBe(0);
  });
  test("returns null when there is no summary", () => {
    expect(parsePingSummary("bad command name")).toBeNull();
  });
});
