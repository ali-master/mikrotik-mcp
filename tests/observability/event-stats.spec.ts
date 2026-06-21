/**
 * Observability event model + pure analytics (Vitest). No database / I/O.
 */
import { describe, it, expect } from "vite-plus/test";
import { buildEvent, redact, riskOf, truncate } from "../../src/observability/event";
import type { RawCall, ToolEvent } from "../../src/observability/event";
import { computeStats, percentile } from "../../src/observability/stats";

describe("riskOf", () => {
  it("maps annotations to a coarse risk class", () => {
    expect(riskOf({ readOnlyHint: true })).toBe("READ");
    expect(riskOf({ destructiveHint: true, idempotentHint: true })).toBe("DESTRUCTIVE");
    expect(riskOf({ destructiveHint: true })).toBe("DANGEROUS");
    expect(riskOf({ idempotentHint: true })).toBe("WRITE_IDEMPOTENT");
    expect(riskOf({})).toBe("WRITE");
    expect(riskOf(undefined)).toBe("WRITE");
  });
});

describe("redact", () => {
  it("masks values under sensitive keys, recursively, keeping the rest", () => {
    const out = redact({
      name: "wg0",
      password: "hunter2",
      "private-key": "AAAA",
      nested: { psk: "shh", port: 51820, token: "t" },
      list: [{ secret: "x", ok: "y" }],
    }) as Record<string, unknown>;
    expect(out.name).toBe("wg0");
    expect(out.password).toBe("«redacted»");
    expect(out["private-key"]).toBe("«redacted»");
    expect((out.nested as Record<string, unknown>).psk).toBe("«redacted»");
    expect((out.nested as Record<string, unknown>).port).toBe(51820);
    expect((out.list as Record<string, unknown>[])[0].secret).toBe("«redacted»");
    expect((out.list as Record<string, unknown>[])[0].ok).toBe("y");
  });
  it("leaves empty/absent sensitive values alone", () => {
    const out = redact({ password: "" }) as Record<string, unknown>;
    expect(out.password).toBe("");
  });
});

describe("truncate", () => {
  it("cuts past the budget and flags it", () => {
    expect(truncate("hello", 10)).toEqual({ text: "hello", truncated: false });
    const r = truncate("hello world", 5);
    expect(r.truncated).toBe(true);
    expect(r.text).toBe("hello…");
  });
  it("a non-positive budget never truncates", () => {
    expect(truncate("abc", 0)).toEqual({ text: "abc", truncated: false });
  });
});

describe("buildEvent", () => {
  const raw: RawCall = {
    tool: "create_user",
    title: "Create User",
    risk: "WRITE",
    device: "site-a",
    transport: "http",
    ts: 1_000,
    durationMs: 42,
    isError: false,
    args: { name: "bob", password: "secret" },
    output: "USER created",
    hasStructured: false,
  };

  it("redacts inputs and records metadata", () => {
    const e = buildEvent(raw, "id1", { captureBody: true, maxBodyBytes: 1000 });
    expect(e.id).toBe("id1");
    expect(e.input).toContain('"name":"bob"');
    expect(e.input).toContain("«redacted»");
    expect(e.input).not.toContain("secret");
    expect(e.output).toBe("USER created");
    expect(e.outputBytes).toBe("USER created".length);
  });

  it("stores inputs verbatim when redactInput is off", () => {
    const e = buildEvent(raw, "id1b", {
      captureBody: true,
      maxBodyBytes: 1000,
      redactInput: false,
    });
    expect(e.input).toContain('"name":"bob"');
    expect(e.input).toContain('"password":"secret"');
    expect(e.input).not.toContain("«redacted»");
  });

  it("drops bodies when captureBody is off but keeps metadata", () => {
    const e = buildEvent(raw, "id2", { captureBody: false, maxBodyBytes: 1000 });
    expect(e.input).toBe("");
    expect(e.output).toBe("");
    expect(e.outputBytes).toBe("USER created".length);
    expect(e.durationMs).toBe(42);
  });

  it("truncates oversized bodies and sets the flag", () => {
    const big = { ...raw, output: "x".repeat(100) };
    const e = buildEvent(big, "id3", { captureBody: true, maxBodyBytes: 10 });
    expect(e.truncated).toBe(true);
    expect(e.output.length).toBeLessThan(100);
  });
});

describe("percentile", () => {
  it("interpolates and handles edges", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
  });
});

describe("computeStats", () => {
  const now = 600_000; // 10 minutes
  function ev(over: Partial<ToolEvent>): ToolEvent {
    return {
      id: Math.random().toString(36),
      ts: now - 1000,
      tool: "list_interfaces",
      title: "List",
      risk: "READ",
      durationMs: 10,
      isError: false,
      input: "",
      output: "",
      outputBytes: 0,
      hasStructured: false,
      truncated: false,
      ...over,
    };
  }

  it("rolls up totals, error rate, latency and breakdowns", () => {
    const events: ToolEvent[] = [
      ev({ tool: "list_interfaces", durationMs: 10, device: "a" }),
      ev({ tool: "list_interfaces", durationMs: 30, device: "a" }),
      ev({
        tool: "create_user",
        risk: "WRITE",
        durationMs: 50,
        isError: true,
        error: "boom",
        device: "b",
      }),
      ev({
        tool: "remove_user",
        risk: "DESTRUCTIVE",
        durationMs: 20,
        device: "b",
        outputBytes: 100,
      }),
    ];
    const s = computeStats(events, { now, windowMs: 600_000, buckets: 10 });
    expect(s.total).toBe(4);
    expect(s.errors).toBe(1);
    expect(s.errorRate).toBeCloseTo(0.25);
    expect(s.byStatus).toEqual({ ok: 3, error: 1 });
    expect(s.byRisk.READ).toBe(2);
    expect(s.byRisk.DESTRUCTIVE).toBe(1);
    expect(s.byTool[0]).toMatchObject({ tool: "list_interfaces", count: 2 });
    expect(s.byDevice).toEqual(
      expect.arrayContaining([
        { device: "a", count: 2 },
        { device: "b", count: 2 },
      ]),
    );
    expect(s.distinctTools).toBe(3);
    expect(s.distinctDevices).toBe(2);
    expect(s.latency.max).toBe(50);
    expect(s.outputBytes).toBe(100);
    expect(s.recentErrors[0]).toMatchObject({ tool: "create_user", error: "boom" });
  });

  it("places events into the correct time-series bucket", () => {
    const events = [
      ev({ ts: now - 595_000 }), // first bucket
      ev({ ts: now - 5_000 }), // last bucket
      ev({ ts: now - 5_000, isError: true }),
    ];
    const s = computeStats(events, { now, windowMs: 600_000, buckets: 10 });
    expect(s.series).toHaveLength(10);
    expect(s.series[0].ok).toBe(1);
    expect(s.series[9].ok).toBe(1);
    expect(s.series[9].error).toBe(1);
    const totalInSeries = s.series.reduce((n, b) => n + b.ok + b.error, 0);
    expect(totalInSeries).toBe(3);
  });
});
