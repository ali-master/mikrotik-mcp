import type { ReactNode } from "react";
import type { DeviceInfo, SSHPoolPayload } from "./types";

// ── helpers ─────────────────────────────────────────────────────────────────

function ms(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

function poolColor(d: DeviceInfo["pool"]): string {
  if (!d || !d.pooled) return "#52525b"; // disconnected – zinc-600
  if (d.dead) return "#ef4444"; // dead – red-500
  if (d.inflight > 0) return "#3b82f6"; // busy – blue-500
  return "#22c55e"; // idle/ready – green-500
}

function poolLabel(d: DeviceInfo["pool"]): string {
  if (!d || !d.pooled) return "no connection";
  if (d.dead) return "reconnecting";
  if (d.inflight > 0) return `${d.inflight} inflight`;
  return "ready";
}

// ── per-device pipe card ────────────────────────────────────────────────────

function PoolDeviceCard({ device }: { device: DeviceInfo }): ReactNode {
  const p = device.pool;
  const variant =
    !p || !p.pooled ? "disconnected" : p.dead ? "dead" : p.inflight > 0 ? "busy" : "idle";
  const col = poolColor(p);
  // Fill width proportional to inflight: 0→8%, each channel adds ~15%, cap 100%.
  const fillPct = !p || !p.pooled ? 0 : p.inflight > 0 ? Math.min(8 + p.inflight * 15, 100) : 100;
  return (
    <div className={`pool-card pool-card--${variant}`}>
      <div className="pool-card__hd">
        <span className="pool-card__dot" style={{ background: col }} />
        <span className="pool-card__name">{device.name}</span>
        <span className="pool-card__badge" style={{ color: col }}>
          {poolLabel(p)}
        </span>
      </div>
      <div className="pool-pipe">
        <div
          className={`pool-pipe__fill${variant === "busy" ? " pool-pipe__fill--pulse" : ""}`}
          style={{ width: `${fillPct}%`, background: col }}
        />
        {p && p.pooled && p.inflight > 0 && (
          <span className="pool-pipe__label">{p.inflight} ch</span>
        )}
      </div>
    </div>
  );
}

// ── aggregate stat cards ────────────────────────────────────────────────────

function PoolStat({ k, v, sub }: { k: string; v: string; sub?: string }): ReactNode {
  return (
    <div className="stat" style={{ minWidth: 100 }}>
      <p className="k">{k}</p>
      <div className="v">
        {v}
        {sub != null && <small> {sub}</small>}
      </div>
    </div>
  );
}

// ── main panel ──────────────────────────────────────────────────────────────

export function SSHPoolPanel({
  devices,
  poolPayload,
}: {
  devices: DeviceInfo[];
  poolPayload?: SSHPoolPayload | null;
}): ReactNode {
  // Only show SSH devices that have pool info
  const sshDevices = devices.filter((d) => d.pool !== null && d.pool !== undefined);
  const poolEnabled = poolPayload?.enabled ?? sshDevices.length > 0;

  if (!poolEnabled && sshDevices.length === 0) {
    return (
      <details className="pool-panel" open>
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>
          SSH Connection Pool
        </summary>
        <p className="pool-disabled">
          Connection pooling is disabled. Enable it with <code>--ssh-keep-alive true</code> or{" "}
          <code>MIKROTIK_SSH__KEEP_ALIVE=true</code> to keep persistent SSH connections across tool
          calls.
        </p>
      </details>
    );
  }

  const agg = poolPayload?.aggregate;
  const cfg = poolPayload?.config;

  return (
    <details className="pool-panel" open>
      <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>
        SSH Connection Pool
      </summary>

      {/* aggregate stats row */}
      {agg && (
        <div className="pool-stats">
          <PoolStat k="Connections" v={String(agg.totalConnections)} />
          <PoolStat k="Inflight" v={String(agg.totalInflight)} sub="channels" />
          <PoolStat k="Idle" v={String(agg.totalIdle)} />
          <PoolStat k="Busy" v={String(agg.totalBusy)} />
          {cfg && (
            <>
              <PoolStat k="Keepalive" v={ms(cfg.keepAliveInterval)} />
              <PoolStat k="Idle timeout" v={ms(cfg.idleTimeout)} />
            </>
          )}
        </div>
      )}

      {/* per-device pipe grid */}
      {sshDevices.length > 0 && (
        <div className="pool-grid">
          {sshDevices.map((d) => (
            <PoolDeviceCard key={d.name} device={d} />
          ))}
        </div>
      )}
    </details>
  );
}
