import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, postJson } from "./api";
import { Panel } from "./atoms";
import { bytes } from "./format";

// ── S3 backup management view ────────────────────────────────────────────────
interface S3Object {
  key: string;
  size: number;
  lastModified: string | null;
}
interface S3List {
  configured: boolean;
  target?: string;
  objects: S3Object[];
  truncated?: boolean;
}

/** List, download (presigned) and delete objects in the configured S3 bucket. */
export function S3Manage(): ReactNode {
  const [data, setData] = useState<S3List | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<S3List>("/api/s3/list")
      .then(setData)
      .catch(() => setData({ configured: false, objects: [] }));
  }, []);
  useEffect(() => load(), [load]);

  const download = (key: string): void => {
    void api<{ url?: string }>(`/api/s3/presign?key=${encodeURIComponent(key)}`)
      .then((r) => {
        if (r.url) window.open(r.url, "_blank", "noopener");
        else setMsg("could not generate download link");
      })
      .catch(() => setMsg("could not generate download link"));
  };
  const del = async (key: string): Promise<void> => {
    setBusy(key);
    const r = await postJson<{ ok?: boolean; error?: string }>("/api/s3/delete", { key }).catch(
      (): { ok?: boolean; error?: string } => ({ error: "request failed" }),
    );
    setBusy(null);
    setConfirm(null);
    if (r.ok) {
      setMsg(`Deleted ${key}`);
      load();
    } else {
      setMsg(r.error ?? "delete failed");
    }
  };

  if (!data) return <div className="muted">loading S3 objects…</div>;
  if (!data.configured) {
    return (
      <div className="feed-empty">
        <div className="feed-empty__icon">☁️</div>
        <p className="feed-empty__title">S3 is not configured</p>
        <p className="feed-empty__sub">
          Add an <code>s3</code> block (bucket + credentials) to your config to manage backup
          objects here.
        </p>
      </div>
    );
  }

  return (
    <section className="view">
      <Panel
        title="S3 backups"
        className="reveal"
        extra={
          <>
            <span className="muted">
              {data.target} · {data.objects.length} object{data.objects.length === 1 ? "" : "s"}
              {data.truncated ? " (truncated)" : ""}
            </span>
            <button className="btn" onClick={load} style={{ marginLeft: 10 }}>
              ↻ Refresh
            </button>
          </>
        }
      >
        {msg && <div className="cfg-msg">{msg}</div>}
        {data.objects.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>
            No objects in the bucket. Upload one with the <code>upload_backup_to_s3</code> tool.
          </div>
        ) : (
          <div className="feedwrap">
            <table className="feed">
              <thead>
                <tr>
                  <th>key</th>
                  <th className="num">size</th>
                  <th>modified</th>
                  <th style={{ width: 200 }}>actions</th>
                </tr>
              </thead>
              <tbody>
                {data.objects.map((o) => (
                  <tr key={o.key}>
                    <td>{o.key}</td>
                    <td className="num">{bytes(o.size)}</td>
                    <td>
                      {o.lastModified
                        ? new Date(o.lastModified).toLocaleString(undefined, { hour12: false })
                        : "—"}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn" onClick={() => download(o.key)}>
                        ⤓ Download
                      </button>{" "}
                      {confirm === o.key ? (
                        <>
                          <button
                            className="btn btn-danger"
                            disabled={busy === o.key}
                            onClick={() => void del(o.key)}
                          >
                            ✓ Confirm
                          </button>{" "}
                          <button className="btn" onClick={() => setConfirm(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button className="btn" onClick={() => setConfirm(o.key)}>
                          🗑 Delete
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
    </section>
  );
}
