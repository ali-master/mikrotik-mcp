/**
 * Radial layout for the topology radar. Pure geometry — no React, no DOM — so it
 * can be exercised offline by `tests/topology-layout.spec.ts`.
 *
 * Devices take an even split of the circle around the hub. Each neighbour starts
 * on its parent device's bearing and is then relaxed: repelled by every other
 * neighbour, and sprung back toward that bearing. Ten iterations is plenty —
 * this is a fan-out, not a physics demo — and there is deliberately no
 * randomness, so the map is stable across renders rather than jittering.
 */

export interface Pt {
  x: number;
  y: number;
}

/** The subset of `TopoNode` the layout needs. */
export interface LayoutNode {
  id: string;
}

/** Sentinel id for the hub; a leading space cannot collide with a RouterOS identity. */
export const HUB_ID = " hub";

export const W = 900;
export const H = 620;
export const CX = W / 2;
export const CY = H / 2;

/** Wrap an angle into (-π, π] so a crossing at ±π doesn't fling nodes apart. */
function wrap(a: number): number {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function layout(
  devices: LayoutNode[],
  neighbors: LayoutNode[],
  parentOf: Map<string, string>,
): { pos: Map<string, Pt>; rInner: number; rOuter: number } {
  const pos = new Map<string, Pt>();
  const ang = new Map<string, number>();
  pos.set(HUB_ID, { x: CX, y: CY });

  const rInner = devices.length <= 1 ? 110 : Math.min(170, 96 + devices.length * 7);
  const rOuter = rInner + (devices.length <= 1 ? 190 : 155);

  devices.forEach((d, i) => {
    // A lone device would otherwise land on the hub, so it takes 12 o'clock.
    const a =
      devices.length === 1 ? -Math.PI / 2 : (i / devices.length) * Math.PI * 2 - Math.PI / 2;
    ang.set(d.id, a);
    pos.set(d.id, { x: CX + rInner * Math.cos(a), y: CY + rInner * Math.sin(a) });
  });

  // Seed each neighbour on its parent's bearing, fanned alternately above/below.
  const seen = new Map<string, number>();
  const angles = new Map<string, number>();
  for (const nb of neighbors) {
    const p = parentOf.get(nb.id) ?? "";
    const base = ang.get(p) ?? -Math.PI / 2;
    const k = seen.get(p) ?? 0;
    seen.set(p, k + 1);
    angles.set(nb.id, base + Math.ceil(k / 2) * (k % 2 === 0 ? 1 : -1) * 0.34);
  }

  const REPEL = 2600;
  for (let iter = 0; iter < 10; iter++) {
    for (const a of neighbors) {
      let push = 0;
      for (const b of neighbors) {
        if (a.id === b.id) continue;
        const d = wrap((angles.get(a.id) ?? 0) - (angles.get(b.id) ?? 0));
        const dist = Math.abs(d) * rOuter;
        if (dist < 1) {
          // Exactly coincident: break the tie deterministically by id.
          push += a.id < b.id ? 0.02 : -0.02;
        } else if (dist < 120) {
          push += (Math.sign(d) * REPEL) / (dist * dist * rOuter);
        }
      }
      const base = ang.get(parentOf.get(a.id) ?? "") ?? -Math.PI / 2;
      const toParent = wrap(base - (angles.get(a.id) ?? 0));
      angles.set(a.id, (angles.get(a.id) ?? 0) + push + toParent * 0.06);
    }
  }
  for (const nb of neighbors) {
    const a = angles.get(nb.id) ?? 0;
    pos.set(nb.id, { x: CX + rOuter * Math.cos(a), y: CY + rOuter * Math.sin(a) });
  }
  return { pos, rInner, rOuter };
}

/** Dash pattern painting `pct` of a circle of radius `r` (start it at 12 o'clock). */
export function arcDash(r: number, pct: number | undefined): string {
  const len = 2 * Math.PI * r;
  const on = (Math.min(100, Math.max(0, pct ?? 0)) / 100) * len;
  return `${on} ${len - on}`;
}
