/**
 * Tests for the route finder: shortest path along the centreline between two
 * stations (single-source Dijkstra with predecessor tracking).
 */
import { describe, it, expect } from "vitest";
import {
  emptyLegFlags,
  emptyStationFlags,
  type CaveModel,
} from "../src/parser/index";
import { findRoute } from "../src/viewer/route";

/** Hand-built model: stations at coords, legs by station index. */
function model(
  coords: Array<[number, number, number]>,
  legs: Array<{ from: number; to: number; splay?: boolean }>,
): CaveModel {
  const stations: CaveModel["stations"] = coords.map(([x, y, z], id) => {
    const flags = emptyStationFlags();
    flags.underground = true;
    return { id, label: `s${id}`, x, y, z, flags };
  });
  return {
    metadata: {
      title: "t",
      format: "test",
      separator: ".",
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      isExtendedElevation: false,
    },
    stations,
    legs: legs.map(({ from, to, splay }) => {
      const flags = emptyLegFlags();
      if (splay) flags.splay = true;
      return { from, to, flags };
    }),
  };
}

describe("findRoute", () => {
  it("follows a chain of legs and sums their true lengths", () => {
    const m = model(
      [
        [0, 0, 0],
        [1, 0, 0], // 1 m from station 0
        [1, 2, 0], // 2 m from station 1
      ],
      [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
      ],
    );
    expect(findRoute(m, 0, 2)).toEqual({ stations: [0, 1, 2], lengthM: 3 });
  });

  it("picks the shorter way around a loop, traversing legs in either direction", () => {
    // Two ways from 0 to 1: via 2 (1 + 9 = 10 m) or via 3 (20 + ~22.4 m).
    // The 1->3 leg is oriented against the route, so both directions are used.
    const m = model(
      [
        [0, 0, 0],
        [10, 0, 0],
        [1, 0, 0],
        [0, 20, 0], // a long way round: 0 -> 3 -> 1
      ],
      [
        { from: 1, to: 3 }, // ~22.4 m (also: reversed orientation vs the route)
        { from: 3, to: 0 }, // 20 m
        { from: 0, to: 2 }, // 1 m
        { from: 2, to: 1 }, // 9 m
      ],
    );
    const route = findRoute(m, 0, 1)!;
    expect(route.stations).toEqual([0, 2, 1]);
    expect(route.lengthM).toBeCloseTo(10, 9);
  });

  it("ignores splay legs entirely", () => {
    const m = model(
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
      [{ from: 0, to: 1, splay: true }],
    );
    expect(findRoute(m, 0, 1)).toBeNull();
  });

  it("returns null for disconnected stations", () => {
    const m = model(
      [
        [0, 0, 0],
        [1, 0, 0],
        [5, 0, 0],
        [6, 0, 0],
      ],
      [
        { from: 0, to: 1 },
        { from: 2, to: 3 },
      ],
    );
    expect(findRoute(m, 0, 3)).toBeNull();
  });

  it("treats coordinate-coincident stations (cross-survey equates) as connected", () => {
    // Therion .lox writes an equated station once per survey: different ids and
    // names, identical coordinates, and no shot joining them. Stations 1 and 2
    // here are such a pair; the only way from 0 to 3 is through the equate.
    const m = model(
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 0], // coincides with station 1
        [3, 0, 0],
      ],
      [
        { from: 0, to: 1 }, // 1 m
        { from: 2, to: 3 }, // 2 m
      ],
    );
    const route = findRoute(m, 0, 3)!;
    expect(route).not.toBeNull();
    expect(route.lengthM).toBeCloseTo(3, 9);
  });

  it("returns a zero-length route from a station to itself", () => {
    const m = model([[0, 0, 0]], []);
    expect(findRoute(m, 0, 0)).toEqual({ stations: [0], lengthM: 0 });
  });

  it("returns null for out-of-range ids", () => {
    const m = model([[0, 0, 0]], []);
    expect(findRoute(m, 0, 5)).toBeNull();
    expect(findRoute(m, -1, 0)).toBeNull();
  });
});
