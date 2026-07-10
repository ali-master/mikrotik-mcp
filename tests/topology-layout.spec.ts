/**
 * The topology radar's layout is pure geometry with two things worth pinning:
 * it must be deterministic (a jittering map is unusable), and the angular
 * relaxation must actually separate neighbours that start on the same bearing
 * — including the pathological case where two are exactly coincident, which the
 * repulsion term divides by.
 */
import { describe, expect, test } from "vite-plus/test";
import { arcDash, CX, CY, HUB_ID, layout } from "../ui/observability/topology-layout";

const dev = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `dev${i}` }));
const nbr = (n: number, parent: string) => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `nb${i}` })),
  parents: new Map(Array.from({ length: n }, (_, i) => [`nb${i}`, parent])),
});

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("topology layout", () => {
  test("puts the hub at the centre", () => {
    const { pos } = layout(dev(3), [], new Map());
    expect(pos.get(HUB_ID)).toEqual({ x: CX, y: CY });
  });

  test("a lone device sits off the hub, not on it", () => {
    const { pos } = layout(dev(1), [], new Map());
    const d = pos.get("dev0")!;
    expect(dist(d, { x: CX, y: CY })).toBeGreaterThan(50);
  });

  test("devices are spread evenly around the ring", () => {
    const { pos, rInner } = layout(dev(4), [], new Map());
    for (let i = 0; i < 4; i++) {
      expect(dist(pos.get(`dev${i}`)!, { x: CX, y: CY })).toBeCloseTo(rInner, 5);
    }
    // Opposite devices on a 4-way split must be on opposite sides.
    expect(dist(pos.get("dev0")!, pos.get("dev2")!)).toBeCloseTo(rInner * 2, 4);
  });

  test("is deterministic — identical inputs give identical output", () => {
    const { nodes, parents } = nbr(9, "dev0");
    const a = layout(dev(2), nodes, parents);
    const b = layout(dev(2), nodes, parents);
    for (const [id, p] of a.pos) expect(b.pos.get(id)).toEqual(p);
  });

  /** Every neighbour of one device starts on the same bearing; relaxation fans them. */
  test("separates neighbours that share a parent", () => {
    const { nodes, parents } = nbr(8, "dev0");
    const { pos } = layout(dev(3), nodes, parents);
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        expect(dist(pos.get(`nb${i}`)!, pos.get(`nb${j}`)!)).toBeGreaterThan(8);
      }
    }
  });

  test("produces finite coordinates even when neighbours coincide exactly", () => {
    // Two neighbours, same parent, seeded at k=0 → identical starting angle for
    // the first pair; the tie-break must keep the repulsion term finite.
    const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const parents = new Map([
      ["a", "dev0"],
      ["b", "dev0"],
      ["c", "dev0"],
    ]);
    const { pos } = layout(dev(1), nodes, parents);
    for (const id of ["a", "b", "c"]) {
      const p = pos.get(id)!;
      expect(Number.isFinite(p.x), `${id}.x`).toBe(true);
      expect(Number.isFinite(p.y), `${id}.y`).toBe(true);
    }
  });

  test("orphan neighbours (no parent device) still get a position", () => {
    const { pos } = layout([], [{ id: "lonely" }], new Map());
    const p = pos.get("lonely")!;
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  describe("arcDash", () => {
    const len = (r: number): number => 2 * Math.PI * r;

    test("0% paints nothing, 100% paints the whole circle", () => {
      expect(arcDash(10, 0).startsWith("0 ")).toBe(true);
      const [on] = arcDash(10, 100).split(" ").map(Number);
      expect(on).toBeCloseTo(len(10), 5);
    });

    test("clamps out-of-range and undefined metrics", () => {
      expect(arcDash(10, -20)).toBe(arcDash(10, 0));
      expect(arcDash(10, 150)).toBe(arcDash(10, 100));
      expect(arcDash(10, undefined)).toBe(arcDash(10, 0));
    });

    test("half is half", () => {
      const [on] = arcDash(20, 50).split(" ").map(Number);
      expect(on).toBeCloseTo(len(20) / 2, 5);
    });
  });
});
