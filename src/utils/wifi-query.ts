/**
 * Reusable RouterOS wireless/CAPsMAN read helpers.
 *
 * Resolves the wifi command family once per device (v7 `/interface wifi` →
 * `/interface wifiwave2` → legacy `/interface wireless` / `/caps-man`), then
 * fetches + normalises the pieces the CAPsMAN engine needs into a
 * {@link CapsmanState}. Device reads only; parsing is delegated to the engine's
 * pure `normalizeCapsmanState` so the wire→model mapping is unit-testable.
 */
import type { ToolContext } from "../core/context";
import type { CapsmanState } from "../core/capsman";
import type { CapsmanRaw, WifiPath } from "../core/capsman-normalize";
import { normalizeCapsmanState } from "../core/capsman-normalize";
import { commandUnsupported } from "../core/routeros";
import { fetchKv, fetchRows, safe } from "./safe-exec";

/** Candidate wifi command roots, newest first. */
const WIFI_PATHS = ["/interface wifi", "/interface wifiwave2", "/interface wireless"] as const;

/**
 * Detect the wireless command family this device speaks. Returns the v7 `wifi`
 * path when present, else `/caps-man` when the legacy controller exists, else the
 * legacy `/interface wireless`, else null (no wireless).
 */
export async function detectWifiPath(ctx: ToolContext): Promise<WifiPath | null> {
  for (const p of WIFI_PATHS) {
    const out = await safe(`${p} print count-only`, ctx);
    // `safe` returns "" on a device error; a real path prints a number (or nothing
    // meaningful but not an "unsupported" marker). Re-probe raw for the unsupported case.
    if (out !== "" && !commandUnsupported(out)) {
      if (p === "/interface wireless") {
        // Prefer the legacy controller path when it exists (that's where CAPsMAN lives on v6).
        const caps = await safe("/caps-man manager print", ctx);
        if (caps !== "" && !commandUnsupported(caps)) return "/caps-man";
      }
      return p;
    }
  }
  const caps = await safe("/caps-man manager print", ctx);
  if (caps !== "" && !commandUnsupported(caps)) return "/caps-man";
  return null;
}

export type { CapsmanRaw, WifiPath } from "../core/capsman-normalize";

/**
 * Fetch every CAPsMAN slice for a device and return a normalised
 * {@link CapsmanState}. Empty/unsupported slices degrade to empty — a device with
 * no wireless yields an empty state, never an error.
 */
export async function fetchCapsmanState(ctx: ToolContext): Promise<CapsmanState> {
  const path = await detectWifiPath(ctx);
  if (!path) return normalizeCapsmanState(null);

  const isCapsman = path === "/caps-man";
  const [manager, remoteCaps, radios, registrations, securityConfigs] = await Promise.all([
    fetchKv(isCapsman ? "/caps-man manager print" : `${path} capsman print`, ctx),
    fetchRows(
      isCapsman ? "/caps-man remote-cap print detail" : `${path} capsman remote-cap print detail`,
      ctx,
    ),
    fetchRows(isCapsman ? "/caps-man radio print detail" : `${path} radio print detail`, ctx),
    fetchRows(
      isCapsman
        ? "/caps-man registration-table print detail"
        : `${path} registration-table print detail`,
      ctx,
    ),
    fetchRows(isCapsman ? "/caps-man security print detail" : `${path} security print detail`, ctx),
  ]);

  const raw: CapsmanRaw = {
    path,
    manager,
    remoteCaps,
    radios,
    registrations,
    securityConfigs,
    resources: {},
  };
  return normalizeCapsmanState(raw);
}
