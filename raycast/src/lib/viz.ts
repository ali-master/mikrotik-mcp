/**
 * Native chart substitutes — the Raycast UI kit has no chart library, so the
 * dashboard's Recharts/SVG visuals map to these primitives:
 *   • time series / metric history → unicode `sparkline()`
 *   • CPU/MEM/DISK radial gauges    → `gaugeIcon()` (getProgressIcon)
 *   • inline proportions            → `bar()` text bars
 * Keeping them in one module means fidelity is consistent across every view.
 */
import { getProgressIcon } from "@raycast/utils";
import type { Color, Image } from "@raycast/api";

const TICKS = "▁▂▃▄▅▆▇█";

/** A compact unicode sparkline of a numeric series. Non-finite points render as spaces. */
export function sparkline(
  values: number[],
  opts?: { min?: number; max?: number },
): string {
  const finite = values.filter((n) => Number.isFinite(n));
  if (finite.length === 0) return "";
  const min = opts?.min ?? Math.min(...finite);
  const max = opts?.max ?? Math.max(...finite);
  const span = max - min || 1;
  return values
    .map((n) => {
      if (!Number.isFinite(n)) return " ";
      const idx = Math.round(((n - min) / span) * (TICKS.length - 1));
      return TICKS[Math.max(0, Math.min(TICKS.length - 1, idx))];
    })
    .join("");
}

/** A radial gauge icon for a 0..100 percentage (clamped). */
export function gaugeIcon(
  pct: number,
  color?: Color | string,
): Image.ImageLike {
  const p = Math.max(0, Math.min(1, pct / 100));
  return getProgressIcon(p, color);
}

/** A text progress bar (█ filled / ░ empty) for a 0..100 percentage. */
export function bar(pct: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}
