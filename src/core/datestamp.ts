/**
 * Device-timezone date stamps for generated filenames.
 *
 * Backup/export filenames historically used the **MCP host's** clock
 * (`Date.now()`), which is wrong when the router lives in another timezone. This
 * module instead reads the device's own clock (`/system clock print`) and builds
 * a filename-safe stamp in the device's local time. As a small regional touch:
 * when the device timezone is Tehran (Iran), the date is rendered in the Persian
 * **Jalali** calendar; every other timezone uses the Gregorian calendar.
 *
 * The formatting helpers are pure (no device I/O) so they're unit-tested
 * directly; {@link deviceDateStamp} is the only function that talks to a device,
 * and it falls back to a host-UTC Gregorian stamp if the clock can't be read so
 * it never breaks the calling operation.
 */
import { executeMikrotikCommand } from "./connector";
import type { ToolContext } from "./context";
import { parseKeyValues } from "./routeros-parse";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** True when a RouterOS `time-zone-name` denotes Iran/Tehran. */
export function isTehran(tz: string | undefined): boolean {
  return !!tz && /tehran|iran/i.test(tz);
}

/**
 * Convert a Gregorian date to the Persian (Jalali) calendar. Standard
 * div/mod algorithm (jalaali-js), valid across the modern range.
 */
export function gregorianToJalali(
  gy: number,
  gm: number,
  gd: number,
): { jy: number; jm: number; jd: number } {
  const gDaysInMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const div = (a: number, b: number): number => Math.floor(a / b);
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    div(gy2 + 3, 4) -
    div(gy2 + 99, 100) +
    div(gy2 + 399, 400) +
    gd +
    gDaysInMonth[gm - 1];
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = days < 186 ? 1 + (days % 31) : 1 + ((days - 186) % 30);
  return { jy, jm, jd };
}

/** Parsed pieces of `/system clock print` we care about. */
export interface DeviceClock {
  /** ISO `YYYY-MM-DD` (Gregorian, as the device stores it), or undefined. */
  ymd?: string;
  /** `HH:MM` local time, or undefined. */
  hm?: string;
  /** RouterOS `time-zone-name`, e.g. `Asia/Tehran`. */
  tz?: string;
}

/** Normalise a RouterOS date (`2024-06-23` or `jun/23/2024`) to ISO `YYYY-MM-DD`. */
function normalizeDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Legacy RouterOS format: `jun/23/2024`.
  const legacy = raw.toLowerCase().match(/^([a-z]{3})\/(\d{1,2})\/(\d{4})$/);
  if (legacy) {
    const mi = MONTHS.indexOf(legacy[1]);
    if (mi >= 0) return `${legacy[3]}-${pad(mi + 1)}-${pad(Number(legacy[2]))}`;
  }
  return undefined;
}

/** Parse `/system clock print` output into {@link DeviceClock}. */
export function parseClock(output: string): DeviceClock {
  const kv = parseKeyValues(output);
  const ymd = normalizeDate(kv.date);
  const time = kv.time?.match(/^(\d{1,2}):(\d{2})/);
  const hm = time ? `${pad(Number(time[1]))}:${time[2]}` : undefined;
  return { ymd, hm, tz: kv["time-zone-name"] };
}

/**
 * Build a filename-safe stamp from an ISO date + `HH:MM` time + timezone.
 * Tehran → Jalali (`1403-04-02_1430`); everything else → Gregorian
 * (`2024-06-23_1430`). Returns "" when the date can't be parsed.
 */
export function buildStamp(ymd: string | undefined, hm: string | undefined, tz?: string): string {
  const parts = ymd?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return "";
  const [, ys, ms, ds] = parts;
  const hhmm = (hm ?? "00:00").replace(/[^\d]/g, "").slice(0, 4).padEnd(4, "0");
  if (isTehran(tz)) {
    const { jy, jm, jd } = gregorianToJalali(Number(ys), Number(ms), Number(ds));
    return `${jy}-${pad(jm)}-${pad(jd)}_${hhmm}`;
  }
  return `${ys}-${ms}-${ds}_${hhmm}`;
}

/** Host-UTC Gregorian fallback when the device clock can't be read. */
function hostStamp(now: Date): string {
  return (
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
    `_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`
  );
}

/**
 * Produce a date-time stamp in the device's local timezone (Jalali for Tehran,
 * Gregorian otherwise), for use in generated filenames/keys. Best-effort: any
 * failure reading the device clock degrades to a host-UTC Gregorian stamp.
 */
export async function deviceDateStamp(ctx: ToolContext): Promise<string> {
  try {
    const out = await executeMikrotikCommand("/system clock print", ctx);
    const clock = parseClock(out);
    const stamp = buildStamp(clock.ymd, clock.hm, clock.tz);
    if (stamp) return stamp;
  } catch {
    // fall through to the host clock
  }
  return hostStamp(new Date());
}
