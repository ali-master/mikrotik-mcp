/**
 * Recorder behaviour (Vitest) — exercised against a fake in-memory store, so no
 * `bun:sqlite` is involved. Covers the disabled fast-path, redaction/persist,
 * live fan-out, and prune-on-threshold.
 */
import { afterEach, describe, it, expect } from "vite-plus/test";
import type { RawCall, ToolEvent } from "../../src/observability/event";
import {
  configureRecorder,
  isRecording,
  recordToolCall,
  shutdownRecorder,
  subscribe,
} from "../../src/observability/recorder";
import type { EventFilter, EventStore } from "../../src/observability/store";

class FakeStore implements EventStore {
  rows: ToolEvent[] = [];
  pruned = 0;
  insert(e: ToolEvent): void {
    this.rows.push(e);
  }
  query(_f: EventFilter): ToolEvent[] {
    return [...this.rows].reverse();
  }
  get(id: string): ToolEvent | null {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  total(): number {
    return this.rows.length;
  }
  delete(ids: string[]): number {
    const remove = new Set(ids);
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !remove.has(r.id));
    return before - this.rows.length;
  }
  clear(): number {
    const n = this.rows.length;
    this.rows = [];
    return n;
  }
  prune(maxEvents: number): number {
    const drop = Math.max(0, this.rows.length - maxEvents);
    this.rows.splice(0, drop);
    this.pruned += drop;
    return drop;
  }
  close(): void {}
}

function call(over: Partial<RawCall> = {}): Omit<RawCall, "transport"> {
  return {
    tool: "create_user",
    title: "Create User",
    risk: "WRITE",
    ts: 1000,
    durationMs: 5,
    isError: false,
    args: { name: "bob", password: "secret" },
    output: "ok",
    hasStructured: false,
    ...over,
  };
}

afterEach(() => shutdownRecorder());

describe("recorder", () => {
  it("is a no-op until configured", () => {
    expect(isRecording()).toBe(false);
    recordToolCall(call()); // must not throw
  });

  it("persists redacted events and fans out to subscribers", () => {
    const store = new FakeStore();
    configureRecorder({
      store,
      capture: { captureBody: true, maxBodyBytes: 1000 },
      maxEvents: 100,
      transport: "http",
    });
    const seen: ToolEvent[] = [];
    subscribe((e) => seen.push(e));

    recordToolCall(call());

    expect(store.rows).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].transport).toBe("http");
    expect(seen[0].input).not.toContain("secret");
    expect(seen[0].input).toContain("«redacted»");
    expect(seen[0].id).toBeTruthy();
  });

  it("unsubscribe stops further delivery", () => {
    const store = new FakeStore();
    configureRecorder({ store, capture: { captureBody: false, maxBodyBytes: 0 }, maxEvents: 100 });
    let n = 0;
    const off = subscribe(() => n++);
    recordToolCall(call());
    off();
    recordToolCall(call());
    expect(n).toBe(1);
    expect(store.rows).toHaveLength(2);
  });

  it("prunes toward the retention cap as rows accumulate", () => {
    const store = new FakeStore();
    configureRecorder({ store, capture: { captureBody: false, maxBodyBytes: 0 }, maxEvents: 10 });
    // Prune runs every 500 inserts, so the table is bounded by maxEvents + 500
    // between passes rather than pinned exactly at the cap.
    for (let i = 0; i < 600; i++) recordToolCall(call({ ts: 1000 + i }));
    expect(store.pruned).toBeGreaterThan(0);
    expect(store.total()).toBeLessThanOrEqual(10 + 500);
  });

  it("a throwing subscriber does not break recording or others", () => {
    const store = new FakeStore();
    configureRecorder({ store, capture: { captureBody: false, maxBodyBytes: 0 }, maxEvents: 100 });
    let good = 0;
    subscribe(() => {
      throw new Error("bad subscriber");
    });
    subscribe(() => good++);
    recordToolCall(call());
    expect(good).toBe(1);
    expect(store.rows).toHaveLength(1);
  });
});
