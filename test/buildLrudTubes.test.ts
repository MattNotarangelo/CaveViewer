/**
 * Tests for LRUD -> passage-tube geometry reconstruction.
 */
import { describe, it, expect } from "vitest";
import {
  emptyLegFlags,
  emptyStationFlags,
  type CaveModel,
  type Leg,
  type Lrud,
  type Station,
} from "../src/parser/index";
import { buildLrudTubes } from "../src/viewer/buildLrudTubes";

const RING = 10; // must match buildLrudTubes

function station(id: number, x: number, y: number, z: number): Station {
  return { id, label: `s${id}`, x, y, z, flags: emptyStationFlags() };
}
function lrud(stationId: number, l: number, r: number, u: number, d: number): Lrud {
  return { station: stationId, l, r, u, d, lastInPassage: false };
}
function makeModel(stations: Station[], legs: Leg[], lruds: Lrud[]): CaveModel {
  return {
    metadata: {
      title: "t",
      format: "test",
      separator: ".",
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      isExtendedElevation: false,
    },
    stations,
    legs,
    lrud: lruds,
  };
}

function bounds(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

describe("buildLrudTubes", () => {
  it("lofts a tube along an east-bound leg with the LRUD cross-section", () => {
    // A->B 10 m east; LRUD L=2 R=3 U=4 D=1 at both ends.
    const leg: Leg = { from: 0, to: 1, flags: emptyLegFlags() };
    const model = makeModel(
      [station(0, 0, 0, 0), station(1, 10, 0, 0)],
      [leg],
      [lrud(0, 2, 3, 4, 1), lrud(1, 2, 3, 4, 1)],
    );
    const { positions, indices } = buildLrudTubes(model);

    // two rings of RING points; RING quads -> 2*RING triangles
    expect(positions.length).toBe(2 * RING * 3);
    expect(indices.length).toBe(2 * RING * 3);
    expect(Math.max(...indices)).toBeLessThan(2 * RING);

    const b = bounds(positions);
    // Cross-sections sit at the two stations along the tangent (x).
    expect(b.min[0]).toBeCloseTo(0, 6);
    expect(b.max[0]).toBeCloseTo(10, 6);
    // For an east-bound passage "right" is south (-y): right wall R=3 -> y=-3,
    // left wall L=2 -> y=+2 (both hit exactly at cos = +/-1).
    expect(b.min[1]).toBeCloseTo(-3, 6);
    expect(b.max[1]).toBeCloseTo(2, 6);
    // Up (U=4) and down (D=1) map to +/-z; sampled ring doesn't hit the exact
    // extreme, but must clearly extend up more than down.
    expect(b.max[2]).toBeGreaterThan(3);
    expect(b.max[2]).toBeLessThanOrEqual(4 + 1e-6);
    expect(b.min[2]).toBeLessThan(-0.5);
    expect(b.min[2]).toBeGreaterThanOrEqual(-1 - 1e-6);
  });

  it("skips legs lacking LRUD at either end", () => {
    const model = makeModel(
      [station(0, 0, 0, 0), station(1, 10, 0, 0)],
      [{ from: 0, to: 1, flags: emptyLegFlags() }],
      [lrud(0, 2, 3, 4, 1)], // only the from-station has LRUD
    );
    expect(buildLrudTubes(model).indices.length).toBe(0);
  });

  it("does not tube splay / surface / duplicate legs", () => {
    const splay = emptyLegFlags();
    splay.splay = true;
    const model = makeModel(
      [station(0, 0, 0, 0), station(1, 10, 0, 0)],
      [{ from: 0, to: 1, flags: splay }],
      [lrud(0, 2, 3, 4, 1), lrud(1, 2, 3, 4, 1)],
    );
    expect(buildLrudTubes(model).indices.length).toBe(0);
  });

  it("handles a vertical pitch without producing NaNs", () => {
    const model = makeModel(
      [station(0, 0, 0, 0), station(1, 0, 0, -20)], // straight down
      [{ from: 0, to: 1, flags: emptyLegFlags() }],
      [lrud(0, 1, 1, 1, 1), lrud(1, 1, 1, 1, 1)],
    );
    const { positions, indices } = buildLrudTubes(model);
    expect(indices.length).toBe(2 * RING * 3);
    expect([...positions].every((v) => Number.isFinite(v))).toBe(true);
  });
});
