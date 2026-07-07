/**
 * Config editor shell. Owns the single working `cfg` object and the shared
 * safe-apply pipeline (validate → preview → save → countdown → keep/rollback,
 * plus per-device connection tests). A Form ↔ JSON mode switch renders either the
 * interactive card form (`ConfigForm`) or the raw `JsonEditor` — both mutate the
 * same `cfg`, so switching modes is lossless and the JSON always reflects the form.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { postJson } from "./api";
import { ConfigForm } from "./config-form";
import { JsonEditor, ROLLBACK_OPTS } from "./config-studio";
import type { ConfigIssue, DiffSummary, SaveResp } from "./config-studio";
import type { DeviceStatus } from "./types";

type Cfg = Record<string, unknown>;
const asObj = (v: unknown): Cfg => (v && typeof v === "object" && !Array.isArray(v) ? (v as Cfg) : {});

export function ConfigEditor({
  initial,
  onClose,
  onReload,
}: {
  initial: unknown;
  onClose: () => void;
  onReload: () => void;
}): ReactNode {
  const [cfg, setCfg] = useState<Cfg>(() => asObj(initial));
  const [mode, setMode] = useState<"form" | "json">("form");
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [errors, setErrors] = useState<ConfigIssue[]>([]);
  const [tests, setTests] = useState<Record<string, { ok: boolean; label: string }>>({});
  const [preview, setPreview] = useState<{ summary?: DiffSummary; unified?: string } | null>(null);
  const [pending, setPending] = useState<SaveResp | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [rollbackMs, setRollbackMs] = useState(60_000);
  const [msg, setMsg] = useState<string | null>(null);

  // Debounced schema validation of the working config (Zod is authoritative).
  useEffect(() => {
    const t = setTimeout(() => {
      void postJson<{ ok: boolean; errors: ConfigIssue[] }>("/api/config/validate", cfg)
        .then((r) => setErrors(r.errors ?? []))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [cfg]);

  // Rollback countdown while a save awaits confirmation.
  useEffect(() => {
    if (!pending || countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [pending, countdown]);
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;
  useEffect(() => {
    if (pending && countdown === 0 && (pending.rollbackMs ?? 0) > 0) {
      setMsg("Auto-reverted — changes were not confirmed in time.");
      setPending(null);
      onReloadRef.current();
    }
  }, [pending, countdown]);

  const valid = !jsonErr && errors.length === 0;

  const testDevices = async (): Promise<void> => {
    const devices = asObj(cfg.devices);
    if (Object.keys(devices).length === 0) return;
    setMsg("Testing devices…");
    const out: Record<string, { ok: boolean; label: string }> = {};
    type TestResp = { ok: boolean; status?: DeviceStatus; errors?: ConfigIssue[] };
    for (const [name, dc] of Object.entries(devices)) {
      const r = await postJson<TestResp>("/api/config/test-device", { name, config: dc }).catch((): TestResp => ({ ok: false }));
      out[name] =
        r.ok && r.status?.reachable === true
          ? { ok: true, label: `${Math.round(r.status.latencyMs ?? 0)}ms · ${r.status.identity ?? "ok"}` }
          : { ok: false, label: r.status?.error ?? r.errors?.[0]?.message ?? "unreachable" };
      setTests({ ...out });
    }
    setMsg(null);
  };

  const doPreview = async (): Promise<void> => {
    setPreview(await postJson("/api/config/preview", cfg));
  };

  const doSave = async (): Promise<void> => {
    setMsg("Saving…");
    const r = await postJson<SaveResp>("/api/config", { config: cfg, rollbackMs });
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

  return (
    <div className="cfgstudio">
      <div className="cfg-toolbar">
        <div className="cfg-modeswitch">
          <button
            className={`cfg-mode${mode === "form" ? " is-active" : ""}`}
            onClick={() => {
              setJsonErr(null);
              setMode("form");
            }}
          >
            ⊞ Form
          </button>
          <button className={`cfg-mode${mode === "json" ? " is-active" : ""}`} onClick={() => setMode("json")}>
            {"{ } "}JSON
          </button>
        </div>
        <span className={`cfg-status ${valid ? "is-ok" : "is-bad"}`}>
          {jsonErr ? "invalid JSON" : errors.length ? `${errors.length} schema issue(s)` : "valid ✓"}
        </span>
        <span style={{ flex: 1 }} />
        <button className="topo-btn" onClick={() => void testDevices()}>
          Test devices
        </button>
        <button className="topo-btn" onClick={() => void doPreview()} disabled={!valid}>
          Preview diff
        </button>
        <select className="cfg-select" value={rollbackMs} onChange={(e) => setRollbackMs(Number(e.target.value))} title="Auto-revert window">
          {ROLLBACK_OPTS.map(([label, v]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <button className="topo-btn cfg-save" onClick={() => void doSave()} disabled={!valid || !!pending}>
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
            <span className="cfg-warn"> · device list changed — reconnect the MCP client to expose it to the model</span>
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

      {mode === "form" ? (
        <ConfigForm cfg={cfg} onChange={setCfg} />
      ) : (
        <JsonEditor value={cfg} onChange={(o) => setCfg(asObj(o))} onJsonError={setJsonErr} />
      )}

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
              {preview.summary?.changed ? `+${preview.summary.added} / -${preview.summary.removed}` : "no changes"}
            </span>
            <span style={{ flex: 1 }} />
            <button className="topo-btn" onClick={() => setPreview(null)}>
              ✕
            </button>
          </div>
          <pre className="cfg-diff">
            {(preview.unified || "(identical)").split("\n").map((l, i) => (
              <div key={i} className={l.startsWith("+") ? "d-add" : l.startsWith("-") ? "d-del" : l.startsWith("@@") ? "d-hunk" : ""}>
                {l || " "}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}
