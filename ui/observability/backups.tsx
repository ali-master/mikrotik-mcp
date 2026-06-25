import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, postJson, withToken } from "./api";
import { Panel } from "./atoms";
import { bytes } from "./format";
import { Button } from "./geist";

// ── Local backup vault view ──────────────────────────────────────────────────
interface BackupItem {
  name: string;
  bytes: number;
  modified: number;
  device?: string;
}
interface BackupsData {
  dir: string;
  devices: string[];
  backups: BackupItem[];
}

/** Manage the host-side backup vault: create, download, upload, rename, restore, delete. */
export function BackupsView(): ReactNode {
  const [data, setData] = useState<BackupsData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [restoreName, setRestoreName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null);
  const [device, setDevice] = useState("");
  const [body, setBody] = useState<{ name: string; content: string } | null>(null);
  const [dirEdit, setDirEdit] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    void api<BackupsData>("/api/backups")
      .then((d) => {
        setData(d);
        setDevice((cur) => cur || d.devices[0] || "");
      })
      .catch(() => setData({ dir: "", devices: [], backups: [] }));
  }, []);
  useEffect(() => load(), [load]);

  type R = { ok?: boolean; error?: string; name?: string };
  const post = (path: string, b: unknown): Promise<R> =>
    postJson<R>(path, b).catch((): R => ({ error: "request failed" }));

  const create = async (): Promise<void> => {
    setBusy(true);
    setMsg("Capturing /export…");
    const r = await postJson<{ ok?: boolean; name?: string; bytes?: number; error?: string }>(
      "/api/backups/create",
      { device: device || undefined },
    ).catch((): { ok?: boolean; name?: string; bytes?: number; error?: string } => ({
      error: "request failed",
    }));
    setBusy(false);
    setMsg(r.ok ? `Created ${r.name} (${r.bytes} bytes)` : `Create failed: ${r.error}`);
    if (r.ok) load();
  };
  const upload = async (file: File): Promise<void> => {
    const content = await file.text();
    const r = await post("/api/backups/upload", { name: file.name, content });
    setMsg(r.ok ? `Uploaded ${r.name}` : `Upload failed: ${r.error}`);
    if (r.ok) load();
  };
  const del = async (name: string): Promise<void> => {
    setConfirmDel(null);
    const r = await post("/api/backups/delete", { name });
    setMsg(r.ok ? `Deleted ${name}` : `Delete failed: ${r.error}`);
    if (r.ok) load();
  };
  const rename = async (): Promise<void> => {
    if (!renaming) return;
    const { name, value } = renaming;
    setRenaming(null);
    if (!value || value === name) return;
    const r = await post("/api/backups/rename", { name, new_name: value });
    setMsg(r.ok ? `Renamed to ${r.name}` : `Rename failed: ${r.error}`);
    if (r.ok) load();
  };
  const restore = async (confirm: boolean): Promise<void> => {
    if (!restoreName) return;
    setBusy(true);
    setMsg(confirm ? "Restoring in Safe Mode…" : "Dry-run restore in Safe Mode…");
    const r = await postJson<{
      ok?: boolean;
      committed?: boolean;
      applied?: number;
      message?: string;
    }>("/api/backups/restore", { name: restoreName, device: device || undefined, confirm }).catch(
      (): { ok?: boolean; committed?: boolean; applied?: number; message?: string } => ({
        ok: false,
        message: "request failed",
      }),
    );
    setBusy(false);
    setMsg(
      r.ok
        ? r.committed
          ? `Restored ${restoreName} → ${device}: ${r.message}`
          : `Dry-run OK (${r.applied} cmds, rolled back). Click “Restore (commit)” to apply for real.`
        : `Restore failed: ${r.message}`,
    );
    if (r.ok && confirm) setRestoreName(null);
  };
  const viewBody = (name: string): void => {
    void api<{ name: string; content: string }>(`/api/backups/get?name=${encodeURIComponent(name)}`)
      .then(setBody)
      .catch(() => {});
  };
  const saveDir = async (): Promise<void> => {
    if (dirEdit === null) return;
    const dir = dirEdit.trim();
    if (!dir || dir === data?.dir) {
      setDirEdit(null);
      return;
    }
    setBusy(true);
    type DirResp = {
      ok?: boolean;
      dir?: string;
      persisted?: boolean;
      warning?: string;
      error?: string;
    };
    const r = await postJson<DirResp>("/api/backups/dir", { dir }).catch(
      (): DirResp => ({ error: "request failed" }),
    );
    setBusy(false);
    setDirEdit(null);
    if (r.ok)
      setMsg(
        r.persisted ? `Backup path saved → ${r.dir}` : (r.warning ?? `Path applied → ${r.dir}`),
      );
    else setMsg(`Path change failed: ${r.error}`);
    if (r.ok) load();
  };

  if (!data) return <div className="muted">loading backups…</div>;

  return (
    <section className="view">
      <Panel
        title="Local backup vault"
        className="reveal"
        extra={
          dirEdit === null ? (
            <span className="muted backup-path">
              <span title={data.dir}>{data.dir}</span>
              <button
                className="linkish"
                title="Change backup directory"
                onClick={() => setDirEdit(data.dir)}
              >
                ✎ edit path
              </button>
            </span>
          ) : (
            <span className="backup-path">
              <input
                className="backup-path-input"
                value={dirEdit}
                autoFocus
                spellCheck={false}
                placeholder="~/.mikrotik-mcp/backups"
                onChange={(e) => setDirEdit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveDir();
                  if (e.key === "Escape") setDirEdit(null);
                }}
              />
              <button className="topo-btn cfg-save" onClick={() => void saveDir()} disabled={busy}>
                Save path
              </button>
              <button className="topo-btn" onClick={() => setDirEdit(null)}>
                Cancel
              </button>
            </span>
          )
        }
      >
        {msg && <div className="cfg-msg">{msg}</div>}
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <select className="btn" value={device} onChange={(e) => setDevice(e.target.value)}>
            {data.devices.length === 0 && <option value="">no devices</option>}
            {data.devices.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            className="btn is-active"
            onClick={() => void create()}
            disabled={busy || !device}
          >
            ⤓ Create backup
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            ⤒ Upload .rsc
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".rsc,text/plain"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.currentTarget.value = "";
            }}
          />
          <button className="btn" onClick={load}>
            ↻ Refresh
          </button>
        </div>

        {restoreName && (
          <div className="cfg-banner" style={{ marginBottom: 12 }}>
            <strong>Restore {restoreName}</strong> onto{" "}
            <select
              className="cfg-select"
              value={device}
              onChange={(e) => setDevice(e.target.value)}
            >
              {data.devices.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>{" "}
            via Safe Mode (auto-reverts on lock-out).
            <span style={{ flex: 1 }} />
            <button className="topo-btn" onClick={() => void restore(false)} disabled={busy}>
              Dry-run
            </button>
            <button
              className="topo-btn cfg-save"
              onClick={() => void restore(true)}
              disabled={busy}
            >
              Restore (commit)
            </button>
            <button className="topo-btn" onClick={() => setRestoreName(null)}>
              Cancel
            </button>
          </div>
        )}

        {data.backups.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>
            No backups yet. Click “Create backup” to capture this device’s config, or upload a
            `.rsc`.
          </div>
        ) : (
          <div className="feedwrap">
            <table className="feed">
              <thead>
                <tr>
                  <th>name</th>
                  <th>device</th>
                  <th className="num">size</th>
                  <th>captured</th>
                  <th style={{ width: 280 }}>actions</th>
                </tr>
              </thead>
              <tbody>
                {data.backups.map((b) => (
                  <tr key={b.name} className={body?.name === b.name ? "is-selected" : undefined}>
                    <td>{b.name}</td>
                    <td>{b.device ?? "—"}</td>
                    <td className="num">{bytes(b.bytes)}</td>
                    <td>{new Date(b.modified).toLocaleString(undefined, { hour12: false })}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn" onClick={() => viewBody(b.name)}>
                        view
                      </button>{" "}
                      <a
                        className="btn"
                        href={withToken(`/api/backups/raw?name=${encodeURIComponent(b.name)}`)}
                        download={b.name}
                      >
                        ⤓
                      </a>{" "}
                      {renaming?.name === b.name ? (
                        <>
                          <input
                            className="search"
                            style={{ display: "inline-block", width: 150 }}
                            value={renaming.value}
                            autoFocus
                            onChange={(e) => setRenaming({ name: b.name, value: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && void rename()}
                          />{" "}
                          <button className="btn cfg-save" onClick={() => void rename()}>
                            ✓
                          </button>{" "}
                          <button className="btn" onClick={() => setRenaming(null)}>
                            ✕
                          </button>{" "}
                        </>
                      ) : (
                        <>
                          <button
                            className="btn"
                            onClick={() => setRenaming({ name: b.name, value: b.name })}
                          >
                            rename
                          </button>{" "}
                          <button className="btn cfg-save" onClick={() => setRestoreName(b.name)}>
                            restore
                          </button>{" "}
                        </>
                      )}
                      {confirmDel === b.name ? (
                        <>
                          <button className="btn btn-danger" onClick={() => void del(b.name)}>
                            ✓
                          </button>{" "}
                          <button className="btn" onClick={() => setConfirmDel(null)}>
                            ✕
                          </button>
                        </>
                      ) : (
                        <button className="btn" onClick={() => setConfirmDel(b.name)}>
                          🗑
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {body && (
        <Panel
          title={`Backup · ${body.name}`}
          className="reveal"
          extra={
            <Button type="secondary" size="sm" onClick={() => setBody(null)}>
              ✕ Close
            </Button>
          }
        >
          <pre className="body" style={{ maxHeight: 460 }}>
            {body.content || "(empty)"}
          </pre>
        </Panel>
      )}
    </section>
  );
}
