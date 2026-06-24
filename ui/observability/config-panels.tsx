/**
 * Config page panels — point-in-time version history and the schema field guide.
 * Split out of `main.tsx` to keep each concern in its own component module.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, postJson } from "./api";

// ── Config: version history (point-in-time) ─────────────────────────────────
interface CfgVersion {
  id: string;
  ts: number;
  kind: "auto" | "checkpoint";
  label?: string;
  bytes: number;
  drift: { added: number; removed: number };
}
interface HistoryResp {
  versions: CfgVersion[];
  bytes: number;
  retention: number;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtWhen(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Point-in-time config history: timeline, drift vs current, diff, restore, checkpoint. */
export function ConfigHistoryPanel({ onRestored }: { onRestored: () => void }): ReactNode {
  const [data, setData] = useState<HistoryResp | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const [diff, setDiff] = useState<{
    summary: { added: number; removed: number };
    unified: string;
  } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState<string | null>(null); // null = checkpoint editor closed

  const load = useCallback(() => {
    void api<HistoryResp>("/api/config/history")
      .then(setData)
      .catch(() => setData({ versions: [], bytes: 0, retention: 50 }));
  }, []);
  useEffect(() => load(), [load]);

  type Simple = { ok?: boolean; error?: string; persisted?: boolean };
  const post = (path: string, b: unknown): Promise<Simple> =>
    postJson<Simple>(path, b).catch((): Simple => ({ error: "request failed" }));

  const saveCheckpoint = async (): Promise<void> => {
    const label = (labelDraft ?? "").trim();
    setLabelDraft(null);
    const r = await post("/api/config/history/checkpoint", { label: label || undefined });
    setMsg(r.ok ? `Checkpoint saved${label ? ` · “${label}”` : ""}` : `Failed: ${r.error}`);
    if (r.ok) load();
  };
  const showDiff = async (id: string): Promise<void> => {
    if (diffFor === id) {
      setDiffFor(null);
      setDiff(null);
      return;
    }
    setDiffFor(id);
    setDiff(null);
    const d = await api<{ summary: { added: number; removed: number }; unified: string }>(
      `/api/config/history/diff?id=${encodeURIComponent(id)}`,
    ).catch(() => null);
    setDiff(d);
  };
  const restore = async (id: string): Promise<void> => {
    setConfirmRestore(null);
    setBusy(true);
    const r = await post("/api/config/history/restore", { id });
    setBusy(false);
    setMsg(
      r.ok
        ? `Restored ${id}${r.persisted === false ? " (applied live, not persisted)" : ""}`
        : `Restore failed: ${r.error}`,
    );
    if (r.ok) {
      load();
      onRestored();
    }
  };
  const del = async (id: string): Promise<void> => {
    const r = await post("/api/config/history/delete", { id });
    setMsg(r.ok ? "Version deleted" : `Failed: ${r.error}`);
    if (r.ok) load();
  };

  if (!data) return <div className="muted">loading history…</div>;

  return (
    <>
      {msg && <div className="cfg-msg">{msg}</div>}
      <div className="toolbar" style={{ marginBottom: 14 }}>
        {labelDraft === null ? (
          <button className="btn is-active" onClick={() => setLabelDraft("")}>
            ★ Save checkpoint
          </button>
        ) : (
          <span className="cfgver-cp">
            <input
              className="backup-path-input"
              autoFocus
              placeholder="checkpoint name (e.g. pre-upgrade)"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveCheckpoint();
                if (e.key === "Escape") setLabelDraft(null);
              }}
            />
            <button className="topo-btn cfg-save" onClick={() => void saveCheckpoint()}>
              Save
            </button>
            <button className="topo-btn" onClick={() => setLabelDraft(null)}>
              Cancel
            </button>
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span className="muted">
          {data.versions.length} versions · {fmtBytes(data.bytes)} · auto-keep {data.retention}
        </span>
      </div>

      {data.versions.length === 0 ? (
        <div className="muted">No versions yet — they appear here after each config change.</div>
      ) : (
        <ol className="cfgver">
          {data.versions.map((v, i) => {
            const changed = v.drift.added + v.drift.removed;
            return (
              <li key={v.id} className={`cfgver__row${i === 0 ? " is-head" : ""}`}>
                <span className="cfgver__dot" aria-hidden="true" />
                <div className="cfgver__main">
                  <div className="cfgver__line">
                    <span className={`cfgver__kind cfgver__kind--${v.kind}`}>
                      {v.kind === "checkpoint" ? "★ checkpoint" : "auto"}
                    </span>
                    {v.label && <span className="cfgver__label">{v.label}</span>}
                    <span className="cfgver__time">{fmtWhen(v.ts)}</span>
                    {i === 0 ? (
                      <span className="cfgver__cur">latest</span>
                    ) : changed === 0 ? (
                      <span className="cfgver__same">identical to current</span>
                    ) : (
                      <span className="cfgver__drift">
                        <span className="add">+{v.drift.added}</span>
                        <span className="rem">−{v.drift.removed}</span>
                        <span className="muted"> vs current</span>
                      </span>
                    )}
                  </div>
                  {diffFor === v.id && (
                    <div className="cfgver__diff">
                      {diff ? (
                        diff.unified.trim() ? (
                          <pre className="body diff">{diff.unified}</pre>
                        ) : (
                          <span className="muted">No differences from the current config.</span>
                        )
                      ) : (
                        <span className="muted">computing diff…</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="cfgver__actions">
                  <button className="topo-btn" onClick={() => void showDiff(v.id)}>
                    {diffFor === v.id ? "Hide" : "Diff"}
                  </button>
                  {confirmRestore === v.id ? (
                    <>
                      <button
                        className="topo-btn cfg-save"
                        disabled={busy}
                        onClick={() => void restore(v.id)}
                      >
                        Confirm restore
                      </button>
                      <button className="topo-btn" onClick={() => setConfirmRestore(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="topo-btn"
                      disabled={i === 0}
                      title={i === 0 ? "This is the current config" : "Restore this version"}
                      onClick={() => setConfirmRestore(v.id)}
                    >
                      Restore
                    </button>
                  )}
                  {v.kind === "checkpoint" && (
                    <button
                      className="topo-btn cfgver__del"
                      title="Delete"
                      onClick={() => void del(v.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

// ── Config: schema-driven Field Guide ────────────────────────────────────────
interface GuideField {
  path: string;
  section: string;
  type: string;
  def?: string;
  desc?: string;
  enumv?: string[];
  required: boolean;
}
/** Flatten a JSON Schema into a documented, grouped field list. */
function flattenSchema(schema: Record<string, unknown> | null): GuideField[] {
  if (!schema) return [];
  const out: GuideField[] = [];
  const typeOf = (n: Record<string, unknown> | undefined): string => {
    if (!n) return "any";
    if (Array.isArray(n.enum)) return "enum";
    if (n.type === "array") return `array<${typeOf(n.items as Record<string, unknown>)}>`;
    if (Array.isArray(n.type)) return (n.type as string[]).join(" | ");
    return (n.type as string) ?? (n.properties ? "object" : "any");
  };
  const walk = (
    node: Record<string, unknown>,
    prefix: string,
    section: string,
    required: Set<string>,
  ): void => {
    const props = (node.properties as Record<string, Record<string, unknown>>) ?? {};
    for (const [k, v] of Object.entries(props)) {
      const path = prefix ? `${prefix}.${k}` : k;
      const sec = section || k;
      out.push({
        path,
        section: sec,
        type: typeOf(v),
        def: v.default !== undefined ? JSON.stringify(v.default) : undefined,
        desc: v.description as string | undefined,
        enumv: Array.isArray(v.enum) ? (v.enum as string[]) : undefined,
        required: required.has(k),
      });
      if (v.properties) walk(v, path, sec, new Set((v.required as string[]) ?? []));
      const ap = v.additionalProperties as Record<string, unknown> | undefined;
      if (ap?.properties) walk(ap, `${path}.<name>`, sec, new Set((ap.required as string[]) ?? []));
      const items = v.items as Record<string, unknown> | undefined;
      if (items?.properties)
        walk(items, `${path}[]`, sec, new Set((items.required as string[]) ?? []));
    }
  };
  walk(schema, "", "", new Set((schema.required as string[]) ?? []));
  return out;
}

/** A searchable, grouped guide to every config option — straight from the schema. */
export function FieldGuidePanel(): ReactNode {
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    void api<Record<string, unknown>>("/api/config-schema")
      .then(setSchema)
      .catch(() => {});
  }, []);
  const fields = useMemo(() => flattenSchema(schema), [schema]);
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? fields.filter(
        (f) =>
          f.path.toLowerCase().includes(needle) || (f.desc ?? "").toLowerCase().includes(needle),
      )
    : fields;
  const sections = useMemo(() => {
    const m = new Map<string, GuideField[]>();
    for (const f of filtered) {
      const arr = m.get(f.section) ?? [];
      arr.push(f);
      m.set(f.section, arr);
    }
    return [...m.entries()];
  }, [filtered]);

  if (!schema) return <div className="muted">loading schema…</div>;

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <input
          className="backup-path-input"
          style={{ width: "min(360px, 60vw)" }}
          placeholder="Search fields & descriptions…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span style={{ flex: 1 }} />
        <span className="muted">{filtered.length} options</span>
      </div>
      {sections.length === 0 ? (
        <div className="muted">No fields match “{q}”.</div>
      ) : (
        <div className="fguide">
          {sections.map(([sec, fs]) => (
            <div key={sec} className="fguide__sec">
              <h4 className="fguide__sechd">{sec}</h4>
              <div className="fguide__list">
                {fs.map((f) => (
                  <div key={f.path} className="fguide__item">
                    <div className="fguide__top">
                      <code className="fguide__path">{f.path}</code>
                      <span className="fguide__type">{f.type}</span>
                      {f.required && <span className="fguide__req">required</span>}
                      {f.def !== undefined && (
                        <span className="fguide__def">
                          default <code>{f.def}</code>
                        </span>
                      )}
                    </div>
                    {f.desc && <p className="fguide__desc">{f.desc}</p>}
                    {f.enumv && (
                      <div className="fguide__enum">
                        {f.enumv.map((e) => (
                          <code key={e}>{e}</code>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
