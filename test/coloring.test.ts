/**
 * Tests for the pure colour-mode logic, focusing on the entrance-distance graph
 * (multi-source Dijkstra over the leg network).
 */
import { describe, it, expect } from "vitest";
import {
  parseSurvex3d,
  emptyLegFlags,
  emptyStationFlags,
  type CaveModel,
} from "../src/parser/index";
import { entranceDistances, surveyColor } from "../src/viewer/coloring";
import { encode3d, toArrayBuffer } from "./helpers/encode3d";

function parse(bytes: Uint8Array) {
  return parseSurvex3d(toArrayBuffer(bytes));
}

describe("entranceDistances", () => {
  it("measures geodesic distance along legs from a flagged entrance", () => {
    // entrance(0,0,0) -1m-> a(0,1,0) -1m-> b(0,2,0); plus a 3m branch a->c.
    const model = parse(
      encode3d({
        items: [
          { t: "label", x: 0, y: 0, z: 0, name: "entrance", entrance: true, underground: true },
          { t: "label", x: 0, y: 100, z: 0, name: "a", underground: true },
          { t: "label", x: 0, y: 200, z: 0, name: "b", underground: true },
          { t: "label", x: 300, y: 100, z: 0, name: "c", underground: true },
          { t: "move", x: 0, y: 0, z: 0 },
          { t: "line", x: 0, y: 100, z: 0, survey: "main" },
          { t: "line", x: 0, y: 200, z: 0 },
          { t: "move", x: 0, y: 100, z: 0 },
          { t: "line", x: 300, y: 100, z: 0, survey: "main" }, // a -> c, 3 m east
        ],
      }),
    );
    const byLabel = new Map(model.stations.map((s) => [s.label, s.id]));
    const { distance, max } = entranceDistances(model);
    expect(distance[byLabel.get("entrance")!]).toBeCloseTo(0, 6);
    expect(distance[byLabel.get("a")!]).toBeCloseTo(1, 6);
    expect(distance[byLabel.get("b")!]).toBeCloseTo(2, 6);
    expect(distance[byLabel.get("c")!]).toBeCloseTo(4, 6); // 1 (entrance->a) + 3 (a->c)
    expect(max).toBeCloseTo(4, 6);
  });

  it("excludes splay legs from the distance graph", () => {
    const model = parse(
      encode3d({
        items: [
          { t: "label", x: 0, y: 0, z: 0, name: "e", entrance: true, underground: true },
          { t: "move", x: 0, y: 0, z: 0 },
          { t: "line", x: 0, y: 1000, z: 0, survey: "s", splay: true }, // splay only
        ],
      }),
    );
    const { distance } = entranceDistances(model);
    // The splay endpoint is unreachable through the (splay-excluded) graph.
    const splayEnd = model.stations.find((s) => s.y === 10)!;
    expect(distance[splayEnd.id]).toBe(Infinity);
  });

  it("crosses coordinate-coincident stations (cross-survey equates in .lox)", () => {
    // Therion .lox writes an equated station once per survey: stations 1 and 2
    // here share a point but no leg joins them. Distance must flow through.
    const mkStation = (id: number, x: number, y: number, entrance = false) => {
      const flags = emptyStationFlags();
      flags.underground = true;
      flags.entrance = entrance;
      return { id, label: `s${id}`, x, y, z: 0, flags };
    };
    const model: CaveModel = {
      metadata: {
        title: "t",
        format: "test",
        separator: ".",
        bounds: { min: [0, 0, 0], max: [3, 0, 0] },
        isExtendedElevation: false,
      },
      stations: [
        mkStation(0, 0, 0, true), // entrance
        mkStation(1, 1, 0),
        mkStation(2, 1, 0), // coincides with station 1
        mkStation(3, 3, 0),
      ],
      legs: [
        { from: 0, to: 1, flags: emptyLegFlags() }, // 1 m
        { from: 2, to: 3, flags: emptyLegFlags() }, // 2 m
      ],
    };
    const { distance, max } = entranceDistances(model);
    expect(distance[1]).toBeCloseTo(1, 6);
    expect(distance[2]).toBeCloseTo(1, 6); // the equate twin shares the distance
    expect(distance[3]).toBeCloseTo(3, 6);
    expect(max).toBeCloseTo(3, 6);
  });

  it("falls back to station 0 when no entrance or fixed station exists", () => {
    const model = parse(
      encode3d({
        items: [
          { t: "move", x: 0, y: 0, z: 0 },
          { t: "line", x: 0, y: 500, z: 0, survey: "s" },
        ],
      }),
    );
    const { distance, max } = entranceDistances(model);
    expect(distance[0]).toBe(0);
    expect(max).toBeCloseTo(5, 6);
  });

  it("gives stable, distinct colours per survey name", () => {
    expect(surveyColor("main")).toEqual(surveyColor("main"));
    expect(surveyColor("main")).not.toEqual(surveyColor("branch"));
  });
});
