/**
 * Unit tests for the RouterOS command/error helpers — the parts that turn
 * device output into success/failure signals.
 */
import { describe, expect, test } from "vite-plus/test";
import { commandUnsupported, splitHostPort } from "../../src/core/routeros";

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

describe("splitHostPort", () => {
  test("splits host:port for IPv4 / hostnames", () => {
    expect(splitHostPort("191.101.113.113:443")).toEqual({ host: "191.101.113.113", port: 443 });
    expect(splitHostPort("vpn.example.com:1194")).toEqual({ host: "vpn.example.com", port: 1194 });
  });
  test("returns host only when no port is present", () => {
    expect(splitHostPort("191.101.113.113")).toEqual({ host: "191.101.113.113" });
    expect(splitHostPort("vpn.example.com")).toEqual({ host: "vpn.example.com" });
  });
  test("leaves a bare IPv6 literal intact (no port to split)", () => {
    expect(splitHostPort("2001:db8::1")).toEqual({ host: "2001:db8::1" });
  });
  test("splits a bracketed IPv6 with a port", () => {
    expect(splitHostPort("[2001:db8::1]:443")).toEqual({ host: "2001:db8::1", port: 443 });
    expect(splitHostPort("[2001:db8::1]")).toEqual({ host: "2001:db8::1" });
  });
});
