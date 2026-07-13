/**
 * CAPsMAN dashboard view (Phase 1 — view-only).
 *
 * Reads /api/capsman/overview|clients|audit and renders the Wi-Fi fabric:
 * a per-floor coverage grid (co-channel conflicts highlighted), a resource-aware
 * load board, a weak-signal client table with the recommended neighbor AP, and a
 * roaming/HA audit strip. Steering/apply actions arrive in a later phase.
 */
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Radio as RadioIcon, Scale, Wifi } from "lucide-react";
import { api, postJson } from "./api";
import { Panel, StatCard } from "./atoms";
import { Badge, Button, Note, Spinner } from "./geist";
import { num } from "./format";
import { toast } from "./toast-action";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Band = "2ghz" | "5ghz" | "unknown";
type Severity = "critical" | "high" | "medium" | "low";

interface RadioNode {
  cap: string;
  radioId: string;
  band: Band;
  channel?: number;
  clientCount: number;
  floor?: string;
  zone?: string;
  cpuLoad?: number;
  memUsedPct?: number;
  adjacent: string[];
  conflicts: string[];
}
interface Overview {
  managerEnabled: boolean;
  managerCount: number;
  capsHaveBackupManager: boolean;
  requirePeerCertificate: boolean;
  radios: RadioNode[];
  cochannel: [string, string][];
  proposedChannels: Record<string, number>;
  bandSplit: Record<Band, number>;
  totals: { radios: number; clients: number; caps: number };
}
interface WeakClient {
  mac: string;
  currentCap: string;
  currentRadio: string;
  signal: number;
  band: Band;
  recommendCap?: string;
  gainDb?: number;
}
interface Finding {
  finding_id: string;
  category: string;
  severity: Severity;
  confidence: string;
  title: string;
  target: string;
  detail: string;
  recommendation: string;
}
interface AuditPayload {
  findings: Finding[];
  summary: Record<Severity, number>;
  total: number;
}

const SEV_COLOR: Record<Severity, string> = {
  critical: "text-destructive",
  high: "text-orange-500",
  medium: "text-yellow-500",
  low: "text-muted-foreground",
};

function bandBadge(b: Band): ReactNode {
  const label = b === "2ghz" ? "2.4G" : b === "5ghz" ? "5G" : "?";
  return (
    <Badge type={b === "5ghz" ? "success" : b === "2ghz" ? "warning" : "secondary"}>{label}</Badge>
  );
}

interface ApplyResult {
  ok?: boolean;
  error?: string;
  snapshotId?: string;
  applied?: number;
  message?: string;
}

/** Confirm + POST a CAPsMAN write, toasting the outcome. */
async function runApply(
  path: string,
  body: unknown,
  label: string,
  onDone: () => void,
): Promise<void> {
  const id = toast.loading(`${label}…`);
  try {
    const r = await postJson<ApplyResult>(path, { ...(body as object), confirm: true });
    if (r?.ok) {
      toast.success(`${label} applied`, {
        id,
        description: r.snapshotId ? `snapshot ${r.snapshotId}` : r.message,
      });
      onDone();
    } else {
      toast.error(r?.error ?? `${label} failed`, { id });
    }
  } catch {
    toast.error(`${label} failed (server unreachable)`, { id });
  }
}

/** "Steer" action for one weak client — confirmed in an AlertDialog. */
function SteerButton({
  mac,
  cap,
  onDone,
}: {
  mac: string;
  cap: string;
  onDone: () => void;
}): ReactNode {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button className="h-6 px-2 text-[11px]">
          <Wifi className="size-3" /> Steer
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Steer {mac} toward {cap}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Installs a hard signal-range reject on the client&rsquo;s current radio so it
            re-associates on the stronger neighbor. This may briefly disconnect the client, and
            RouterOS ultimately lets the client decide (advisory). A config snapshot is taken first
            and the change runs in Safe Mode.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={() =>
              void runApply(
                "/api/capsman/apply/steer",
                { mac, mode: "hard" },
                `Steer ${mac}`,
                onDone,
              )
            }
          >
            Steer (hard)
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Radio health 0..1 (higher = better): fewer clients, lower CPU. */
function health(r: RadioNode): number {
  const load = Math.min(1, r.clientCount / 30);
  const cpu = Math.min(1, (r.cpuLoad ?? 0) / 100);
  const conflict = r.conflicts.length > 0 ? 0.4 : 0;
  return Math.max(0, 1 - (load * 0.5 + cpu * 0.4 + conflict));
}
function healthColor(h: number): string {
  if (h > 0.66) return "bg-emerald-500/15 border-emerald-500/40";
  if (h > 0.33) return "bg-yellow-500/15 border-yellow-500/40";
  return "bg-destructive/15 border-destructive/50";
}

export function CapsmanView(): ReactNode {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [weak, setWeak] = useState<WeakClient[]>([]);
  const [audit, setAudit] = useState<AuditPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const [o, c, a] = await Promise.all([
        api<Overview>("/api/capsman/overview"),
        api<{ weak: WeakClient[] }>("/api/capsman/clients"),
        api<AuditPayload>("/api/capsman/audit"),
      ]);
      setOverview(o);
      setWeak(c.weak);
      setAudit(a);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load CAPsMAN data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Group radios by floor (unknown floor → "?"), then render a grid per floor.
  const floors = useMemo(() => {
    const byFloor = new Map<string, RadioNode[]>();
    for (const r of overview?.radios ?? []) {
      const f = r.floor ?? "?";
      (byFloor.get(f) ?? byFloor.set(f, []).get(f)!).push(r);
    }
    return [...byFloor.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [overview]);

  if (loading && !overview) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
        <Spinner /> Loading CAPsMAN fabric…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4">
        <Note type="error" label="CAPsMAN unavailable">
          {error}. This device may not run a CAPsMAN manager, or has no managed CAPs.
        </Note>
      </div>
    );
  }
  if (!overview) return null;

  const notManager = !overview.managerEnabled;

  return (
    <div className="flex flex-col gap-5">
      {notManager && (
        <Note type="warning" label="No CAPsMAN manager">
          This device isn&rsquo;t running a CAPsMAN manager (or no CAPs are provisioned). The audit
          still runs; the coverage grid will be empty.
        </Note>
      )}

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard k="CAPs" v={num(overview.totals.caps)} sub="managed access points" />
        <StatCard k="Radios" v={num(overview.totals.radios)} />
        <StatCard k="Clients" v={num(overview.totals.clients)} />
        <StatCard
          k="2.4G / 5G"
          v={`${overview.bandSplit["2ghz"]} / ${overview.bandSplit["5ghz"]}`}
          sub="client band split"
        />
        <StatCard
          k="Co-channel"
          v={num(overview.cochannel.length)}
          cls={overview.cochannel.length ? "text-destructive" : undefined}
          sub="conflicting pairs"
        />
        <StatCard
          k="Findings"
          v={num(audit?.total ?? 0)}
          cls={audit && audit.total > 0 ? "text-orange-500" : undefined}
        />
      </div>

      {/* §5.1 Floor coverage heatmap + §5.4 load (per-radio cards carry both) */}
      <Panel
        title="Coverage & load by floor"
        extra={
          <div className="flex items-center gap-2">
            {overview.cochannel.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button className="h-6 px-2 text-[11px]">
                    <RadioIcon className="size-3" /> Apply channel plan
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Apply the proposed channel plan?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Re-channels radios to the non-overlapping plan (2.4 GHz 1/6/11, 5 GHz
                      DFS-aware) to clear the {overview.cochannel.length} co-channel conflict(s).
                      Clients on a re-channeled radio briefly re-associate. Snapshot + Safe Mode;
                      idempotent. (v7 /interface wifi only.)
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        void runApply(
                          "/api/capsman/apply/channel-plan",
                          {},
                          "Channel plan",
                          () => void load(),
                        )
                      }
                    >
                      Apply
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="h-6 px-2 text-[11px]">
                  <Scale className="size-3" /> Auto-balance
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Apply resource-aware load balance?</AlertDialogTitle>
                  <AlertDialogDescription>
                    For each overloaded or CPU-constrained radio that has an idle adjacent neighbor,
                    installs a connect-priority nudge so NEW clients prefer the neighbor. Existing
                    clients are not disconnected. Snapshot + Safe Mode; idempotent.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      void runApply(
                        "/api/capsman/apply/load-balance",
                        {},
                        "Load balance",
                        () => void load(),
                      )
                    }
                  >
                    Apply
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <button
              type="button"
              onClick={() => void load()}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
            >
              <RefreshCw className="size-3.5" /> refresh
            </button>
          </div>
        }
      >
        {floors.length === 0 ? (
          <p className="text-muted-foreground text-sm">No managed radios.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {floors.map(([floor, radios]) => (
              <div key={floor}>
                <div className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-wide uppercase">
                  {floor === "?" ? "Unfloored (inferred by signal)" : `Floor ${floor}`}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {radios.map((r) => {
                    const proposed = overview.proposedChannels[r.radioId];
                    const changeCh = proposed != null && proposed !== r.channel;
                    return (
                      <div
                        key={r.radioId}
                        className={cn(
                          "flex flex-col gap-1 rounded-lg border p-2.5",
                          healthColor(health(r)),
                        )}
                        title={`${r.cap} · ${r.adjacent.length} neighbors`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="inline-flex items-center gap-1 text-xs font-semibold">
                            <RadioIcon className="size-3" /> {r.cap}
                          </span>
                          {bandBadge(r.band)}
                        </div>
                        <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                          <span
                            className={cn(r.conflicts.length > 0 && "text-destructive font-medium")}
                          >
                            ch {r.channel ?? "?"}
                            {changeCh && <span className="text-brand"> →{proposed}</span>}
                          </span>
                          <span>{r.clientCount} cl</span>
                        </div>
                        <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                          <span>CPU {r.cpuLoad != null ? `${r.cpuLoad}%` : "—"}</span>
                          {r.conflicts.length > 0 && (
                            <span className="text-destructive inline-flex items-center gap-0.5">
                              <AlertTriangle className="size-3" /> co-ch
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* §5.5 Roaming & HA audit strip */}
      <Panel
        title="Roaming (FT) & HA audit"
        extra={
          <div className="flex items-center gap-2">
            {audit && audit.findings.some((f) => f.category === "ft") && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button className="h-6 px-2 text-[11px]">
                    <Wifi className="size-3" /> Enable FT
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Enable 802.11r fast-roaming?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Turns on FT across the CAPsMAN security configs and converges them on ONE
                      shared mobility domain, so clients roam between floors without a full re-auth.
                      This briefly re-keys associated clients. Snapshot + Safe Mode; idempotent.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        void runApply("/api/capsman/apply/ft", {}, "Enable FT", () => void load())
                      }
                    >
                      Enable FT
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {audit && audit.findings.some((f) => f.category === "ha") && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button className="h-6 px-2 text-[11px]">
                    <AlertTriangle className="size-3" /> Harden HA
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Harden CAPsMAN HA (require peer certificate)?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Enables require-peer-certificate on this manager so a rogue manager
                      can&rsquo;t adopt your CAPs. Standing up a second manager and pointing every
                      CAP at both is multi-device and NOT auto-applied — the tool returns those
                      manual steps. Snapshot + Safe Mode; idempotent.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        void runApply("/api/capsman/apply/ha", {}, "Harden HA", () => void load())
                      }
                    >
                      Harden HA
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        }
      >
        {!audit || audit.total === 0 ? (
          <p className="text-emerald-500 text-sm">
            No findings — roaming &amp; redundancy look healthy. ✓
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {audit.findings.map((f) => (
              <div key={f.finding_id} className="flex items-start gap-2 rounded-md border p-2.5">
                <span
                  className={cn("mt-0.5 text-[10px] font-bold uppercase", SEV_COLOR[f.severity])}
                >
                  {f.severity.slice(0, 4)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{f.title}</div>
                  <div className="text-muted-foreground text-xs">{f.detail}</div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    → {f.recommendation}
                    <span className="ml-2 opacity-60">
                      [{f.category} · {f.confidence}]
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* §5.3 Weak-signal client table */}
      <Panel
        title="Weak-signal clients"
        extra={<span className="text-muted-foreground text-xs">{weak.length} below threshold</span>}
      >
        {weak.length === 0 ? (
          <p className="text-emerald-500 text-sm">No weak clients. ✓</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead>Band</TableHead>
                  <TableHead>Current AP</TableHead>
                  <TableHead>Recommended</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {weak.map((w) => (
                  <TableRow key={w.mac}>
                    <TableCell className="font-mono text-xs">{w.mac}</TableCell>
                    <TableCell
                      className={cn(
                        w.signal < -80 ? "text-destructive" : "text-orange-500",
                        "tabular-nums",
                      )}
                    >
                      {w.signal} dBm
                    </TableCell>
                    <TableCell>{bandBadge(w.band)}</TableCell>
                    <TableCell className="text-xs">{w.currentCap}</TableCell>
                    <TableCell className="text-xs">
                      {w.recommendCap ? (
                        <span className="text-brand inline-flex items-center gap-1">
                          <Wifi className="size-3" /> {w.recommendCap} (+{w.gainDb} dB)
                        </span>
                      ) : (
                        <span className="text-muted-foreground">coverage gap</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {w.recommendCap && (
                        <SteerButton mac={w.mac} cap={w.recommendCap} onDone={() => void load()} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <p className="text-muted-foreground text-[11px]">
        Steering &amp; load-balance apply are live (snapshot + Safe Mode, confirmed). Channel-plan
        apply, FT enable and HA setup arrive in later phases. All steering is advisory — RouterOS
        lets the client decide.
      </p>
    </div>
  );
}
