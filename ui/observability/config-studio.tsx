import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { api, postJson } from "./api";
import { highlightJson } from "./highlight";
import type { DeviceStatus } from "./types";

// ── Config Studio: edit the config JSON with autocomplete + safe apply ───────
export interface ConfigIssue {
  path: string;
  message: string;
}
export interface SchemaHints {
  keys: string[];
  enums: string[];
}
export interface DiffSummary {
  added: number;
  removed: number;
  unchanged: number;
  changed: boolean;
}
export interface SaveResp {
  ok: boolean;
  errors?: ConfigIssue[];
  pendingId?: string;
  rollbackMs?: number;
  path?: string;
  fromFile?: boolean;
  devicesChanged?: boolean;
  summary?: DiffSummary;
  unified?: string;
}

/** Walk a JSON Schema collecting property names and string enum values for hints. */
export function collectHints(schema: unknown): SchemaHints {
  const keys = new Set<string>();
  const enums = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.properties && typeof n.properties === "object") {
      for (const k of Object.keys(n.properties)) {
        keys.add(k);
        walk((n.properties as Record<string, unknown>)[k]);
      }
    }
    if (Array.isArray(n.enum)) for (const e of n.enum) if (typeof e === "string") enums.add(e);
    for (const f of ["items", "additionalProperties", "anyOf", "oneOf", "allOf"]) {
      const v = n[f];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
    // `$defs` / `definitions` are maps of (name → schema): walk each *value*, not
    // the container (whose own keys are def names, not properties), so device-level
    // fields survive if Zod ever emits a $ref form instead of an inlined schema.
    for (const f of ["$defs", "definitions", "patternProperties"]) {
      const v = n[f];
      if (v && typeof v === "object") for (const sub of Object.values(v)) walk(sub);
    }
  };
  walk(schema);
  return { keys: [...keys].sort(), enums: [...enums.add("true").add("false")].sort() };
}

/** The word being typed at the caret + whether we're after a `:` (a value position). */
export function wordAtCaret(
  text: string,
  caret: number,
): { word: string; start: number; isValue: boolean } {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_.-]/.test(text[start - 1])) start--;
  const word = text.slice(start, caret);
  // Look back past whitespace before the word: a `:` means we're typing a value.
  let i = start - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  return { word, start, isValue: text[i] === ":" };
}

export const ROLLBACK_OPTS: [string, number][] = [
  ["revert in 30s", 30_000],
  ["revert in 60s", 60_000],
  ["revert in 2m", 120_000],
  ["no auto-revert", 0],
];

/**
 * In-browser config editor: schema-driven autocomplete, authoritative Zod
 * validation, per-device connection tests, a diff preview, and a safe-apply that
 * the server auto-reverts unless you confirm in time.
 */
export function ConfigStudio({
  initial,
  onClose,
  onReload,
}: {
  initial: unknown;
  onClose: () => void;
  onReload: () => void;
}): ReactNode {
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [hints, setHints] = useState<SchemaHints>({ keys: [], enums: [] });
  const [errors, setErrors] = useState<ConfigIssue[]>([]);
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [ac, setAc] = useState<{
    items: string[];
    index: number;
    start: number;
    x: number;
    y: number;
  } | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; label: string }>>({});
  const [preview, setPreview] = useState<{ summary?: DiffSummary; unified?: string } | null>(null);
  const [pending, setPending] = useState<SaveResp | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [rollbackMs, setRollbackMs] = useState(60_000);
  const [msg, setMsg] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<number | null>(null);
  const hlRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLPreElement | null>(null);

  // Fetch the schema once → completion hints.
  useEffect(() => {
    void api<unknown>("/api/config-schema")
      .then((s) => setHints(collectHints(s)))
      .catch(() => {});
  }, []);

  // Re-apply a programmatic caret after an autocomplete insertion re-renders.
  useEffect(() => {
    if (caretRef.current != null && taRef.current) {
      taRef.current.selectionStart = taRef.current.selectionEnd = caretRef.current;
      caretRef.current = null;
    }
  });

  // Debounced validation: parse locally first, then ask the server (Zod truth).
  useEffect(() => {
    const t = setTimeout(() => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        setJsonErr(e instanceof Error ? e.message : String(e));
        setErrors([]);
        return;
      }
      setJsonErr(null);
      void postJson<{ ok: boolean; errors: ConfigIssue[] }>("/api/config/validate", parsed)
        .then((r) => setErrors(r.errors ?? []))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [text]);

  // Rollback countdown while a save is pending confirmation.
  useEffect(() => {
    if (!pending || countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [pending, countdown]);
  useEffect(() => {
    if (pending && countdown === 0 && (pending.rollbackMs ?? 0) > 0) {
      // The server's timer has fired and reverted; reflect it and reload.
      setMsg("Auto-reverted — changes were not confirmed in time.");
      setPending(null);
      onReload();
    }
  }, [pending, countdown, onReload]);

  const valid = !jsonErr && errors.length === 0;

  const refreshAc = (el: HTMLTextAreaElement): void => {
    const { word, start, isValue } = wordAtCaret(el.value, el.selectionStart);
    if (word.length < 1) {
      setAc(null);
      return;
    }
    const pool = isValue ? hints.enums : hints.keys;
    const items = pool.filter((k) => k.startsWith(word) && k !== word).slice(0, 8);
    if (!items.length) {
      setAc(null);
      return;
    }
    // The editor font is monospace, so caret pixel position is exact: column ×
    // char-advance and line × line-height (12px / 1.5 = 18px, 10/12px padding).
    const before = el.value.slice(0, el.selectionStart).split("\n");
    const col = before[before.length - 1].length;
    const x = Math.min(12 + col * 7.22 - el.scrollLeft, el.clientWidth - 160);
    const y = 10 + before.length * 18 - el.scrollTop + 4;
    setAc({ items, index: 0, start, x: Math.max(4, x), y });
  };

  const accept = (completion: string): void => {
    const el = taRef.current;
    if (!el || !ac) return;
    const next = text.slice(0, ac.start) + completion + text.slice(el.selectionStart);
    caretRef.current = ac.start + completion.length;
    setText(next);
    setAc(null);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (!ac) {
      if (e.key === " " && e.ctrlKey) {
        e.preventDefault();
        refreshAc(e.currentTarget);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAc({ ...ac, index: (ac.index + 1) % ac.items.length });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAc({ ...ac, index: (ac.index - 1 + ac.items.length) % ac.items.length });
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(ac.items[ac.index]);
    } else if (e.key === "Escape") {
      setAc(null);
    }
  };

  const parseOrNull = (): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const testDevices = async (): Promise<void> => {
    const obj = parseOrNull() as { devices?: Record<string, unknown> } | null;
    if (!obj?.devices) return;
    setMsg("Testing devices…");
    const out: Record<string, { ok: boolean; label: string }> = {};
    type TestResp = { ok: boolean; status?: DeviceStatus; errors?: ConfigIssue[] };
    for (const [name, dc] of Object.entries(obj.devices)) {
      const r = await postJson<TestResp>("/api/config/test-device", {
        name,
        config: dc,
      }).catch((): TestResp => ({ ok: false }));
      out[name] =
        r.ok && r.status?.reachable === true
          ? {
              ok: true,
              label: `${Math.round(r.status.latencyMs ?? 0)}ms · ${r.status.identity ?? "ok"}`,
            }
          : { ok: false, label: r.status?.error ?? r.errors?.[0]?.message ?? "unreachable" };
      setTests({ ...out });
    }
    setMsg(null);
  };

  const doPreview = async (): Promise<void> => {
    const obj = parseOrNull();
    if (obj == null) return;
    setPreview(await postJson("/api/config/preview", obj));
  };

  const doSave = async (): Promise<void> => {
    const obj = parseOrNull();
    if (obj == null) return;
    setMsg("Saving…");
    const r = await postJson<SaveResp>("/api/config", { config: obj, rollbackMs });
    setMsg(null);
    setPreview(null);
    if (!r.ok) {
      setErrors(r.errors ?? [{ path: "(root)", message: "save rejected" }]);
      return;
    }
    setPending(r);
    setCountdown(Math.round((r.rollbackMs ?? 0) / 1000));
  };

  const doKeep = async (): Promise<void> => {
    if (!pending?.pendingId) return;
    await postJson("/api/config/keep", { pendingId: pending.pendingId });
    setPending(null);
    setMsg("Changes kept.");
    onReload();
  };
  const doRollback = async (): Promise<void> => {
    if (!pending?.pendingId) return;
    await postJson("/api/config/rollback", { pendingId: pending.pendingId });
    setPending(null);
    setMsg("Reverted to the previous config.");
    onReload();
  };

  const lines = text.split("\n").length;

  return (
    <div className="cfgstudio">
      <div className="cfg-toolbar">
        <span className={`cfg-status ${valid ? "is-ok" : "is-bad"}`}>
          {jsonErr
            ? "invalid JSON"
            : errors.length
              ? `${errors.length} schema issue(s)`
              : "valid ✓"}
        </span>
        <span style={{ flex: 1 }} />
        <button className="topo-btn" onClick={() => void testDevices()}>
          Test devices
        </button>
        <button className="topo-btn" onClick={() => void doPreview()} disabled={!valid}>
          Preview diff
        </button>
        <select
          className="cfg-select"
          value={rollbackMs}
          onChange={(e) => setRollbackMs(Number(e.target.value))}
          title="Auto-revert window"
        >
          {ROLLBACK_OPTS.map(([label, v]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <button
          className="topo-btn cfg-save"
          onClick={() => void doSave()}
          disabled={!valid || !!pending}
        >
          Save
        </button>
        <button className="topo-btn" onClick={onClose}>
          Close
        </button>
      </div>

      {msg && <div className="cfg-msg">{msg}</div>}

      {pending && (
        <div className="cfg-banner">
          <strong>Applied.</strong>{" "}
          {(pending.rollbackMs ?? 0) > 0 ? (
            <>
              Reverting in <span className="cfg-count">{countdown}s</span> unless you keep it.
            </>
          ) : (
            <>Saved without an auto-revert window.</>
          )}
          {pending.devicesChanged && (
            <span className="cfg-warn">
              {" "}
              · device list changed — reconnect the MCP client to expose it to the model
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button className="topo-btn cfg-save" onClick={() => void doKeep()}>
            Keep changes
          </button>
          <button className="topo-btn" onClick={() => void doRollback()}>
            Revert now
          </button>
        </div>
      )}

      <div className="cfg-editor">
        <pre className="cfg-gutter" aria-hidden="true" ref={gutterRef}>
          {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
        </pre>
        <div className="cfg-ta-wrap">
          {/* Highlight overlay sits behind a transparent-text textarea; both share
              identical geometry and scroll in lockstep so the colours line up. */}
          <pre className="cfg-hl" aria-hidden="true" ref={hlRef}>
            {highlightJson(text)}
            {"\n"}
          </pre>
          <textarea
            ref={taRef}
            className="cfg-ta"
            spellCheck={false}
            wrap="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              refreshAc(e.currentTarget);
            }}
            onKeyDown={onKeyDown}
            onClick={() => setAc(null)}
            onScroll={(e) => {
              const ta = e.currentTarget;
              if (hlRef.current) {
                hlRef.current.scrollTop = ta.scrollTop;
                hlRef.current.scrollLeft = ta.scrollLeft;
              }
              if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
            }}
          />
          {ac && (
            <div className="cfg-ac" style={{ left: ac.x, top: ac.y }}>
              {ac.items.map((it, i) => (
                <div
                  key={it}
                  className={`cfg-ac-item${i === ac.index ? " is-sel" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    accept(it);
                  }}
                >
                  {it}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {Object.keys(tests).length > 0 && (
        <div className="cfg-chips">
          {Object.entries(tests).map(([name, r]) => (
            <span key={name} className={`cfg-chip ${r.ok ? "is-ok" : "is-bad"}`}>
              {r.ok ? "●" : "○"} {name}: {r.label}
            </span>
          ))}
        </div>
      )}

      {(jsonErr || errors.length > 0) && (
        <div className="cfg-errors">
          {jsonErr ? (
            <div className="cfg-err">JSON: {jsonErr}</div>
          ) : (
            errors.slice(0, 12).map((e, i) => (
              <div className="cfg-err" key={i}>
                <code>{e.path}</code> — {e.message}
              </div>
            ))
          )}
        </div>
      )}

      {preview && (
        <div className="cfg-preview">
          <div className="cfg-preview__hd">
            <strong>Diff vs current</strong>
            <span className="muted">
              {preview.summary?.changed
                ? `+${preview.summary.added} / -${preview.summary.removed}`
                : "no changes"}
            </span>
            <span style={{ flex: 1 }} />
            <button className="topo-btn" onClick={() => setPreview(null)}>
              ✕
            </button>
          </div>
          <pre className="cfg-diff">
            {(preview.unified || "(identical)").split("\n").map((l, i) => (
              <div
                key={i}
                className={
                  l.startsWith("+")
                    ? "d-add"
                    : l.startsWith("-")
                      ? "d-del"
                      : l.startsWith("@@")
                        ? "d-hunk"
                        : ""
                }
              >
                {l || " "}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}
