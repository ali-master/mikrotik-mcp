import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, postJson } from "./api";
import { Panel } from "./atoms";
import type { DiffSummary } from "./config-studio";
import { bytes, clock } from "./format";
import { Button } from "./geist";

// ── Config snapshots view ────────────────────────────────────────────────────
interface Snapshot {
  id: string;
  device: string;
  ts: number;
  label?: string;
  rosVersion?: string;
  bytes: number;
  lines: number;
  sha: string;
  body?: string;
}

/** Browse stored `/export` snapshots and time-travel diff any two. */
export function SnapshotsView(): ReactNode {
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sel, setSel] = useState<Snapshot | null>(null);
  const [diff, setDiff] = useState<{ summary: DiffSummary; unified: string } | null>(null);

  const load = useCallback(() => {
    void api<{ snapshots: Snapshot[] }>("/api/snapshots")
      .then((r) => setSnaps(r.snapshots))
      .catch(() => setSnaps([]));
  }, []);
  useEffect(() => load(), [load]);

  const viewBody = (id: string): void => {
    void api<Snapshot>(`/api/snapshot/${encodeURIComponent(id)}`)
      .then(setSel)
      .catch(() => {});
  };
  const runDiff = (): void => {
    if (!from || !to) return;
    void postJson<{ summary: DiffSummary; unified: string }>("/api/snapshots/diff", { from, to })
      .then(setDiff)
      .catch(() => {});
  };

  if (!snaps) return <div className="muted">loading snapshots…</div>;
  if (snaps.length === 0) {
    return (
      <div className="feed-empty">
        <div className="feed-empty__icon">🕰️</div>
        <p className="feed-empty__title">No config snapshots yet</p>
        <p className="feed-empty__sub">
          Capture one with the <code>capture_config_snapshot</code> tool — then time-travel diff any
          two here.
        </p>
      </div>
    );
  }

  const opts = snaps.map((s) => (
    <option key={s.id} value={s.id}>
      {s.device} · {s.label ?? s.id} · {clock(s.ts)}
    </option>
  ));

  return (
    <section className="view">
      <Panel
        title="Config snapshots"
        className="reveal"
        extra={
          <button className="btn" onClick={load}>
            ↻ Refresh
          </button>
        }
      >
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <select className="btn" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">diff from…</option>
            {opts}
          </select>
          <select className="btn" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">to…</option>
            {opts}
          </select>
          <button className="btn is-active" onClick={runDiff} disabled={!from || !to}>
            Diff →
          </button>
          <span className="muted">{snaps.length} snapshots</span>
        </div>
        <div className="feedwrap">
          <table className="feed">
            <thead>
              <tr>
                <th>captured</th>
                <th>device</th>
                <th>label</th>
                <th>version</th>
                <th className="num">lines</th>
                <th className="num">size</th>
                <th>output</th>
              </tr>
            </thead>
            <tbody>
              {snaps.map((s) => (
                <tr
                  key={s.id}
                  className={sel?.id === s.id ? "is-selected" : undefined}
                  onClick={() => viewBody(s.id)}
                >
                  <td>{clock(s.ts)}</td>
                  <td>{s.device}</td>
                  <td>{s.label ?? "—"}</td>
                  <td>{s.rosVersion ?? "—"}</td>
                  <td className="num">{s.lines}</td>
                  <td className="num">{bytes(s.bytes)}</td>
                  <td className="preview">view export →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {diff && (
        <Panel
          title="Time-travel diff"
          className="reveal"
          extra={
            <span className="muted">
              {diff.summary.changed
                ? `+${diff.summary.added} / -${diff.summary.removed}`
                : "identical"}
            </span>
          }
        >
          <pre className="cfg-diff">
            {(diff.unified || "(identical)").split("\n").map((l, i) => (
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
        </Panel>
      )}

      {sel && (
        <Panel
          title={`Snapshot · ${sel.label ?? sel.id}`}
          className="reveal"
          extra={
            <Button type="secondary" size="sm" onClick={() => setSel(null)}>
              ✕ Close
            </Button>
          }
        >
          <pre className="body" style={{ maxHeight: 460 }}>
            {sel.body || "(empty)"}
          </pre>
        </Panel>
      )}
    </section>
  );
}
