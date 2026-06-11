/**
 * Round-trip tests for the PocketTopo `.top` parser using the from-spec encoder.
 * Unlike the processed formats (.3d/.plt/.lox), `.top` stores RAW shot
 * measurements (distance/azimuth/inclination), so these tests verify the
 * parser's coordinate propagation: declination, repeated-shot averaging,
 * splays, reference anchoring, and multi-component handling.
 */
import { describe, it, expect } from "vitest";
import {
  parsePocketTopo,
  PocketTopoParseError,
  parseCaveFile,
  caveStats,
} from "../src/parser/index";
import { encodeTop, toArrayBuffer } from "./helpers/encodeTop";
import type { EncodeTopOptions } from "./helpers/encodeTop";

function parse(opts: EncodeTopOptions) {
  return parsePocketTopo(toArrayBuffer(encodeTop(opts)));
}

function byLabel(model: ReturnType<typeof parse>) {
  return new Map(model.stations.map((s) => [s.label, s]));
}

describe("PocketTopo .top encoder round-trip", () => {
  it("propagates a simple traverse from the origin", () => {
    // 1.0 --10m east--> 1.1 --10m north at +30 deg--> 1.2
    const model = parse({
      shots: [
        { from: "1.0", to: "1.1", distM: 10, azimuthDeg: 90, inclinationDeg: 0 },
        { from: "1.1", to: "1.2", distM: 10, azimuthDeg: 0, inclinationDeg: 30 },
      ],
    });
    expect(model.metadata.format).toBe("pockettopo-top");
    expect(model.stations).toHaveLength(3);
    expect(model.legs).toHaveLength(2);

    const s = byLabel(model);
    expect(s.get("1.0")).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(s.get("1.1")!.x).toBeCloseTo(10, 3);
    expect(s.get("1.1")!.y).toBeCloseTo(0, 3);
    expect(s.get("1.1")!.z).toBeCloseTo(0, 3);
    expect(s.get("1.2")!.x).toBeCloseTo(10, 3);
    expect(s.get("1.2")!.y).toBeCloseTo(10 * Math.cos(Math.PI / 6), 2);
    expect(s.get("1.2")!.z).toBeCloseTo(5, 2);

    expect(model.legs[0].survey).toBe("1");
    const stats = caveStats(model);
    expect(stats.totalLengthM).toBeCloseTo(20, 3);
    expect(model.metadata.bounds.min[0]).toBe(0);
    expect(model.metadata.bounds.max[0]).toBeCloseTo(10, 3);
  });

  it("applies the trip declination to azimuths", () => {
    const model = parse({
      trips: [{ date: { y: 2015, m: 6, d: 7 }, declinationDeg: 10 }],
      shots: [
        { from: "1.0", to: "1.1", distM: 10, azimuthDeg: 90, inclinationDeg: 0, tripIndex: 0 },
      ],
    });
    const s = byLabel(model);
    const az = (100 * Math.PI) / 180; // 90 magnetic + 10 declination
    expect(s.get("1.1")!.x).toBeCloseTo(10 * Math.sin(az), 2);
    expect(s.get("1.1")!.y).toBeCloseTo(10 * Math.cos(az), 2);
  });

  it("averages consecutive repeated shots into one leg", () => {
    const model = parse({
      shots: [
        { from: "1.0", to: "1.1", distM: 10, azimuthDeg: 90, inclinationDeg: 0 },
        { from: "1.0", to: "1.1", distM: 10.2, azimuthDeg: 90, inclinationDeg: 0 },
      ],
    });
    expect(model.legs).toHaveLength(1);
    expect(byLabel(model).get("1.1")!.x).toBeCloseTo(10.1, 3);
  });

  it("turns shots with an undefined target into splays with anonymous endpoints", () => {
    const model = parse({
      shots: [
        { from: "1.0", to: "1.1", distM: 10, azimuthDeg: 90, inclinationDeg: 0 },
        { from: "1.0", distM: 2, azimuthDeg: 0, inclinationDeg: 0 },
      ],
    });
    expect(model.legs).toHaveLength(2);
    const splay = model.legs.find((l) => l.flags.splay)!;
    expect(splay).toBeDefined();
    const end = model.stations[splay.to];
    expect(end.flags.anonymous).toBe(true);
    expect(end.label).toBe("");
    expect(end.y).toBeCloseTo(2, 3);
    expect(caveStats(model).totalLengthM).toBeCloseTo(10, 3); // splay excluded
  });

  it("skips zero-length splays and fully-undefined shots", () => {
    const model = parse({
      shots: [
        { from: "1.0", to: "1.1", distM: 10, azimuthDeg: 90, inclinationDeg: 0 },
        { from: "1.0", distM: 0, azimuthDeg: 0, inclinationDeg: 0 }, // comment-only row
        { distM: 3, azimuthDeg: 0, inclinationDeg: 0 }, // no stations at all
      ],
    });
    expect(model.legs).toHaveLength(1);
    expect(model.stations).toHaveLength(2);
  });

  it("anchors the survey at a reference point and flags it fixed", () => {
    const model = parse({
      shots: [{ from: "1.0", to: "1.1", distM: 10, azimuthDeg: 90, inclinationDeg: 0 }],
      references: [{ station: "1.0", eastM: 500000, northM: 4500000, altitudeM: 1200 }],
    });
    const s = byLabel(model);
    expect(s.get("1.0")).toMatchObject({ x: 500000, y: 4500000, z: 1200 });
    expect(s.get("1.0")!.flags.fixed).toBe(true);
    expect(s.get("1.1")!.x).toBeCloseTo(500010, 3);
    expect(s.get("1.1")!.y).toBeCloseTo(4500000, 2);
  });

  it("carries the trip date onto legs and the metadata date range", () => {
    const model = parse({
      trips: [
        { date: { y: 2015, m: 6, d: 7 } },
        { date: { y: 2016, m: 1, d: 2 }, comment: "Second trip" },
      ],
      shots: [
        { from: "1.0", to: "1.1", distM: 10, azimuthDeg: 0, inclinationDeg: 0, tripIndex: 0 },
        { from: "1.1", to: "1.2", distM: 10, azimuthDeg: 0, inclinationDeg: 0, tripIndex: 1 },
        { from: "1.2", to: "1.3", distM: 10, azimuthDeg: 0, inclinationDeg: 0 }, // no trip
      ],
    });
    expect(model.legs[0].date).toEqual({ from: "2015-06-07", to: "2015-06-07" });
    expect(model.legs[1].date).toEqual({ from: "2016-01-02", to: "2016-01-02" });
    expect(model.legs[2].date).toBeUndefined();
    expect(model.metadata.dateRange).toEqual({ from: "2015-06-07", to: "2016-01-02" });
  });

  it("uses the first trip comment as the title", () => {
    const model = parse({
      trips: [{ date: { y: 2020, m: 3, d: 14 }, comment: "Example Cave" }],
      shots: [{ from: "1.0", to: "1.1", distM: 5, azimuthDeg: 0, inclinationDeg: 0, tripIndex: 0 }],
    });
    expect(model.metadata.title).toBe("Example Cave");
  });

  it("decodes plain-number station ids", () => {
    const model = parse({
      shots: [{ from: "0", to: "1", distM: 5, azimuthDeg: 0, inclinationDeg: 0 }],
    });
    const labels = model.stations.map((s) => s.label).sort();
    expect(labels).toEqual(["0", "1"]);
    expect(model.legs[0].survey).toBeUndefined();
  });

  it("stays aligned across shots with comments and flip flags", () => {
    const model = parse({
      shots: [
        {
          from: "1.0",
          to: "1.1",
          distM: 10,
          azimuthDeg: 90,
          inclinationDeg: 0,
          comment: "wet crawl",
          flip: true,
        },
        { from: "1.1", to: "1.2", distM: 5, azimuthDeg: 90, inclinationDeg: 0 },
      ],
    });
    expect(model.legs).toHaveLength(2);
    expect(byLabel(model).get("1.2")!.x).toBeCloseTo(15, 3);
  });

  it("positions disconnected components without losing stations", () => {
    const model = parse({
      shots: [
        { from: "1.0", to: "1.1", distM: 10, azimuthDeg: 90, inclinationDeg: 0 },
        { from: "5.0", to: "5.1", distM: 4, azimuthDeg: 0, inclinationDeg: 0 },
      ],
    });
    expect(model.stations).toHaveLength(4);
    for (const s of model.stations) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
      expect(Number.isFinite(s.z)).toBe(true);
    }
  });

  it("handles negative inclinations (downward shots)", () => {
    const model = parse({
      shots: [{ from: "1.0", to: "1.1", distM: 10, azimuthDeg: 0, inclinationDeg: -90 }],
    });
    expect(byLabel(model).get("1.1")!.z).toBeCloseTo(-10, 2);
  });

  it("parses an empty file", () => {
    const model = parse({});
    expect(model.stations).toHaveLength(0);
    expect(model.legs).toHaveLength(0);
  });

  it("tolerates a file truncated after the references", () => {
    const model = parse({
      shots: [{ from: "1.0", to: "1.1", distM: 10, azimuthDeg: 0, inclinationDeg: 0 }],
      omitDrawings: true,
    });
    expect(model.legs).toHaveLength(1);
  });

  it("rejects a bad magic and unsupported versions", () => {
    expect(() => parse({ magic: "Foo" })).toThrow(PocketTopoParseError);
    expect(() => parse({ version: 2 })).toThrow(PocketTopoParseError);
    expect(() => parse({ version: 2 })).toThrow(/version/i);
  });

  it("rejects a truncated shot record", () => {
    const bytes = encodeTop({
      shots: [{ from: "1.0", to: "1.1", distM: 10, azimuthDeg: 0, inclinationDeg: 0 }],
    });
    expect(() => parsePocketTopo(toArrayBuffer(bytes.subarray(0, 20)))).toThrow(
      PocketTopoParseError,
    );
  });

  it("is dispatched by parseCaveFile for .top files", () => {
    const bytes = encodeTop({
      shots: [{ from: "1.0", to: "1.1", distM: 10, azimuthDeg: 0, inclinationDeg: 0 }],
    });
    const model = parseCaveFile("cave.top", toArrayBuffer(bytes));
    expect(model.metadata.format).toBe("pockettopo-top");
  });
});
