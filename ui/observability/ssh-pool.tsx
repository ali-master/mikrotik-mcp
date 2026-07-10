import type { ReactNode } from "react";
import { StatCard } from "./atoms";
import { cn } from "@/lib/utils";
import type { DeviceInfo, SSHPoolPayload } from "./types";

// ── helpers ─────────────────────────────────────────────────────────────────

function ms(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

function poolColor(d: DeviceInfo["pool"]): string {
  if (!d || !d.pooled) return "var(--muted-foreground)"; // disconnected
  if (d.dead) return "var(--destructive)"; // dead
  if (d.inflight > 0) return "var(--chart-1)"; // busy
  return "var(--success)"; // idle/ready
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
  const variantCls =
    !p || !p.pooled
      ? "border-dashed opacity-60"
      : p.dead
        ? "border-destructive/50"
        : p.inflight > 0
          ? "border-chart-1/50"
          : "border-success/35";
  const busy = !!p && p.pooled && p.inflight > 0;
  const col = poolColor(p);
  // Fill width proportional to inflight: 0→8%, each channel adds ~15%, cap 100%.
  const fillPct = !p || !p.pooled ? 0 : p.inflight > 0 ? Math.min(8 + p.inflight * 15, 100) : 100;
  return (
    <div
      className={cn(
        "bg-card rounded-lg border px-3 py-2.5 transition-colors hover:border-muted-foreground/40",
        variantCls,
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="size-[7px] shrink-0 rounded-full" style={{ background: col }} />
        <span className="text-foreground overflow-hidden text-xs font-semibold text-ellipsis whitespace-nowrap">
          {device.name}
        </span>
        <span
          className="ml-auto text-[10px] font-semibold tracking-[0.04em] uppercase"
          style={{ color: col }}
        >
          {poolLabel(p)}
        </span>
      </div>
      <div className="bg-muted relative h-1.5 overflow-hidden rounded-[3px]">
        <div
          className={cn(
            "h-full rounded-[3px] opacity-65 transition-[width] duration-[400ms]",
            busy && "animate-pulse",
          )}
          style={{ width: `${fillPct}%`, background: col }}
        />
        {p && p.pooled && p.inflight > 0 && (
          <span className="text-foreground absolute -top-px right-1 text-[8px] leading-[8px] font-bold [text-shadow:0_0_3px_rgba(0,0,0,0.6)]">
            {p.inflight} ch
          </span>
        )}
      </div>
    </div>
  );
}

// ── aggregate stat cards ────────────────────────────────────────────────────

function PoolStat({ k, v, sub }: { k: string; v: string; sub?: string }): ReactNode {
  return <StatCard k={k} v={v} sub={sub} cls="min-w-[100px]" />;
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
      <details className="my-3" open>
        <summary className="mb-2 cursor-pointer font-semibold">SSH Connection Pool</summary>
        <p className="text-muted-foreground my-1 text-[13px]">
          Connection pooling is disabled. Enable it with{" "}
          <code className="text-chart-1 text-xs">--ssh-keep-alive true</code> or{" "}
          <code className="text-chart-1 text-xs">MIKROTIK_SSH__KEEP_ALIVE=true</code> to keep
          persistent SSH connections across tool calls.
        </p>
      </details>
    );
  }

  const agg = poolPayload?.aggregate;
  const cfg = poolPayload?.config;

  return (
    <details className="my-3" open>
      <summary className="mb-2 cursor-pointer font-semibold">SSH Connection Pool</summary>

      {/* aggregate stats row */}
      {agg && (
        <div className="mb-3 flex flex-wrap gap-2">
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          {sshDevices.map((d) => (
            <PoolDeviceCard key={d.name} device={d} />
          ))}
        </div>
      )}
    </details>
  );
}
