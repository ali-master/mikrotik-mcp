import type { ReactNode } from "react";
import { MetricArea, RadialGauge } from "./charts";
import { statusInfo } from "./connectivity";
import { bytes, HEALTH_COLOR } from "./format";
import { Badge, Dot } from "./geist";
import type { DeviceInfo } from "./types";

// ── device system-health charts ─────────────────────────────────────────────
/** A compact line+area sparkline over a series that may contain gaps (`null`). */
const memHuman = (b?: number): string => (b == null ? "?" : bytes(b));

/** One device's realtime system-health card: gauges + sparkline charts. */
export function DeviceHealthCard({ d }: { d: DeviceInfo }): ReactNode {
  const s = d.status;
  const hist = d.history ?? [];
  const probed = s.reachable === true || hist.length > 0;
  if (!probed) {
    return (
      <div className="bg-card text-card-foreground flex min-h-[120px] flex-col justify-center gap-1.5 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <Dot color={statusInfo(s).color} />
          <span className="font-mono text-[13px] font-medium">{d.name}</span>
          {d.isDefault && <Badge type="accent">default</Badge>}
        </div>
        <p className="text-muted-foreground m-0 text-[11px]">
          {s.reachable === false
            ? `Offline — ${s.error ?? "unreachable"}`
            : d.mac
              ? "Waiting for the first MAC-Telnet probe (these run every few minutes to avoid contending with tool calls)…"
              : "Waiting for the first health probe…"}
        </p>
      </div>
    );
  }
  return (
    <div className="bg-card text-card-foreground flex flex-col gap-2.5 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Dot color={statusInfo(s).color} />
        <span className="font-mono text-[13px] font-medium">{d.name}</span>
        {d.isDefault && <Badge type="accent">default</Badge>}
        <span className="flex-1" />
        <Badge type={s.version ? "success" : "default"}>{s.version ? `v${s.version}` : "—"}</Badge>
      </div>
      <div className="text-muted-foreground -mt-1 font-mono text-[11px]">
        {s.boardName ?? "router"}
        {s.architecture ? ` · ${s.architecture}` : ""}
        {s.cpuCount ? ` · ${s.cpuCount} cpu` : ""}
        {s.uptime ? ` · up ${s.uptime}` : ""}
      </div>
      <div className="flex justify-around gap-3.5">
        <RadialGauge value={s.cpuLoad} label="CPU" color={HEALTH_COLOR.cpu} />
        <RadialGauge value={s.memUsedPct} label="MEM" color={HEALTH_COLOR.mem} />
        <RadialGauge value={s.hddUsedPct} label="DISK" color={HEALTH_COLOR.disk} />
      </div>
      <div className="grid gap-2">
        <div className="grid gap-0.5">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.05em] uppercase">
            CPU load
          </span>
          <MetricArea
            id={`${d.name}-cpu`}
            values={hist.map((h) => h.cpuLoad)}
            color={HEALTH_COLOR.cpu}
            maxValue={100}
            unit="%"
          />
        </div>
        <div className="grid gap-0.5">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.05em] uppercase">
            Memory used
          </span>
          <MetricArea
            id={`${d.name}-mem`}
            values={hist.map((h) => h.memUsedPct)}
            color={HEALTH_COLOR.mem}
            maxValue={100}
            unit="%"
          />
        </div>
        <div className="grid gap-0.5">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.05em] uppercase">
            Probe latency
          </span>
          <MetricArea
            id={`${d.name}-lat`}
            values={hist.map((h) => h.latencyMs)}
            color={HEALTH_COLOR.latency}
            unit="ms"
          />
        </div>
      </div>
      <div className="text-muted-foreground font-mono text-[11px]">
        RAM {memHuman(s.totalMemory && s.freeMemory ? s.totalMemory - s.freeMemory : undefined)} /{" "}
        {memHuman(s.totalMemory)} · free disk {memHuman(s.freeHdd)}
      </div>
      {s.disks && s.disks.length > 0 && (
        <div className="grid gap-1">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.05em] uppercase">
            External storage
          </span>
          {s.disks.map((disk) => (
            <div
              key={disk.slot}
              className="flex items-center justify-between gap-2 font-mono text-[11px]"
            >
              <span className="truncate">
                <Badge type="secondary">{disk.slot}</Badge>{" "}
                {disk.model ?? disk.mountPoint ?? "disk"}
                {disk.fs ? ` · ${disk.fs}` : ""}
              </span>
              <span className="text-muted-foreground whitespace-nowrap">
                {memHuman(disk.free)} free / {memHuman(disk.size)}
                {disk.usedPct != null ? ` · ${disk.usedPct}%` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
