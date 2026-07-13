/**
 * Pure wire→model normaliser for the CAPsMAN engine.
 *
 * Maps already-parsed RouterOS `print detail` rows (from `src/utils/wifi-query`)
 * into a {@link CapsmanState}. Kept in core + pure so the mapping is unit-tested
 * without a device, and so `capsman.ts` never depends on the utils layer.
 * Tolerant of both the v7 `/interface wifi` and legacy `/caps-man` field names,
 * and of missing fields (everything degrades to a sane default).
 */
import { emptyCapsmanState, parseFloorTag } from "./capsman";
import type {
  Band,
  CapsmanState,
  WifiAccessListEntry,
  WifiClient,
  WifiSecurityConfig,
} from "./capsman";

export type WifiPath =
  | "/interface wifi"
  | "/interface wifiwave2"
  | "/interface wireless"
  | "/caps-man";

/** Raw device slices the normaliser consumes (rows already parsed to maps). */
export interface CapsmanRaw {
  path: WifiPath;
  manager: Record<string, string>;
  remoteCaps: Record<string, string>[];
  radios: Record<string, string>[];
  registrations: Record<string, string>[];
  securityConfigs: Record<string, string>[];
  accessList: Record<string, string>[];
  /** Per-CAP resources keyed by CAP identity/name (percent). */
  resources: Record<string, { cpuLoad?: number; memUsedPct?: number }>;
}

function yes(v: string | undefined): boolean {
  return (v ?? "").trim().toLowerCase() === "yes" || (v ?? "").trim().toLowerCase() === "true";
}

function num(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number.parseFloat(v.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** Map a RouterOS band/frequency string to a band. */
export function bandFromRow(row: Record<string, string>): Band {
  const b = (row.band ?? row["configuration.mode"] ?? "").toLowerCase();
  if (b.includes("2ghz") || b.includes("2.4")) return "2ghz";
  if (b.includes("5ghz") || b.includes("5.")) return "5ghz";
  const ch = num(row.channel ?? row.frequency ?? row["channel.frequency"]);
  if (ch != null) {
    if (ch >= 5000 || (ch >= 36 && ch <= 177)) return "5ghz";
    if ((ch >= 2400 && ch <= 2500) || (ch >= 1 && ch <= 14)) return "2ghz";
  }
  return "unknown";
}

/** Extract the numeric channel/frequency from a radio or channel row. */
function channelOf(row: Record<string, string>): number | undefined {
  return num(row.channel ?? row.frequency ?? row["channel.frequency"]);
}

/**
 * Normalise raw device slices into a {@link CapsmanState}. `null` (no wireless)
 * yields an empty controller state.
 */
export function normalizeCapsmanState(raw: CapsmanRaw | null): CapsmanState {
  if (!raw) return emptyCapsmanState();

  // Radios: one per remote-cap radio; carry floor/zone from CAP identity/comment.
  const clientsByRadio = new Map<string, number>();
  for (const r of raw.registrations) {
    const rid = r.interface ?? r.radio ?? r.ap ?? "";
    if (rid) clientsByRadio.set(rid, (clientsByRadio.get(rid) ?? 0) + 1);
  }

  const radios = raw.radios.map((row) => {
    const cap = row["remote-cap-identity"] ?? row.identity ?? row["cap-name"] ?? row.name ?? "?";
    const radioId = row.interface ?? row.name ?? row["radio-mac"] ?? cap;
    const tag = parseFloorTag(`${cap} ${row.comment ?? ""}`);
    const res = raw.resources[cap] ?? {};
    return {
      cap,
      radioId,
      band: bandFromRow(row),
      channel: channelOf(row),
      width: row.width ?? row["channel.width"],
      txPower: num(row["tx-power"] ?? row["tx-power-dbm"]),
      clientCount: clientsByRadio.get(radioId) ?? num(row["registered-clients"]) ?? 0,
      floor: tag.floor,
      zone: tag.zone,
      cpuLoad: res.cpuLoad,
      memUsedPct: res.memUsedPct,
    };
  });

  const radioBand = new Map(radios.map((r) => [r.radioId, r.band]));

  const clients: WifiClient[] = raw.registrations.map((r) => {
    const radioId = r.interface ?? r.radio ?? r.ap ?? "";
    return {
      mac: r["mac-address"] ?? r.mac ?? "?",
      radioId,
      signal: num(r.signal ?? r["signal-strength"] ?? r["rx-signal"]) ?? -100,
      band: radioBand.get(radioId) ?? "unknown",
      txRate: r["tx-rate"],
      rxRate: r["rx-rate"],
      uptime: r.uptime,
      seenOn: undefined,
    };
  });

  const securityConfigs: WifiSecurityConfig[] = raw.securityConfigs.map((c) => ({
    name: c.name ?? "?",
    ssid: c.ssid ?? c["configuration.ssid"],
    ft: yes(c.ft),
    ftOverDs: yes(c["ft-over-ds"]),
    ftMobilityDomain: c["ft-mobility-domain"] || undefined,
    rrm: yes(c.rrm ?? c["steering.rrm"]),
    wnm: yes(c.wnm ?? c["steering.wnm"]),
  }));

  const accessList: WifiAccessListEntry[] = (raw.accessList ?? []).map((e) => ({
    macAddress: e["mac-address"] ?? e.mac,
    interface: e.interface,
    comment: e.comment,
  }));

  const managerEnabled = yes(raw.manager.enabled);
  // "backup manager" heuristic: more than one caps-man-address configured, or an
  // explicit backup flag/second manager row.
  const addrs = (raw.manager["caps-man-addresses"] ?? raw.manager["caps-man-names"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const managerCount = Math.max(managerEnabled ? 1 : 0, addrs.length);

  return {
    managerEnabled,
    managerCount,
    capsHaveBackupManager: addrs.length > 1,
    requirePeerCertificate: yes(raw.manager["require-peer-certificate"]),
    radios,
    clients,
    securityConfigs,
    accessList,
    path: raw.path,
  };
}
