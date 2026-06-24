/**
 * Unit tests for the RouterOS command/error helpers — the parts that turn
 * device output into success/failure signals.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  commandUnsupported,
  containsRawParserError,
  indicatesFailure,
  placeBeforeError,
  splitHostPort,
} from "../../src/core/routeros";

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

describe("indicatesFailure", () => {
  test('flags the handler "Failed to …:" error convention', () => {
    expect(
      indicatesFailure("Failed to add route: bad parameter routing-mark (line 1 column 79)"),
    ).toBe(true);
    expect(
      indicatesFailure(
        "Failed to create SSTP client: failure: bad address or dns name (/interface/sstp-client/add; line 1)",
      ),
    ).toBe(true);
  });
  test("flags a parser coordinate embedded anywhere in the output", () => {
    expect(indicatesFailure("ROUTES:\n\nsomething (line 2 column 3)")).toBe(true);
  });
  test("does not flag successful output", () => {
    expect(indicatesFailure("Route added successfully:\n\n 0 dst-address=0.0.0.0/0")).toBe(false);
    expect(indicatesFailure("SSTP CLIENTS:\n\n 0 name=sstp1 running=yes")).toBe(false);
    // The word "failed" mid-sentence (not at the start of the first line) is fine.
    expect(indicatesFailure("LOGS:\n\nlogin failed for user admin")).toBe(false);
  });
});

describe("containsRawParserError", () => {
  test("still catches a bare parser error under a success header", () => {
    expect(containsRawParserError("POE:\n\nbad command name poe (line 1 column 21)")).toBe(true);
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

describe("placeBeforeError", () => {
  const err =
    "item referred by 'place-before' does not exist (11) (/ip/firewall/filter/add; line 1)";
  test("explains a non-existent *N .id and suggests the bare ordinal", () => {
    const msg = placeBeforeError(err, "*13");
    expect(msg).toBeDefined();
    expect(msg).toContain("*13");
    expect(msg).toContain(".id");
    expect(msg).toContain("'13'"); // suggests the bare ordinal
  });
  test("handles a bare-number place_before that was rejected", () => {
    const msg = placeBeforeError(err, "13");
    expect(msg).toContain("ordinal");
  });
  test("returns undefined when place_before was not supplied or the error is unrelated", () => {
    expect(placeBeforeError(err, undefined)).toBeUndefined();
    expect(placeBeforeError("failure: already have such entry", "*13")).toBeUndefined();
  });
});
