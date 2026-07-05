/**
 * Drift Guard dashboard view — fleet-wide golden-config drift detection,
 * per-device diff viewer with change attribution, and baseline management.
 */
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { api, deleteJson, postJson } from "./api";
import type {
  DriftAttribution,
  DriftBaseline,
  DriftDeviceStatus,
  DriftReport,
  DriftSection,
} from "./types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function clock(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

function ago(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  "in-sync": "#22c55e",
  drifted: "#f59e0b",
  unknown: "#a1a1a1",
  "no-baseline": "#6b7280",
};

const STATUS_LABELS: Record<string, string> = {
  "in-sync": "In Sync",
  drifted: "Drifted",
  unknown: "Unknown",
  "no-baseline": "No Baseline",
};

// ── Snapshot picker for setting baselines from the dashboard ─────────────

interface SnapshotMeta {
  id: string;
  ts: number;
  label?: string;
  lines: number;
  bytes: number;
  sha: string;
}

function SetBaselineForm({ device, onDone }: { device: string; onDone: () => void }): ReactNode {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selected, setSelected] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void api<{ device: string; snapshots: SnapshotMeta[] }>(
      `/api/drift/history/${encodeURIComponent(device)}?limit=20`,
    ).then((r) => {
      setSnapshots(r.snapshots);
      if (r.snapshots.length > 0) setSelected(r.snapshots[0]!.id);
    });
  }, [device]);

  const submit = async () => {
    if (!selected) return;
    setLoading(true);
    setMsg("");
    const res = await postJson<{ ok?: boolean; error?: string }>("/api/drift/baseline", {
      device,
      snapshotId: selected,
      label: label || undefined,
    });
    setLoading(false);
    if (res.ok) {
      onDone();
    } else {
      setMsg(res.error ?? "Failed");
    }
  };

  if (snapshots.length === 0) {
    return (
      <div style={{ padding: 8 }}>
        <span className="muted">
          No snapshots for this device. Capture one with capture_config_snapshot first.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: 8 }}>
      <select
        className="input"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        style={{ flex: 1, minWidth: 200 }}
      >
        {snapshots.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id} — {clock(s.ts)} — {s.lines} lines
            {s.label ? ` "${s.label}"` : ""}
          </option>
        ))}
      </select>
      <input
        className="input"
        placeholder="Label (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        style={{ width: 160 }}
      />
      <button className="btn btn--sm" onClick={() => void submit()} disabled={loading || !selected}>
        {loading ? "Setting..." : "Set as Baseline"}
      </button>
      {msg && <span style={{ color: "#ef4444", fontSize: 12 }}>{msg}</span>}
    </div>
  );
}

// ── Diff viewer ─────────────────────────────────────────────────────────────

function DiffViewer({ unified }: { unified: string }): ReactNode {
  if (!unified) return <span className="muted">No differences.</span>;
  const lines = unified.split("\n");
  return (
    <pre
      style={{
        fontSize: 11,
        lineHeight: 1.5,
        overflow: "auto",
        maxHeight: 500,
        margin: 0,
        padding: 12,
        background: "var(--bg-2, #111)",
        borderRadius: 6,
      }}
    >
      {lines.map((line, i) => {
        let color = "var(--fg-2, #aaa)";
        let bg = "transparent";
        if (line.startsWith("+")) {
          color = "#22c55e";
          bg = "rgba(34,197,94,0.08)";
        } else if (line.startsWith("-")) {
          color = "#ef4444";
          bg = "rgba(239,68,68,0.08)";
        } else if (line.startsWith("@@")) {
          color = "#3b82f6";
        } else if (line.startsWith("/")) {
          color = "#f59e0b";
        }
        return (
          <div key={i} style={{ color, background: bg, padding: "0 4px" }}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </pre>
  );
}

// ── Section breakdown bars ──────────────────────────────────────────────────

function SectionBars({ sections }: { sections: DriftSection[] }): ReactNode {
  if (sections.length === 0) return null;
  const maxChanges = Math.max(...sections.map((s) => s.added + s.removed), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {sections.slice(0, 15).map((s) => {
        return (
          <div key={s.path} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 220,
                fontSize: 11,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--fg-1, #eee)",
              }}
              title={s.path}
            >
              {s.path}
            </span>
            <div
              style={{
                flex: 1,
                height: 14,
                background: "var(--bg-2, #222)",
                borderRadius: 3,
                overflow: "hidden",
                display: "flex",
              }}
            >
              <div
                style={{
                  width: `${(s.added / maxChanges) * 100}%`,
                  background: "#22c55e",
                  height: "100%",
                }}
              />
              <div
                style={{
                  width: `${(s.removed / maxChanges) * 100}%`,
                  background: "#ef4444",
                  height: "100%",
                }}
              />
            </div>
            <span style={{ fontSize: 11, color: "var(--fg-2, #aaa)", minWidth: 60 }}>
              +{s.added} -{s.removed}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Attribution table ───────────────────────────────────────────────────────

function AttributionTable({ attributions }: { attributions: DriftAttribution[] }): ReactNode {
  if (attributions.length === 0) {
    return <span className="muted">No config-related log entries found.</span>;
  }
  return (
    <div style={{ maxHeight: 250, overflowY: "auto" }}>
      <table className="tbl" style={{ fontSize: 11 }}>
        <thead>
          <tr>
            <th>Time</th>
            <th>User</th>
            <th>Action</th>
            <th>Section</th>
            <th>Log</th>
          </tr>
        </thead>
        <tbody>
          {attributions.map((a, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: "nowrap" }}>{a.timestamp ?? "—"}</td>
              <td>{a.user ?? "—"}</td>
              <td>
                <span
                  style={{
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "var(--bg-2, #222)",
                    fontSize: 10,
                  }}
                >
                  {a.action ?? "?"}
                </span>
              </td>
              <td
                style={{
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={a.section}
              >
                {a.section}
              </td>
              <td
                style={{
                  maxWidth: 300,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--fg-2, #aaa)",
                }}
                title={a.logLine}
              >
                {a.logLine}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Device detail panel ─────────────────────────────────────────────────────

function DeviceDetail({
  device,
  onClose,
  onChanged,
}: {
  device: string;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const [report, setReport] = useState<DriftReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const check = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api<DriftReport | { error: string }>(
        `/api/drift/check/${encodeURIComponent(device)}`,
      );
      if ("error" in r) {
        setError(r.error);
      } else {
        setReport(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [device]);

  const promote = async () => {
    const res = await postJson<{ ok?: boolean; error?: string }>("/api/drift/baseline", {
      device,
      snapshotId: report?.baselineId,
      label: "promoted",
    });
    if (!res.error) onChanged();
  };

  const remove = async () => {
    await deleteJson<{ ok?: boolean }>(`/api/drift/baseline/${encodeURIComponent(device)}`, {});
    onChanged();
  };

  return (
    <div
      className="panel reveal"
      style={{ marginTop: 16, border: "1px solid var(--border, #333)", borderRadius: 8 }}
    >
      <div className="sheet__hd" style={{ padding: "12px 16px" }}>
        <div>
          <strong>{device}</strong>
          <span className="muted" style={{ marginLeft: 8 }}>
            Drift Detail
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn--sm" onClick={() => void check()} disabled={loading}>
            {loading ? "Checking..." : "Check Now"}
          </button>
          <button className="btn btn--sm btn--danger" onClick={() => void remove()}>
            Remove Baseline
          </button>
          <button className="btn btn--xs" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {error && <div style={{ padding: "8px 16px", color: "#ef4444" }}>{error}</div>}

      {report && (
        <div style={{ padding: "0 16px 16px" }}>
          {/* Summary bar */}
          <div
            style={{
              display: "flex",
              gap: 24,
              alignItems: "center",
              padding: "12px 0",
              borderBottom: "1px solid var(--border, #333)",
              marginBottom: 12,
            }}
          >
            <div>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: report.identical ? "#22c55e" : "#f59e0b",
                  marginRight: 6,
                }}
              />
              <strong>{report.identical ? "In Sync" : "Drifted"}</strong>
            </div>
            {!report.identical && (
              <>
                <div>
                  Score: <strong>{report.score}</strong>/100
                </div>
                <div style={{ color: "#22c55e" }}>+{report.summary.added}</div>
                <div style={{ color: "#ef4444" }}>-{report.summary.removed}</div>
                <div className="muted">{report.summary.unchanged} unchanged</div>
                <button className="btn btn--sm" onClick={() => void promote()}>
                  Promote as Baseline
                </button>
              </>
            )}
            <div className="muted" style={{ marginLeft: "auto" }}>
              Checked: {clock(report.capturedAt)}
            </div>
          </div>

          {/* Section breakdown */}
          {report.sections.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Sections with drift</h4>
              <SectionBars sections={report.sections} />
            </div>
          )}

          {/* Change attribution */}
          {report.attributions.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Change attribution</h4>
              <AttributionTable attributions={report.attributions} />
            </div>
          )}

          {/* Unified diff */}
          {!report.identical && (
            <div>
              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Unified diff</h4>
              <DiffViewer unified={report.unified} />
            </div>
          )}
        </div>
      )}

      {!report && !loading && !error && (
        <div style={{ padding: "16px", textAlign: "center" }} className="muted">
          Click "Check Now" to run a live drift check against the golden baseline.
        </div>
      )}
    </div>
  );
}

// ── Main view ───────────────────────────────────────────────────────────────

export function DriftView(): ReactNode {
  const [devices, setDevices] = useState<DriftDeviceStatus[]>([]);
  const [baselines, setBaselines] = useState<DriftBaseline[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [showSetBaseline, setShowSetBaseline] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [status, bl] = await Promise.all([
        api<{ devices: DriftDeviceStatus[] }>("/api/drift/status"),
        api<{ baselines: DriftBaseline[] }>("/api/drift/baselines"),
      ]);
      setDevices(status.devices);
      setBaselines(bl.baselines);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 15_000);
    return () => clearInterval(interval);
  }, [load]);

  if (error && devices.length === 0) {
    return (
      <div className="panel reveal" style={{ padding: 24 }}>
        <p style={{ color: "#ef4444" }}>{error}</p>
      </div>
    );
  }

  const withBaseline = devices.filter((d) => d.status !== "no-baseline");

  return (
    <>
      {/* Stats row */}
      <div className="stats-row reveal">
        <div className="stat">
          <div className="stat__n">{devices.length}</div>
          <div className="stat__l">Devices</div>
        </div>
        <div className="stat">
          <div className="stat__n">{withBaseline.length}</div>
          <div className="stat__l">With Baseline</div>
        </div>
        <div className="stat">
          <div className="stat__n" style={{ color: "#22c55e" }}>
            {devices.filter((d) => d.status === "in-sync").length}
          </div>
          <div className="stat__l">In Sync</div>
        </div>
        <div className="stat">
          <div className="stat__n" style={{ color: "#f59e0b" }}>
            {devices.filter((d) => d.status === "drifted").length}
          </div>
          <div className="stat__l">Drifted</div>
        </div>
      </div>

      {/* Fleet overview cards */}
      <div className="panel reveal">
        <div className="sheet__hd">
          <h3 style={{ margin: 0 }}>Fleet Drift Overview</h3>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240, 1fr))",
            gap: 12,
            padding: 16,
          }}
        >
          {devices.map((d) => (
            <div
              key={d.device}
              onClick={() => {
                if (d.status !== "no-baseline") setSelectedDevice(d.device);
              }}
              style={{
                padding: 16,
                borderRadius: 8,
                border: `1px solid ${selectedDevice === d.device ? "#3b82f6" : "var(--border, #333)"}`,
                background: "var(--bg-2, #111)",
                cursor: d.status !== "no-baseline" ? "pointer" : "default",
                transition: "border-color 0.2s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>{d.device}</strong>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 11,
                    background: `${STATUS_COLORS[d.status]}22`,
                    color: STATUS_COLORS[d.status],
                    fontWeight: 600,
                  }}
                >
                  {STATUS_LABELS[d.status]}
                </span>
              </div>
              {d.baseline && (
                <div style={{ fontSize: 11, color: "var(--fg-2, #aaa)" }}>
                  <div>Baseline: {ago(d.baseline.setAt)}</div>
                  {d.baseline.label && <div>Label: {d.baseline.label}</div>}
                </div>
              )}
              {d.status === "no-baseline" && (
                <button
                  className="btn btn--xs"
                  style={{ marginTop: 8 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSetBaseline(d.device);
                  }}
                >
                  Set Baseline
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Set baseline form */}
      {showSetBaseline && (
        <div className="panel reveal" style={{ marginTop: 16 }}>
          <div className="sheet__hd" style={{ padding: "8px 16px" }}>
            <span>
              Set baseline for <strong>{showSetBaseline}</strong>
            </span>
            <button className="btn btn--xs" onClick={() => setShowSetBaseline(null)}>
              Cancel
            </button>
          </div>
          <SetBaselineForm
            device={showSetBaseline}
            onDone={() => {
              setShowSetBaseline(null);
              void load();
            }}
          />
        </div>
      )}

      {/* Device detail panel */}
      {selectedDevice && (
        <DeviceDetail
          device={selectedDevice}
          onClose={() => setSelectedDevice(null)}
          onChanged={() => {
            setSelectedDevice(null);
            void load();
          }}
        />
      )}

      {/* Baseline manager table */}
      {baselines.length > 0 && (
        <div className="panel reveal" style={{ marginTop: 16 }}>
          <div className="sheet__hd">
            <h3 style={{ margin: 0 }}>Baseline Manager</h3>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Snapshot ID</th>
                  <th>Set At</th>
                  <th>Set By</th>
                  <th>Label</th>
                  <th>Size</th>
                  <th>SHA</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {baselines.map((b) => (
                  <tr key={b.device}>
                    <td>
                      <strong>{b.device}</strong>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{b.snapshotId}</td>
                    <td title={clock(b.setAt)}>{ago(b.setAt)}</td>
                    <td>{b.setBy}</td>
                    <td>{b.label ?? "—"}</td>
                    <td>
                      {b.snapshot
                        ? `${b.snapshot.lines} lines / ${b.snapshot.bytes} bytes`
                        : "deleted"}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 10 }}>
                      {b.snapshot?.sha?.slice(0, 8) ?? "—"}
                    </td>
                    <td>
                      <button
                        className="btn btn--xs btn--danger"
                        onClick={() => {
                          void deleteJson(
                            `/api/drift/baseline/${encodeURIComponent(b.device)}`,
                            {},
                          ).then(() => void load());
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {devices.length === 0 && !error && (
        <div className="panel reveal" style={{ padding: 24, textAlign: "center" }}>
          <p className="muted">No devices configured. Add devices to start using Drift Guard.</p>
        </div>
      )}
    </>
  );
}
