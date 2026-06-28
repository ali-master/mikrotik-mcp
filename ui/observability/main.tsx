/**
 * MikroTik MCP — Observability dashboard (React).
 *
 * A React 19 single-page app served by the dashboard server on localhost. Talks
 * to the same origin: REST for history/analytics (`/api/stats`, `/api/events`,
 * `/api/meta`, `/api/devices`, `/api/config`, `/api/event/:id`) and a live
 * stream — a Bun-native WebSocket (`/api/stream`) with an automatic SSE
 * fallback (`/api/sse`) — for the real-time feed of every tool call the LLM
 * makes. Charts are hand-rolled SVG (no chart library). A `?token=` in the URL
 * is forwarded to every API call and the live stream when the server requires it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { api, deleteEvents } from "./api";
import { HBars, Panel, StatCard } from "./atoms";
import { BackupsView } from "./backups";
import { AaaView } from "./aaa";
import { ChangePlanView } from "./change-plan";
import { ActivityChart, RiskDonut } from "./charts";
import { ClientsView } from "./clients";
import { ConfigHistoryPanel, FieldGuidePanel } from "./config-panels";
import { ConfigStudio } from "./config-studio";
import { ConnectivityGraph, DeviceCard } from "./connectivity";
import { DetailDrawer } from "./detail-drawer";
import { bytes, clock, FEED_CAP, ms, num, RISK_COLOR, sval, WINDOWS } from "./format";
import { Note, Spinner } from "./geist";
import { DeviceHealthCard } from "./health";
import { JsonView } from "./highlight";
import { useLiveStream, useReveals } from "./hooks";
import { PacketCapture } from "./packet-capture";
import { S3Manage } from "./s3";
import { SnapshotsView } from "./snapshots";
import { TopologyMap } from "./topology";
import type {
  DevicesPayload,
  Filter,
  LiveMode,
  Meta,
  Risk,
  Stats,
  ToolEvent,
  TopologyPayload,
} from "./types";
import "./tailwind.css";
import "./styles.css";

gsap.registerPlugin(ScrollTrigger);

// ── export helpers ───────────────────────────────────────────────────────────
function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── view navigation ─────────────────────────────────────────────────────────
type ViewId =
  | "overview"
  | "devices"
  | "clients"
  | "aaa"
  | "topology"
  | "packets"
  | "snapshots"
  | "plan"
  | "s3"
  | "backups"
  | "config"
  | "feed";
const VIEWS: { id: ViewId; label: string; sub: string }[] = [
  { id: "overview", label: "Overview", sub: "Calls, latency & risk at a glance" },
  { id: "devices", label: "Devices", sub: "Connectivity radar & system health" },
  { id: "clients", label: "Clients", sub: "Connected LAN devices — usage, block/allow, pin IP" },
  { id: "aaa", label: "RADIUS & UM", sub: "RADIUS client & User Manager RADIUS server" },
  { id: "topology", label: "Topology", sub: "Layer-2 neighbours via MNDP / CDP / LLDP" },
  { id: "packets", label: "Packets", sub: "Live TZSP capture & decode" },
  { id: "snapshots", label: "Snapshots", sub: "Config history & time-travel diff" },
  { id: "plan", label: "Change Plan", sub: "Dry-run intended RouterOS commands" },
  { id: "s3", label: "S3 Backups", sub: "List, download & delete S3 backup objects" },
  { id: "backups", label: "Backups", sub: "Local config vault — create, restore, manage" },
  { id: "config", label: "Config", sub: "Effective configuration & safe editor" },
  { id: "feed", label: "Live Feed", sub: "Every tool call, in real time" },
];
/** Valid view ids — used to validate a hash/stored route before trusting it. */
const VIEW_IDS = new Set<ViewId>(VIEWS.map((v) => v.id));
/** localStorage key remembering the last-visited page. */
const VIEW_STORE_KEY = "mt-view";

/** The bare view id in the URL hash (`#devices` / `#/devices` → `devices`). */
function viewFromHash(): ViewId | null {
  try {
    const id = location.hash.replace(/^#\/?/, "") as ViewId;
    return VIEW_IDS.has(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * The page to show on load: the URL hash wins (so a refresh, bookmark, or shared
 * link lands exactly where the user was), then the last-visited page persisted
 * in localStorage, then Overview.
 */
function initialView(): ViewId {
  const fromHash = viewFromHash();
  if (fromHash) return fromHash;
  try {
    const stored = localStorage.getItem(VIEW_STORE_KEY) as ViewId | null;
    if (stored && VIEW_IDS.has(stored)) return stored;
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return "overview";
}

/**
 * Per-domain accent for each page. Drives the page's title gradient, the active
 * nav item, the help button, and assorted accents via the `--page-accent` /
 * `--page-accent-2` CSS variables set on `.main[data-view]`. Colour-coding the
 * pages makes the dashboard feel alive and helps orientation at a glance.
 */
// Monochrome chrome: every page uses the same white→light-zinc accent, so the
// sidebar, title, nav, glow and focus rings carry zero colour (only functional
// status colours — error/ok — remain, elsewhere).
const MONO_ACCENT: [string, string] = ["#ededed", "#a1a1a1"];
const VIEW_ACCENT: Record<ViewId, [string, string]> = {
  overview: MONO_ACCENT,
  devices: MONO_ACCENT,
  clients: MONO_ACCENT,
  aaa: MONO_ACCENT,
  topology: MONO_ACCENT,
  packets: MONO_ACCENT,
  snapshots: MONO_ACCENT,
  plan: MONO_ACCENT,
  s3: MONO_ACCENT,
  backups: MONO_ACCENT,
  config: MONO_ACCENT,
  feed: MONO_ACCENT,
};

/**
 * Per-page help content. Every page exposes a collapsible "About this page"
 * guide (toggled from the header) explaining what it does plus a few concrete
 * tips — so a newcomer is never lost. Kept terse and action-oriented.
 */
const HELP: Record<ViewId, { what: string; tips: string[] }> = {
  overview: {
    what: "A live pulse of all MCP tool activity: total calls, error rate, p50/p95 latency, the busiest tools, and a risk breakdown — over a time window you choose.",
    tips: [
      "Change the time window (top-right) to zoom from the last 5 minutes out to 24 hours.",
      "The risk donut splits calls by annotation: read · write · destructive · dangerous.",
      "A rising error line usually points at one device or one tool — jump to Live Feed to see which.",
    ],
  },
  devices: {
    what: "Every configured router with its live reachability (SSH or MAC-Telnet), latency, identity, and system health — CPU, memory and disk — refreshed continuously.",
    tips: [
      "Each device gets a stable colour so you can track it across the connectivity radar.",
      "Health (CPU/Mem/Disk) is probed periodically; MAC-Telnet devices are probed on a slower cadence.",
      "Latency tiers are colour-coded green → amber → red; a grey node is currently unreachable.",
    ],
  },
  clients: {
    what: "The LAN devices connected to a router — merged from its DHCP leases and ARP table — with live Download/Upload charts, and one-click controls to block/allow a device, pin (reserve) its IP, change that IP, or relabel it.",
    tips: [
      "Pick the router (top-right) to inspect its connected devices; filter by IP, MAC or name.",
      "Click a device to open its live ↓/↑ traffic chart — needs a simple queue targeting its IP.",
      "Block/allow is enforced by MAC, so it survives the device changing IP; “Pin IP” makes its lease static.",
    ],
  },
  aaa: {
    what: "Full management of the router's RADIUS client (`/radius`) and the built-in User Manager RADIUS server (`/user-manager`): RADIUS servers + incoming CoA, and User Manager users, service profiles, rate/quota limitations, NAS clients, profile assignments, accounting sessions, and global settings.",
    tips: [
      "Pick the router (top-right), then switch tabs across RADIUS, Users, Profiles, Limitations, NAS, Assignments, Sessions and Settings.",
      "Every tab is full CRUD: add, edit, enable/disable and remove — secrets are write-only and shown redacted.",
      "If a device lacks the user-manager package, the User Manager tabs explain how to install it; RADIUS-client tabs still work.",
    ],
  },
  topology: {
    what: "A Layer-2 map of neighbours each router discovers via MNDP / CDP / LLDP — the physical adjacency of your network, drawn live.",
    tips: [
      "Solid nodes are configured devices; faint nodes are discovered-but-unmanaged neighbours.",
      "Use “Add to config →” on an unmanaged neighbour to pre-fill it in the Config editor.",
      "Drag to pan; the layout settles automatically as new neighbours arrive.",
    ],
  },
  packets: {
    what: "Live packet capture streamed from a router over TZSP — decode headers in real time without leaving the dashboard.",
    tips: [
      "Pick a device and start the capture; packets decode as they arrive.",
      "Stop the capture when done — it frees the router-side sniffer.",
      "Great for debugging a protocol issue alongside the Live Feed of tool calls.",
    ],
  },
  snapshots: {
    what: "Point-in-time captures of a device’s full configuration (/export), stored locally so you can diff any two and see exactly what changed.",
    tips: [
      "Capture a snapshot before a risky change, then diff after to audit the delta.",
      "The diff is line-level: green added, red removed.",
      "Snapshots are device config exports — for the dashboard’s OWN config history see the Config page.",
    ],
  },
  plan: {
    what: "Dry-run the exact RouterOS commands a change would run before it touches a device — a change plan you can review and trust.",
    tips: [
      "Paste or build intended commands to see them validated and ordered.",
      "Nothing is sent to the device from here — it’s a preview.",
      "Pair with Safe Mode (auto-revert) when you do apply for real.",
    ],
  },
  s3: {
    what: "Browse, download, and delete backup objects in your configured S3-compatible bucket — your off-box archive of device backups and exports.",
    tips: [
      "Filter by key prefix to find a device’s backups quickly.",
      "Download fetches the object through a presigned URL; delete is permanent.",
      "For host-side .rsc backups instead, use the Backups page.",
    ],
  },
  backups: {
    what: "A local config vault on the MCP server: capture a device’s /export as a timestamped .rsc file, then download, upload, rename, restore (via Safe Mode), or delete it.",
    tips: [
      "Restore offers a dry-run (applies then rolls back) before you commit for real.",
      "Edit the vault path inline in the header — it’s saved to your config.",
      "Filenames are stamped in the device’s local 24-hour clock.",
    ],
  },
  config: {
    what: "View the effective configuration, edit it safely with schema-aware validation and auto-rollback, browse a full field guide, and travel through config version history.",
    tips: [
      "Every successful apply is auto-saved to the version timeline — restore any point in time.",
      "Save a named checkpoint before a big change for an easy, labelled rollback.",
      "The Field Guide documents every config option, its type, and default — straight from the schema.",
    ],
  },
  feed: {
    what: "Every tool call as it happens — tool, device, risk, duration, and success/error — with full request/response detail on click.",
    tips: [
      "Filter by status to isolate failures, or by tool/device to follow one thread.",
      "Click any row to open the full (secret-redacted) request and response.",
      "Pause the stream when you want to inspect without rows shifting under you.",
    ],
  },
};

/** Collapsible "About this page" guide shown under each page header. */
function HelpPanel({ view }: { view: ViewId }): ReactNode {
  const h = HELP[view];
  return (
    <div className="pagehelp reveal" role="region" aria-label="Page help">
      <div className="pagehelp__icon" aria-hidden="true">
        ?
      </div>
      <div className="pagehelp__body">
        <p className="pagehelp__what">{h.what}</p>
        <ul className="pagehelp__tips">
          {h.tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Inline stroke icons for the sidebar — no icon-font dependency. */
function NavIcon({ name }: { name: ViewId }): ReactNode {
  const paths: Record<ViewId, ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1.6" />
        <rect x="13" y="3" width="8" height="5" rx="1.6" />
        <rect x="13" y="10" width="8" height="11" rx="1.6" />
        <rect x="3" y="13" width="8" height="8" rx="1.6" />
      </>
    ),
    devices: (
      <>
        <rect x="3" y="4" width="18" height="7" rx="2" />
        <rect x="3" y="13" width="18" height="7" rx="2" />
        <path d="M7 7.5h.01M7 16.5h.01" />
      </>
    ),
    clients: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <path d="M16 7.5a2.5 2.5 0 0 1 0 5M17.5 19a4.5 4.5 0 0 0-2-3.6" />
      </>
    ),
    aaa: (
      <>
        <path d="M12 3 4 6v5c0 4.4 3.2 7.6 8 9 4.8-1.4 8-4.6 8-9V6l-8-3Z" />
        <path d="M9.5 11.5 11 13l3.5-3.5" />
      </>
    ),
    topology: (
      <>
        <circle cx="12" cy="5" r="2.4" />
        <circle cx="5" cy="19" r="2.4" />
        <circle cx="19" cy="19" r="2.4" />
        <path d="M12 7.4 6.4 16.6M12 7.4 17.6 16.6" />
      </>
    ),
    packets: <path d="M3 12h4l2-7 4 14 2-7h6" />,
    snapshots: (
      <>
        <path d="M12 3 3 7.5 12 12 21 7.5 12 3Z" />
        <path d="M3 12 12 16.5 21 12" />
        <path d="M3 16.5 12 21 21 16.5" />
      </>
    ),
    plan: (
      <>
        <circle cx="6" cy="6" r="2.3" />
        <circle cx="6" cy="18" r="2.3" />
        <circle cx="18" cy="8" r="2.3" />
        <path d="M6 8.3v7.4M8.3 6H13a3 3 0 0 1 3 3v0" />
      </>
    ),
    s3: (
      <>
        <ellipse cx="12" cy="6" rx="7" ry="2.6" />
        <path d="M5 6v12c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6V6" />
        <path d="M5 12c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6" />
      </>
    ),
    backups: (
      <>
        <path d="M3 6.5 5 3.5h14l2 3" />
        <rect x="3" y="6.5" width="18" height="14" rx="2" />
        <path d="M9.5 12h5" />
      </>
    ),
    config: (
      <>
        <path d="M4 7h8M16 7h4M4 17h4M12 17h8" />
        <circle cx="14" cy="7" r="2.2" />
        <circle cx="10" cy="17" r="2.2" />
      </>
    ),
    feed: <path d="M4 6h16M4 12h16M4 18h10" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

// ── app ──────────────────────────────────────────────────────────────────────
function App(): ReactNode {
  const [stats, setStats] = useState<Stats | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [devices, setDevices] = useState<DevicesPayload | null>(null);
  const [topology, setTopology] = useState<TopologyPayload | null>(null);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [editingConfig, setEditingConfig] = useState(false);
  // A device entry seeded from the topology map's "Add to config →" action.
  const [seed, setSeed] = useState<{ name: string; body: Record<string, unknown> } | null>(null);
  const [feed, setFeed] = useState<ToolEvent[]>([]);
  const [windowMs, setWindowMs] = useState(3_600_000);
  const [paused, setPaused] = useState(false);
  const [liveMode, setLiveMode] = useState<LiveMode>("off");
  const [selected, setSelected] = useState<ToolEvent | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // Per-device counter bumped on each live event — feeds the connectivity graph's
  // round-trip "burst" so a new tool call visibly travels out and back.
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Filter>({
    tool: "",
    risk: "",
    device: "",
    status: "",
    q: "",
  });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const rootRef = useRef<HTMLDivElement | null>(null);
  useReveals(rootRef);
  // The active page is mirrored in the URL hash + localStorage so it survives a
  // refresh and follows browser back/forward (see initialView / setView below).
  const [view, setViewState] = useState<ViewId>(initialView);
  const setView = useCallback((next: ViewId): void => {
    setViewState(next);
    try {
      if (viewFromHash() !== next) location.hash = next;
      localStorage.setItem(VIEW_STORE_KEY, next);
    } catch {
      /* storage/url unavailable — in-memory navigation still works */
    }
  }, []);
  useEffect(() => {
    // Normalise the URL on first load (e.g. when the view came from storage) and
    // track back/forward + manual hash edits.
    if (viewFromHash() !== view) {
      try {
        location.hash = view;
      } catch {
        /* ignore */
      }
    }
    const onHashChange = (): void => {
      const id = viewFromHash();
      if (id) setView(id);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
    // Run once on mount: setView is stable and `view` is only read here for the
    // initial URL normalisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Per-page "About this page" help, remembered per view across reloads.
  const [helpOpen, setHelpOpen] = useState<Set<ViewId>>(() => {
    try {
      const raw = localStorage.getItem("mt-help-open");
      return new Set(raw ? (JSON.parse(raw) as ViewId[]) : []);
    } catch {
      return new Set();
    }
  });
  const toggleHelp = (v: ViewId): void =>
    setHelpOpen((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      try {
        localStorage.setItem("mt-help-open", JSON.stringify([...next]));
      } catch {
        /* storage unavailable — help just won't persist */
      }
      return next;
    });
  // Devices page: search + status filter so a large fleet stays navigable.
  const [deviceQuery, setDeviceQuery] = useState("");
  const [deviceFilter, setDeviceFilter] = useState<"all" | "online" | "offline">("all");
  const deviceCounts = useMemo(() => {
    const list = devices?.devices ?? [];
    return {
      online: list.filter((d) => d.status.reachable === true).length,
      offline: list.filter((d) => d.status.reachable === false).length,
      total: list.length,
    };
  }, [devices]);
  const shownDevices = useMemo(() => {
    const list = devices?.devices ?? [];
    const q = deviceQuery.trim().toLowerCase();
    return list.filter((d) => {
      if (deviceFilter === "online" && d.status.reachable !== true) return false;
      if (deviceFilter === "offline" && d.status.reachable !== false) return false;
      if (
        q &&
        !d.name.toLowerCase().includes(q) &&
        !(d.address ?? d.host ?? "").toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [devices, deviceQuery, deviceFilter]);

  // Live stream → prepend to feed (unless paused) and pulse the device's link.
  useLiveStream(
    useCallback((e: ToolEvent) => {
      if (pausedRef.current) return;
      setFeed((f) => [e, ...f].slice(0, FEED_CAP));
      const dev = e.device;
      if (dev) setPulses((p) => ({ ...p, [dev]: (p[dev] ?? 0) + 1 }));
    }, []),
    useCallback((m: LiveMode) => setLiveMode(m), []),
  );

  // Initial load. Pull as many events as the live feed can hold (`FEED_CAP`) so a
  // refresh restores the same depth the in-memory feed keeps — not a smaller
  // slice that makes the count appear to shrink after every reload.
  useEffect(() => {
    void api<{ events: ToolEvent[] }>(`/api/events?limit=${FEED_CAP}`)
      .then((r) => setFeed(r.events))
      .catch(() => {});
  }, []);

  // Analytics + devices polling.
  const refreshStats = useCallback(() => {
    void api<Stats>(`/api/stats?window=${windowMs}&buckets=60`)
      .then(setStats)
      .catch(() => {});
  }, [windowMs]);
  useEffect(() => {
    refreshStats();
    const fetchAll = (): void => {
      refreshStats();
      void api<Meta>("/api/meta")
        .then(setMeta)
        .catch(() => {});
      void api<DevicesPayload>("/api/devices")
        .then(setDevices)
        .catch(() => {});
      void api<TopologyPayload>("/api/topology")
        .then(setTopology)
        .catch(() => {});
    };
    fetchAll();
    const t = setInterval(() => {
      if (!pausedRef.current) fetchAll();
    }, 4000);
    return () => clearInterval(t);
  }, [refreshStats]);
  useEffect(() => {
    const load = (): void =>
      void api<Record<string, unknown>>("/api/config")
        .then(setConfig)
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // Esc closes the drawer.
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const visible = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return feed
      .filter((e) => {
        if (filter.tool && e.tool !== filter.tool) return false;
        if (filter.risk && e.risk !== filter.risk) return false;
        if (filter.device && e.device !== filter.device) return false;
        if (filter.status === "ok" && e.isError) return false;
        if (filter.status === "error" && !e.isError) return false;
        if (
          q &&
          !e.tool.toLowerCase().includes(q) &&
          !e.input.toLowerCase().includes(q) &&
          !e.output.toLowerCase().includes(q) &&
          !(e.error ?? "").toLowerCase().includes(q)
        )
          return false;
        return true;
      })
      .sort((a, b) => b.ts - a.ts); // newest first
  }, [feed, filter]);
  const hasFilters = Boolean(
    filter.tool || filter.risk || filter.device || filter.status || filter.q,
  );

  // Errors + ok/error split derived from the live `feed` (the same data the
  // table shows), so the panels never disagree with the table. The windowed
  // `/api/stats` only counts events inside its time window, which is why a
  // table error older than the window used to leave "Recent errors" empty.
  const feedErrors = useMemo(() => feed.filter((e) => e.isError), [feed]);
  const feedStatus = useMemo(
    () => ({ ok: feed.length - feedErrors.length, error: feedErrors.length }),
    [feed, feedErrors],
  );

  const openDetail = useCallback(async (e: ToolEvent) => {
    try {
      setSelected(await api<ToolEvent>(`/api/event/${encodeURIComponent(e.id)}`));
    } catch {
      setSelected(e);
    }
  }, []);

  // The rows actually rendered (the table caps at 200) — selection + "select
  // all" operate over exactly these so the header checkbox matches what's shown.
  const shownRows = useMemo(() => visible.slice(0, 200), [visible]);
  const shownIds = useMemo(() => shownRows.map((e) => e.id), [shownRows]);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selectedIds.has(id));
  const someShownSelected = !allShownSelected && shownIds.some((id) => selectedIds.has(id));

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const everyShownSelected = shownIds.length > 0 && shownIds.every((id) => next.has(id));
      if (everyShownSelected) for (const id of shownIds) next.delete(id);
      else for (const id of shownIds) next.add(id);
      return next;
    });
  }, [shownIds]);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const deleteSelected = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await deleteEvents({ ids });
      const removed = new Set(ids);
      setFeed((f) => f.filter((e) => !removed.has(e.id)));
      setSelectedIds(new Set());
    } catch {
      /* network/permission error — leave selection intact for a retry */
    } finally {
      setConfirmingDelete(false);
    }
  }, [selectedIds]);

  const exportRows = (kind: "csv" | "json"): void => {
    if (kind === "json") {
      download("mcp-events.json", JSON.stringify(visible, null, 2), "application/json");
      return;
    }
    const cols = ["ts", "tool", "risk", "device", "durationMs", "isError", "error"];
    const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const body = visible
      .map((e) =>
        [
          new Date(e.ts).toISOString(),
          e.tool,
          e.risk,
          e.device ?? "",
          String(e.durationMs),
          String(e.isError),
          e.error ?? "",
        ]
          .map(esc)
          .join(","),
      )
      .join("\n");
    download("mcp-events.csv", `${cols.join(",")}\n${body}\n`, "text/csv");
  };

  const errCls = stats
    ? stats.errorRate >= 0.2
      ? "is-bad"
      : stats.errorRate >= 0.05
        ? "is-warn"
        : "is-good"
    : "";
  const mcp = (config?.mcp ?? {}) as Record<string, unknown>;
  const dash = (config?.dashboard ?? {}) as Record<string, unknown>;
  const sel = (key: keyof Filter, label: string, opts: string[]): ReactNode => (
    <select
      className="btn"
      value={filter[key]}
      onChange={(e) => setFilter((f) => ({ ...f, [key]: e.target.value }))}
    >
      <option value="">{label}</option>
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  const cur = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  return (
    <div
      className="shell"
      ref={rootRef}
      data-view={view}
      style={
        {
          "--page-accent": VIEW_ACCENT[view][0],
          "--page-accent-2": VIEW_ACCENT[view][1],
        } as CSSProperties
      }
    >
      {/* sidebar nav */}
      <aside className="nav">
        <div className="nav__brand">
          <div className="nav__mark">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <g stroke="#18181b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 12 L4 5 M12 12 L20 5 M12 12 L12 20" />
                <circle cx="12" cy="12" r="3" fill="#18181b" stroke="none" />
                <circle cx="4" cy="5" r="1.9" fill="#18181b" stroke="none" />
                <circle cx="20" cy="5" r="1.9" fill="#18181b" stroke="none" />
                <circle cx="12" cy="20" r="1.9" fill="#18181b" stroke="none" />
              </g>
            </svg>
          </div>
          <div className="nav__brandtext">
            <b>MikroTik MCP</b>
            <small>Observability</small>
          </div>
        </div>
        <nav className="nav__items">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`nav__item${view === v.id ? " is-active" : ""}`}
              onClick={() => setView(v.id)}
            >
              <NavIcon name={v.id} />
              <span>{v.label}</span>
              {v.id === "feed" &&
                feed.length > 0 && (
                  // `key={feed.length}` remounts the badge on every change so the
                  // CSS pop animation replays each time a new event arrives.
                  <span key={feed.length} className="nav__badge">
                    {feed.length > 999 ? "999+" : feed.length}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="nav__foot">
          <span
            className={`hero__live${liveMode !== "off" ? " is-on" : ""}${
              liveMode === "ws" ? " is-ws" : liveMode === "sse" ? " is-sse" : ""
            }`}
            title="Live transport: WebSocket (preferred) or SSE fallback"
          >
            <span className="dot" />
            {liveMode === "off" ? "offline" : `live · ${liveMode}`}
          </span>
          <small className="muted">
            {meta ? `${num(meta.total)} events · ${meta.transport}` : "connecting…"}
          </small>
        </div>
      </aside>

      {/* main content */}
      <main className="main" data-view={view}>
        <header className="topline reveal">
          <div className="topline__txt">
            <h1>{cur.label}</h1>
            <small>{cur.sub}</small>
          </div>
          <span className="topline__spacer" />
          {view === "overview" && (
            <select
              className="btn"
              value={windowMs}
              onChange={(e) => setWindowMs(Number(e.target.value))}
              title="Stats time window"
            >
              {WINDOWS.map(([label, val]) => (
                <option key={val} value={val}>
                  window: {label}
                </option>
              ))}
            </select>
          )}
          <button
            className={`help-toggle${helpOpen.has(view) ? " is-on" : ""}`}
            onClick={() => toggleHelp(view)}
            aria-expanded={helpOpen.has(view)}
            title="About this page"
          >
            <span className="help-toggle__q" aria-hidden="true">
              ?
            </span>
            Help
          </button>
        </header>

        {helpOpen.has(view) && <HelpPanel view={view} />}

        {/* ── Overview ── */}
        {view === "overview" && (
          <section className="view">
            <div className="cards reveal">
              {stats ? (
                <>
                  <StatCard k="Calls (window)" v={num(stats.total)} />
                  <StatCard k="Calls / min" v={stats.callsPerMin.toFixed(1)} />
                  <StatCard
                    k="Error rate"
                    v={`${(stats.errorRate * 100).toFixed(1)}%`}
                    sub={`${stats.errors} err`}
                    cls={errCls}
                  />
                  <StatCard k="Avg latency" v={ms(stats.latency.avg)} />
                  <StatCard k="p95 latency" v={ms(stats.latency.p95)} />
                  <StatCard k="p99 latency" v={ms(stats.latency.p99)} />
                  <StatCard k="Distinct tools" v={num(stats.distinctTools)} />
                  <StatCard k="Output volume" v={bytes(stats.outputBytes)} />
                </>
              ) : (
                <div className="stat">
                  <p className="k">Loading…</p>
                  <div className="v">—</div>
                </div>
              )}
            </div>

            <div className="bento reveal">
              <Panel title="Calls over time" className="b-series">
                {stats ? (
                  <ActivityChart series={stats.series} />
                ) : (
                  <div className="muted">no data</div>
                )}
              </Panel>
              {stats && (
                <>
                  <Panel title="By risk" className="b-risk">
                    <RiskDonut
                      segments={(Object.keys(stats.byRisk) as Risk[]).map((r) => ({
                        label: r,
                        value: stats.byRisk[r],
                        color: RISK_COLOR[r],
                      }))}
                    />
                  </Panel>
                  <Panel title="Top tools" className="b-tools">
                    <HBars
                      rows={stats.byTool.map((t) => ({
                        label: t.tool,
                        value: t.count,
                        sub: `${t.count}× · ${ms(t.p95Ms)} p95${t.errors ? ` · ${t.errors} err` : ""}`,
                        color: t.errors ? "var(--mt-bad)" : undefined,
                      }))}
                    />
                  </Panel>
                  <Panel title="Status" className="b-status">
                    <RiskDonut
                      centerLabel="calls"
                      segments={[
                        { label: "ok", value: feedStatus.ok, color: "#a1a1a1" },
                        { label: "error", value: feedStatus.error, color: "#ff5c5c" },
                      ]}
                    />
                  </Panel>
                  <Panel title="By device" className="b-device">
                    {stats.byDevice.length ? (
                      <HBars
                        rows={stats.byDevice.map((d) => ({ label: d.device, value: d.count }))}
                      />
                    ) : (
                      <div className="muted">single device</div>
                    )}
                  </Panel>
                  <Panel title="Recent errors" className="b-errors">
                    {feedErrors.length ? (
                      <div className="hbar">
                        {feedErrors.slice(0, 8).map((e) => (
                          <div
                            className="hbar__row conn-errrow"
                            style={{ gridTemplateColumns: "auto 1fr" }}
                            key={e.id}
                            onClick={() => void openDetail(e)}
                          >
                            <span className="muted">{clock(e.ts)}</span>
                            <span
                              style={{
                                color: "var(--mt-bad)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                minWidth: 0,
                              }}
                              title={e.error ?? e.output}
                            >
                              {e.tool}: {e.error ?? e.output ?? "error"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="muted">no errors 🎉</div>
                    )}
                  </Panel>
                </>
              )}
            </div>
          </section>
        )}

        {/* ── Devices ── */}
        {view === "devices" &&
          (devices && devices.devices.length > 0 ? (
            <section className="view">
              {/* search + status filter — keeps a large fleet navigable */}
              <div className="dev-toolbar reveal">
                <input
                  className="search"
                  type="search"
                  placeholder="Search devices by name or address…"
                  value={deviceQuery}
                  onChange={(e) => setDeviceQuery(e.target.value)}
                  style={{ flex: 1, minWidth: 180 }}
                />
                <div className="dev-filters">
                  {(["all", "online", "offline"] as const).map((f) => (
                    <button
                      key={f}
                      className={`dev-fbtn${deviceFilter === f ? " is-active" : ""}`}
                      onClick={() => setDeviceFilter(f)}
                    >
                      {f === "all"
                        ? `All ${deviceCounts.total}`
                        : f === "online"
                          ? `Online ${deviceCounts.online}`
                          : `Offline ${deviceCounts.offline}`}
                    </button>
                  ))}
                </div>
                <span className="muted">
                  {shownDevices.length}/{deviceCounts.total} shown
                </span>
              </div>

              {/* connectivity radar — collapsible so it doesn't dominate a big fleet */}
              <details className="dev-collapse reveal" open={deviceCounts.total <= 8}>
                <summary>
                  Connectivity radar
                  <span className="muted">
                    {" "}
                    · {deviceCounts.online} online · {deviceCounts.offline} offline ·{" "}
                    {deviceCounts.total} total
                  </span>
                </summary>
                <ConnectivityGraph payload={devices} pulses={pulses} />
              </details>

              {/* responsive device grid (filtered) */}
              {shownDevices.length === 0 ? (
                <div className="feed-empty reveal">
                  <div className="feed-empty__icon">🔍</div>
                  <p className="feed-empty__title">No devices match</p>
                  <p className="feed-empty__sub">Try a different search or status filter.</p>
                </div>
              ) : (
                <div className="dev-grid-wide reveal">
                  {shownDevices.map((d) => (
                    <DeviceCard key={d.name} d={d} />
                  ))}
                </div>
              )}

              {/* system health (filtered) */}
              {shownDevices.length > 0 && (
                <Panel
                  title="Device system health"
                  className="reveal"
                  extra={<span className="muted">CPU · memory · disk · latency · live probe</span>}
                >
                  <div className="health-grid">
                    {shownDevices.map((d) => (
                      <DeviceHealthCard key={d.name} d={d} />
                    ))}
                  </div>
                </Panel>
              )}
            </section>
          ) : (
            <div className="feed-empty">
              <div className="feed-empty__icon">🖧</div>
              <p className="feed-empty__title">No devices configured</p>
              <Note type="secondary" label="Tip">
                Add a device to your config to see connectivity and system health here.
              </Note>
            </div>
          ))}

        {/* ── Clients ── */}
        {view === "clients" && <ClientsView />}

        {/* ── RADIUS & User Manager ── */}
        {view === "aaa" && <AaaView />}

        {/* ── Topology ── */}
        {view === "topology" &&
          (topology && topology.nodes.length > 0 ? (
            <section className="view">
              <Panel
                title="Network topology"
                className="reveal"
                extra={
                  <span className="muted">
                    Layer-2 neighbours via MNDP/CDP/LLDP · click a neighbour to onboard it
                  </span>
                }
              >
                <TopologyMap
                  topo={topology}
                  onOnboard={(name, body) => {
                    setSeed({ name, body });
                    setEditingConfig(true);
                    setView("config");
                  }}
                />
              </Panel>
            </section>
          ) : (
            <div className="feed-empty">
              <div className="feed-empty__icon">🛰️</div>
              <p className="feed-empty__title">No neighbours discovered yet</p>
              <p className="feed-empty__sub">
                Layer-2 neighbours (MNDP / CDP / LLDP) appear here as the device reports them.
              </p>
            </div>
          ))}

        {/* ── Packets ── */}
        {view === "packets" && (
          <section className="view">
            <Panel
              title="Packet capture"
              className="reveal"
              extra={<span className="muted">live TZSP decode · /tool sniffer streaming</span>}
            >
              <PacketCapture />
            </Panel>
          </section>
        )}

        {/* ── Snapshots ── */}
        {view === "snapshots" && <SnapshotsView />}

        {/* ── Change Plan ── */}
        {view === "plan" && <ChangePlanView />}

        {/* ── S3 Backups ── */}
        {view === "s3" && <S3Manage />}

        {/* ── Local Backups ── */}
        {view === "backups" && <BackupsView />}

        {/* ── Config ── */}
        {view === "config" &&
          (config ? (
            <section className="view">
              <Panel
                title="Configuration"
                className="reveal"
                extra={
                  <button
                    className="btn"
                    onClick={() => setEditingConfig((v) => !v)}
                    title="Edit the config JSON with autocomplete, validation and safe-apply"
                  >
                    {editingConfig ? "View" : "✎ Edit config"}
                  </button>
                }
              >
                {editingConfig ? (
                  <ConfigStudio
                    key={seed ? `seed-${seed.name}` : "config"}
                    initial={
                      seed
                        ? {
                            ...config,
                            devices: {
                              ...(config.devices as Record<string, unknown>),
                              [seed.name]: seed.body,
                            },
                          }
                        : config
                    }
                    onClose={() => {
                      setEditingConfig(false);
                      setSeed(null);
                    }}
                    onReload={() => {
                      setSeed(null);
                      void api<Record<string, unknown>>("/api/config")
                        .then(setConfig)
                        .catch(() => {});
                    }}
                  />
                ) : (
                  <>
                    <div className="legend" style={{ margin: "0 0 10px" }}>
                      <span>transport: {sval(mcp.transport)}</span>
                      <span>read-only: {config.readOnly ? "yes" : "no"}</span>
                      <span>
                        dashboard: {sval(dash.host)}:{sval(dash.port)}
                      </span>
                      <span>capture: {dash.captureBody ? "on" : "off"}</span>
                      <span>s3: {config.s3 ? "configured" : "off"}</span>
                    </div>
                    <details className="cfg">
                      <summary>Full effective configuration (secrets redacted)</summary>
                      <JsonView value={config} maxHeight={340} />
                    </details>
                  </>
                )}
              </Panel>

              <Panel
                title="Version history"
                className="reveal"
                extra={<span className="muted">point-in-time snapshots · diff &amp; restore</span>}
              >
                <ConfigHistoryPanel
                  onRestored={() =>
                    void api<Record<string, unknown>>("/api/config")
                      .then(setConfig)
                      .catch(() => {})
                  }
                />
              </Panel>

              <Panel
                title="Field guide"
                className="reveal"
                extra={
                  <span className="muted">every config option, documented from the schema</span>
                }
              >
                <FieldGuidePanel />
              </Panel>
            </section>
          ) : (
            <div className="feed-empty">
              <Spinner />
              <p className="feed-empty__title">Loading configuration…</p>
            </div>
          ))}

        {/* ── Live Feed ── */}
        {view === "feed" && (
          <div className="panel reveal">
            <div className="sheet__hd" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Live tool calls</h2>
              <span style={{ flex: 1 }} />
              <span className="muted">
                {visible.length} shown · {feed.length} buffered
              </span>
            </div>
            <div className="toolbar" style={{ marginBottom: 12 }}>
              <div className="grow" style={{ flex: 1, minWidth: 180 }}>
                <input
                  className="search"
                  type="search"
                  placeholder="Search tool / input / output / error…"
                  value={filter.q}
                  onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
                />
              </div>
              {sel("tool", "all tools", meta?.tools ?? [])}
              {sel("risk", "all risk", [
                "READ",
                "WRITE",
                "WRITE_IDEMPOTENT",
                "DESTRUCTIVE",
                "DANGEROUS",
              ])}
              {sel("device", "all devices", meta?.devices ?? [])}
              {sel("status", "all status", ["ok", "error"])}
              {/* time window selector lives in the Overview header */}
              <button
                className={`btn${paused ? " is-active" : ""}`}
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? "▶ Resume" : "⏸ Pause"}
              </button>
              <button className="btn" onClick={() => exportRows("csv")}>
                CSV
              </button>
              <button className="btn" onClick={() => exportRows("json")}>
                JSON
              </button>
              <button
                className="btn"
                onClick={() => setFilter({ tool: "", risk: "", device: "", status: "", q: "" })}
              >
                Clear
              </button>
              {confirmingDelete && selectedIds.size > 0 ? (
                <>
                  <button className="btn btn-danger" onClick={() => void deleteSelected()}>
                    ✓ Confirm delete ({selectedIds.size})
                  </button>
                  <button className="btn" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="btn"
                  disabled={selectedIds.size === 0}
                  onClick={() => setConfirmingDelete(true)}
                  title="Delete the selected rows"
                >
                  🗑 Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                </button>
              )}
            </div>
            {visible.length === 0 ? (
              hasFilters ? (
                <div className="feed-empty">
                  <div className="feed-empty__icon">🔍</div>
                  <p className="feed-empty__title">No calls match your filters</p>
                  <p className="feed-empty__sub">
                    {feed.length} call{feed.length === 1 ? "" : "s"} buffered — try widening the
                    search or the risk / device / status filters.
                  </p>
                  <button
                    className="btn"
                    onClick={() => setFilter({ tool: "", risk: "", device: "", status: "", q: "" })}
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="feed-empty">
                  <div className={`feed-empty__pulse${liveMode !== "off" ? " is-on" : ""}`} />
                  <p className="feed-empty__title">
                    {liveMode === "off" ? "Not connected" : "Listening for tool calls…"}
                  </p>
                  <p className="feed-empty__sub">
                    {liveMode === "off"
                      ? "The live stream is offline — it will reconnect automatically."
                      : "Tool calls the LLM makes against this server stream in here in real time."}
                  </p>
                </div>
              )
            ) : (
              <div className="feedwrap">
                <table className="feed">
                  <thead>
                    <tr>
                      <th style={{ width: 28 }}>
                        <input
                          type="checkbox"
                          aria-label="Select all shown rows"
                          checked={allShownSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someShownSelected;
                          }}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th>time</th>
                      <th>tool</th>
                      <th>risk</th>
                      <th>device</th>
                      <th className="num">dur</th>
                      <th>status</th>
                      <th>output</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((e) => (
                      <tr
                        key={e.id}
                        className={
                          `${e.isError ? "is-err" : ""}${selectedIds.has(e.id) ? " is-selected" : ""}`.trim() ||
                          undefined
                        }
                        onClick={() => void openDetail(e)}
                      >
                        <td onClick={(ev) => ev.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label="Select row"
                            checked={selectedIds.has(e.id)}
                            onChange={() => toggleSelect(e.id)}
                          />
                        </td>
                        <td>{clock(e.ts)}</td>
                        <td>{e.tool}</td>
                        <td>
                          <span className={`risk risk-${e.risk}`}>
                            {e.risk.replace("WRITE_IDEMPOTENT", "WRITE·I")}
                          </span>
                        </td>
                        <td>{e.device ?? "—"}</td>
                        <td className="num">{ms(e.durationMs)}</td>
                        <td>
                          <span className={e.isError ? "status-err" : "status-ok"}>
                            {e.isError ? "error" : "ok"}
                          </span>
                        </td>
                        <td className="preview">
                          {e.isError ? (e.error ?? "error") : e.output || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {selected && <DetailDrawer event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<App />);
