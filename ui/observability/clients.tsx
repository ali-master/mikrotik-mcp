/**
 * Clients view — the LAN devices connected to a router (not the routers
 * themselves, which live on the Devices page).
 *
 * Talks to the dashboard's `/api/clients*` routes, which call the very same
 * RouterOS operations the connected-device MCP tools wrap — so a block/allow/
 * pin from this page and from chat run identical commands. Traffic rates are
 * computed from cumulative byte deltas (not the unreliable instantaneous `rate`
 * field) and displayed inline in each row with a mini sparkline, polled every
 * 1 second. Mutations return a refreshed device `view` so the table updates
 * without a second request.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, postJson } from "./api";
import { Panel } from "./atoms";
import { bytes } from "./format";
import { Badge, Button, Input, Note, Select } from "./geist";
import type { DevicesPayload } from "./types";
import { UsageHistoryChart } from "./usage-charts";

interface Device {
  mac: string;
  ip: string;
  host: string;
  iface: string;
  server: string;
  status: string;
  static: boolean;
  blocked: boolean;
  lastSeen: string;
  comment: string;
}
interface DevicesView {
  __mikrotikView: "connected-devices";
  devices: Device[];
  counts: { total: number; blocked: number; static: number };
  generatedAt: string;
}
interface BulkTrafficSample {
  ts: number;
  queues: Record<
    string,
    { txBytes: number; rxBytes: number; downloadLimit: string; uploadLimit: string }
  >;
}
interface OpResult {
  ok: boolean;
  message: string;
  view?: DevicesView;
}

/** Per-IP computed traffic state (delta rates + sparkline history). */
interface IpTraffic {
  rxRate: number; // bits/sec
  txRate: number;
  rxBytes: number;
  txBytes: number;
  downloadLimit: string;
  uploadLimit: string;
  history: { rx: number; tx: number }[];
}

const MAX_SAMPLES = 40;
const MINI_SAMPLES = 30;
const BULK_POLL_MS = 1000;
const SVG_NS = "http://www.w3.org/2000/svg";

const mbps = (bits: number): string => `${(bits / 1e6).toFixed(2)} Mbps`;
const compact = (bits: number): string => {
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)}M`;
  if (bits >= 1e3) return `${(bits / 1e3).toFixed(0)}k`;
  return bits > 0 ? `${Math.round(bits)}` : "0";
};

// ── Charts ──────────────────────────────────────────────────────────────────

/** A live Download (green ↓) / Upload (amber ↑) area chart, hand-rolled in SVG. */
function TrafficChart({ history }: { history: { rx: number; tx: number }[] }): ReactNode {
  const W = 520;
  const H = 150;
  const pad = 8;
  const max = Math.max(1, ...history.flatMap((p) => [p.rx, p.tx]));
  const x = (i: number): number => pad + (i * (W - 2 * pad)) / Math.max(1, MAX_SAMPLES - 1);
  const y = (v: number): number => H - pad - (v / max) * (H - 2 * pad);

  const path = (pick: (p: { rx: number; tx: number }) => number): string =>
    history.map((p, i) => `${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");
  const area = (pick: (p: { rx: number; tx: number }) => number): string => {
    if (history.length < 2) return "";
    const first = x(0).toFixed(1);
    const last = x(history.length - 1).toFixed(1);
    return `${first},${(H - pad).toFixed(1)} ${path(pick)} ${last},${(H - pad).toFixed(1)}`;
  };

  return (
    <svg className="clients-chart" viewBox={`0 0 ${W} ${H}`} xmlns={SVG_NS} role="img">
      {history.length >= 2 && (
        <>
          <polygon className="rx area" points={area((p) => p.rx)} />
          <polygon className="tx area" points={area((p) => p.tx)} />
          <polyline className="rx line" points={path((p) => p.rx)} />
          <polyline className="tx line" points={path((p) => p.tx)} />
        </>
      )}
    </svg>
  );
}

/** Tiny inline sparkline (rx + tx stacked areas) for a client row. */
function MiniSparkline({ history }: { history: { rx: number; tx: number }[] }): ReactNode {
  const W = 80;
  const H = 18;
  const pad = 1;
  if (history.length < 2) return <svg className="mini-spark" viewBox={`0 0 ${W} ${H}`} />;
  const max = Math.max(1, ...history.flatMap((p) => [p.rx, p.tx]));
  const x = (i: number): number => pad + (i * (W - 2 * pad)) / Math.max(1, MINI_SAMPLES - 1);
  const y = (v: number): number => H - pad - (v / max) * (H - 2 * pad);
  const pts = (pick: (p: { rx: number; tx: number }) => number): string =>
    history.map((p, i) => `${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");
  const filled = (pick: (p: { rx: number; tx: number }) => number): string => {
    const first = x(0).toFixed(1);
    const last = x(history.length - 1).toFixed(1);
    const base = (H - pad).toFixed(1);
    return `${first},${base} ${pts(pick)} ${last},${base}`;
  };
  return (
    <svg className="mini-spark" viewBox={`0 0 ${W} ${H}`} xmlns={SVG_NS}>
      <polygon className="rx area" points={filled((p) => p.rx)} />
      <polygon className="tx area" points={filled((p) => p.tx)} />
      <polyline className="rx line" points={pts((p) => p.rx)} />
      <polyline className="tx line" points={pts((p) => p.tx)} />
    </svg>
  );
}

// ── Limits editor ───────────────────────────────────────────────────────────

/** Set/clear a device's download & upload rate limits (a `/queue simple`). */
function LimitsEditor({
  ip,
  deviceName,
  current,
  onSaved,
}: {
  ip: string;
  deviceName: string;
  current: { download: string; upload: string };
  onSaved: () => void;
}): ReactNode {
  const [dl, setDl] = useState(current.download);
  const [ul, setUl] = useState(current.upload);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Adopt the live (fetched) limits until the user starts editing.
  useEffect(() => {
    if (!dirty) {
      setDl(current.download);
      setUl(current.upload);
    }
  }, [current.download, current.upload, dirty]);

  const apply = useCallback(
    async (download: string, upload: string): Promise<void> => {
      setBusy(true);
      setMsg(null);
      try {
        const r = await postJson<OpResult>("/api/clients/limits", {
          ip,
          device: deviceName,
          download,
          upload,
        });
        setMsg(r.message);
        if (r.ok) {
          setDirty(false);
          onSaved();
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [ip, deviceName, onSaved],
  );

  const hasLimit = Boolean(current.download || current.upload);
  return (
    <div className="clients-limits">
      <div className="clients-limits__hd">
        <span className="clients-limits__label">Rate limits</span>
        <span className="muted">
          current: ↓ {current.download || "unlimited"} · ↑ {current.upload || "unlimited"}
        </span>
      </div>
      <div className="clients-limits__row">
        <label className="clients-limits__field">
          <span className="muted">↓ Download</span>
          <Input
            placeholder="10M · blank = unlimited"
            value={dl}
            onChange={(e) => {
              setDirty(true);
              setDl(e.target.value);
            }}
          />
        </label>
        <label className="clients-limits__field">
          <span className="muted">↑ Upload</span>
          <Input
            placeholder="2M · blank = unlimited"
            value={ul}
            onChange={(e) => {
              setDirty(true);
              setUl(e.target.value);
            }}
          />
        </label>
        <Button size="sm" type="accent" loading={busy} onClick={() => void apply(dl, ul)}>
          Apply
        </Button>
        <Button
          size="sm"
          ghost
          disabled={busy || !hasLimit}
          onClick={() => {
            setDl("");
            setUl("");
            void apply("", "");
          }}
        >
          Remove
        </Button>
      </div>
      {msg && <div className="muted clients-limits__msg">{msg}</div>}
    </div>
  );
}

// ── Detail panel (selected device) ──────────────────────────────────────────

/** Detail panel for the selected device: live ↓/↑ rates, chart, totals, limits. */
function DeviceDetail({
  device,
  deviceName,
  traffic,
}: {
  device: Device;
  deviceName: string;
  traffic: IpTraffic | undefined;
}): ReactNode {
  const hasQueue = traffic !== undefined;
  return (
    <div className="clients-detail">
      <div className="clients-detail__hd">
        <span className="clients-detail__title">{device.host || device.comment || device.ip}</span>
        <span className="muted">
          {device.ip || "no IP"} · {device.mac} · {device.iface || "?"} · {device.status}
        </span>
      </div>
      {!hasQueue ? (
        <Note type="secondary" label="No per-device counter">
          Set a rate limit below to start tracking this device's Download/Upload (it creates a
          simple queue targeting <code>{device.ip}</code>), or leave it unlimited.
        </Note>
      ) : (
        <>
          <div className="clients-rates">
            <span className="rate rx">↓ {mbps(traffic.rxRate)}</span>
            <span className="rate tx">↑ {mbps(traffic.txRate)}</span>
          </div>
          <TrafficChart history={traffic.history} />
          <div className="muted clients-totals">
            total ↓ {bytes(traffic.rxBytes)} · ↑ {bytes(traffic.txBytes)}
          </div>
        </>
      )}
      {device.ip && (
        <LimitsEditor
          ip={device.ip}
          deviceName={deviceName}
          current={{
            download: traffic?.downloadLimit ?? "",
            upload: traffic?.uploadLimit ?? "",
          }}
          onSaved={() => {}}
        />
      )}
      {device.ip && (
        <div className="clients-history">
          <div className="clients-history__hd">Usage history · last 3 months</div>
          <UsageHistoryChart
            endpoint={`/api/usage/client?ip=${encodeURIComponent(device.ip)}${
              deviceName ? `&device=${encodeURIComponent(deviceName)}` : ""
            }&days=90`}
            days={90}
          />
        </div>
      )}
    </div>
  );
}

// ── Bulk traffic hook ───────────────────────────────────────────────────────

/** Polls /api/clients/traffic-bulk every 1s and computes delta-rates per IP. */
function useBulkTraffic(deviceName: string): Map<string, IpTraffic> {
  const [trafficMap, setTrafficMap] = useState<Map<string, IpTraffic>>(new Map());
  const prevRef = useRef<{ ts: number; queues: BulkTrafficSample["queues"] } | null>(null);

  useEffect(() => {
    prevRef.current = null;
    setTrafficMap(new Map());
  }, [deviceName]);

  useEffect(() => {
    if (!deviceName) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const q = deviceName ? `?device=${encodeURIComponent(deviceName)}` : "";
        const sample = await api<BulkTrafficSample>(`/api/clients/traffic-bulk${q}`);
        if (cancelled) return;
        const prev = prevRef.current;
        prevRef.current = { ts: sample.ts, queues: sample.queues };
        if (!prev) return; // need two samples for deltas

        const dtSec = Math.max(0.1, (sample.ts - prev.ts) / 1000);
        setTrafficMap((old) => {
          const next = new Map<string, IpTraffic>();
          for (const [ip, cur] of Object.entries(sample.queues)) {
            const p = prev.queues[ip];
            const existing = old.get(ip);
            // Compute byte deltas → bits/sec (× 8). Guard against counter reset.
            const dRx = p ? Math.max(0, cur.rxBytes - p.rxBytes) : 0;
            const dTx = p ? Math.max(0, cur.txBytes - p.txBytes) : 0;
            const rxRate = (dRx / dtSec) * 8;
            const txRate = (dTx / dtSec) * 8;
            const history = [...(existing?.history ?? []), { rx: rxRate, tx: txRate }].slice(
              -MINI_SAMPLES,
            );
            next.set(ip, {
              rxRate,
              txRate,
              rxBytes: cur.rxBytes,
              txBytes: cur.txBytes,
              downloadLimit: cur.downloadLimit,
              uploadLimit: cur.uploadLimit,
              history,
            });
          }
          return next;
        });
      } catch {
        /* transient poll error */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), BULK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [deviceName]);

  return trafficMap;
}

// ── Main view ───────────────────────────────────────────────────────────────

/** Connected LAN devices for one router: usage charts, block/allow, pin/relabel IP. */
export function ClientsView(): ReactNode {
  const [routers, setRouters] = useState<DevicesPayload | null>(null);
  const [deviceName, setDeviceName] = useState<string>("");
  const [view, setView] = useState<DevicesView | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // MAC
  const [busy, setBusy] = useState<string | null>(null); // MAC currently mutating
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Inline editor for "Set IP" / "Label" (no native prompt — see no-alert lint).
  const [edit, setEdit] = useState<{ mac: string; field: "ip" | "label"; value: string } | null>(
    null,
  );

  // Bulk traffic: polls every 1s, returns computed delta-rates per IP.
  const trafficMap = useBulkTraffic(deviceName);

  // Discover the configured routers so the user can pick which one to inspect.
  useEffect(() => {
    void api<DevicesPayload>("/api/devices")
      .then((r) => {
        setRouters(r);
        setDeviceName((cur) => cur || r.defaultDevice || r.devices[0]?.name || "");
      })
      .catch(() => setRouters({ server: "", defaultDevice: "", devices: [] }));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const q = deviceName ? `?device=${encodeURIComponent(deviceName)}` : "";
      setView(await api<DevicesView>(`/api/clients${q}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [deviceName]);

  // Load on device change, then refresh the list lightly (status can change).
  useEffect(() => {
    setView(null);
    setSelected(null);
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const act = useCallback(
    async (path: string, mac: string, extra?: Record<string, unknown>): Promise<void> => {
      setBusy(mac);
      setError(null);
      try {
        const r = await postJson<OpResult>(`/api/clients/${path}`, {
          mac,
          device: deviceName,
          ...extra,
        });
        if (r.view) setView(r.view);
        else await load();
        if (!r.ok) setError(r.message);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [deviceName, load],
  );

  const openEdit = useCallback((d: Device, field: "ip" | "label"): void => {
    setSelected(d.mac);
    setEdit({ mac: d.mac, field, value: field === "ip" ? d.ip : d.comment || d.host });
  }, []);
  const saveEdit = useCallback(async (): Promise<void> => {
    if (!edit) return;
    const v = edit.value.trim();
    if (edit.field === "ip") {
      if (v) await act("set-ip", edit.mac, { ip: v });
    } else {
      await act("label", edit.mac, { label: v });
    }
    setEdit(null);
  }, [edit, act]);

  const shown = useMemo(() => {
    const list = view?.devices ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (d) =>
        d.ip.toLowerCase().includes(q) ||
        d.mac.toLowerCase().includes(q) ||
        d.host.toLowerCase().includes(q) ||
        d.comment.toLowerCase().includes(q),
    );
  }, [view, filter]);

  const selectedDevice = useMemo(
    () => view?.devices.find((d) => d.mac === selected) ?? null,
    [view, selected],
  );

  const routerOptions = routers?.devices ?? [];
  const counts = view?.counts;

  return (
    <section className="view">
      <Panel
        title="Connected clients"
        className="reveal"
        extra={
          <div className="clients-toolbar">
            {routerOptions.length > 1 && (
              <Select
                value={deviceName}
                onValueChange={setDeviceName}
                aria-label="Router"
                options={routerOptions.map((d) => ({
                  value: d.name,
                  label: `${d.name}${d.isDefault ? " (default)" : ""}`,
                }))}
              />
            )}
            <input
              className="geist-input"
              placeholder="Filter IP / MAC / name…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <Button size="sm" ghost onClick={() => void load()}>
              ↻ Refresh
            </Button>
          </div>
        }
      >
        {counts && (
          <div className="clients-counts muted">
            {counts.total} total · {counts.static} static · {counts.blocked} blocked
          </div>
        )}

        {error && (
          <Note type="error" className="clients-error">
            {error}
          </Note>
        )}

        {!view ? (
          <div className="muted">loading connected devices…</div>
        ) : shown.length === 0 ? (
          <div className="feed-empty">
            <div className="feed-empty__icon">📡</div>
            <p className="feed-empty__title">No connected devices</p>
            <p className="feed-empty__sub">
              Nothing in this router's DHCP-lease or ARP table{filter ? " matches the filter" : ""}.
            </p>
          </div>
        ) : (
          <div className="clients-table">
            <div className="clients-row clients-row--head">
              <span>IP</span>
              <span>Name</span>
              <span>MAC</span>
              <span>Iface</span>
              <span>Status</span>
              <span>Traffic</span>
              <span className="clients-actions-h">Actions</span>
            </div>
            {shown.map((d) => {
              const isSel = d.mac === selected;
              const isBusy = busy === d.mac;
              const t = d.ip ? trafficMap.get(d.ip) : undefined;
              return (
                <div
                  key={d.mac}
                  className={[
                    "clients-row",
                    isSel ? "is-selected" : "",
                    d.blocked ? "is-blocked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setSelected(isSel ? null : d.mac)}
                >
                  <span className="clients-ip">{d.ip || "\u2014"}</span>
                  <span className="clients-name">{d.host || d.comment || "(unknown)"}</span>
                  <span className="clients-mac">{d.mac}</span>
                  <span className="muted">{d.iface || ""}</span>
                  <span className="clients-badges">
                    {d.static && <Badge type="secondary">static</Badge>}
                    {d.blocked ? (
                      <Badge type="error">blocked</Badge>
                    ) : (
                      <span className="muted">{d.status}</span>
                    )}
                  </span>
                  <span className="clients-traffic">
                    {t ? (
                      <>
                        <span className="clients-traffic__rates">
                          <span className="rx">↓{compact(t.rxRate)}</span>
                          <span className="tx">↑{compact(t.txRate)}</span>
                        </span>
                        <MiniSparkline history={t.history} />
                      </>
                    ) : (
                      <span className="muted">{d.ip ? "\u2014" : ""}</span>
                    )}
                  </span>
                  <span
                    className="clients-actions"
                    onClick={(e) => e.stopPropagation()}
                    role="presentation"
                  >
                    {d.blocked ? (
                      <Button
                        size="sm"
                        type="success"
                        ghost
                        loading={isBusy}
                        onClick={() => void act("allow", d.mac)}
                      >
                        Allow
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        type="error"
                        ghost
                        loading={isBusy}
                        onClick={() => void act("block", d.mac)}
                      >
                        Block
                      </Button>
                    )}
                    {!d.static && (
                      <Button
                        size="sm"
                        ghost
                        loading={isBusy}
                        onClick={() => void act("pin", d.mac)}
                      >
                        Pin IP
                      </Button>
                    )}
                    <Button size="sm" ghost disabled={isBusy} onClick={() => openEdit(d, "ip")}>
                      Set IP
                    </Button>
                    <Button size="sm" ghost disabled={isBusy} onClick={() => openEdit(d, "label")}>
                      Label
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {edit && selectedDevice?.mac === edit.mac && (
          <div className="clients-edit">
            <span className="clients-edit__label">
              {edit.field === "ip" ? "Reserve IP for" : "Label for"}{" "}
              <b>{selectedDevice.host || selectedDevice.mac}</b>:
            </span>
            <Input
              autoFocus
              value={edit.value}
              placeholder={edit.field === "ip" ? "e.g. 192.168.88.50" : "e.g. Ali phone"}
              onChange={(e) => setEdit({ ...edit, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveEdit();
                if (e.key === "Escape") setEdit(null);
              }}
            />
            <Button
              size="sm"
              type="accent"
              loading={busy === edit.mac}
              onClick={() => void saveEdit()}
            >
              Save
            </Button>
            <Button size="sm" ghost onClick={() => setEdit(null)}>
              Cancel
            </Button>
          </div>
        )}

        {selectedDevice && (
          <DeviceDetail
            device={selectedDevice}
            deviceName={deviceName}
            traffic={selectedDevice.ip ? trafficMap.get(selectedDevice.ip) : undefined}
          />
        )}
      </Panel>
    </section>
  );
}
