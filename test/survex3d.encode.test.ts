/**
 * Round-trip and edge-case tests using the from-spec encoder. These cover paths
 * the dump3ddate golden fixture does not exercise: labelled LINEs, splay/surface
 * flags, XSECT (narrow + wide), anonymous stations, ERROR records, CRS/separator
 * headers, extended-elevation, and error handling. The encoder mirrors the byte
 * layout the parser reads, so a faithful round-trip is a strong consistency check
 * (anchored to reality by the separate golden test).
 */
import { describe, it, expect } from "vitest";
import {
  parseSurvex3d,
  Survex3dParseError,
  parseCaveFile,
  UnsupportedFormatError,
  caveStats,
} from "../src/parser/index";
import { encode3d, toArrayBuffer } from "./helpers/encode3d";

function parse(bytes: Uint8Array) {
  return parseSurvex3d(toArrayBuffer(bytes));
}

describe("Survex .3d encoder round-trip", () => {
  it("parses a simple connected polyline with named stations", () => {
    // A 3-station traverse: O(0,0,0) -> A(10m,0,0) -> B(10m,5m,-2m).
    const model = parse(
      encode3d({
        title: "Test Cave",
        items: [
          { t: "label", x: 0, y: 0, z: 0, name: "0", underground: true, fixed: true },
          { t: "label", x: 1000, y: 0, z: 0, name: "1", underground: true },
          { t: "label", x: 1000, y: 500, z: -200, name: "2", underground: true },
          { t: "move", x: 0, y: 0, z: 0 },
          { t: "line", x: 1000, y: 0, z: 0, survey: "main" },
          { t: "line", x: 1000, y: 500, z: -200 }, // keep label
        ],
      }),
    );
    expect(model.metadata.title).toBe("Test Cave");
    expect(model.stations).toHaveLength(3);
    expect(model.legs).toHaveLength(2);

    const byLabel = new Map(model.stations.map((s) => [s.label, s]));
    expect(byLabel.get("0")!.flags.fixed).toBe(true);
    expect(byLabel.get("2")).toMatchObject({ x: 10, y: 5, z: -2 });

    expect(model.legs[0].survey).toBe("main");
    expect(model.legs[1].survey).toBe("main"); // inherited via 0x20 no-change bit

    const stats = caveStats(model);
    // 10m + sqrt(0^2 + 5^2 + 2^2) = 10 + 5.385...
    expect(stats.totalLengthM).toBeCloseTo(10 + Math.hypot(0, 5, 2), 6);
    expect(model.metadata.bounds.min).toEqual([0, 0, -2]);
    expect(model.metadata.bounds.max).toEqual([10, 5, 0]);
  });

  it("decodes leg flags (surface, duplicate, splay) and excludes them from length", () => {
    const model = parse(
      encode3d({
        items: [
          { t: "move", x: 0, y: 0, z: 0 },
          { t: "line", x: 100, y: 0, z: 0, survey: "s", splay: true },
          { t: "move", x: 0, y: 0, z: 0 },
          { t: "line", x: 0, y: 100, z: 0, surface: true },
          { t: "move", x: 0, y: 0, z: 0 },
          { t: "line", x: 0, y: 0, z: 100, duplicate: true },
          { t: "move", x: 0, y: 0, z: 0 },
          { t: "line", x: 200, y: 0, z: 0 }, // a real 2m leg
        ],
      }),
    );
    const flags = model.legs.map((l) => l.flags);
    expect(flags[0].splay).toBe(true);
    expect(flags[1].surface).toBe(true);
    expect(flags[2].duplicate).toBe(true);
    const stats = caveStats(model);
    expect(stats.totalLengthM).toBeCloseTo(2, 6); // only the last leg counts
    expect(stats.totalLengthAllM).toBeCloseTo(1 + 1 + 1 + 2, 6);
  });

  it("round-trips XSECT cross-sections (narrow and wide), with omitted dims", () => {
    const model = parse(
      encode3d({
        items: [
          { t: "label", x: 0, y: 0, z: 0, name: "p1", underground: true },
          { t: "label", x: 0, y: 1000, z: 0, name: "p2", underground: true },
          { t: "xsect", name: "p1", l: 150, r: 250, u: 100, d: null },
          { t: "xsect", name: "p2", l: 9000, r: 9000, u: 9000, d: 9000, wide: true, last: true },
        ],
      }),
    );
    expect(model.lrud).toBeDefined();
    const lrud = model.lrud!;
    expect(lrud).toHaveLength(2);
    const p1 = lrud.find((x) => model.stations[x.station].label === "p1")!;
    expect(p1).toMatchObject({ l: 1.5, r: 2.5, u: 1.0, d: null });
    const p2 = lrud.find((x) => model.stations[x.station].label === "p2")!;
    expect(p2).toMatchObject({ l: 90, r: 90, u: 90, d: 90, lastInPassage: true });
  });

  it("flags anonymous stations and parses CRS + custom separator + extended elevation", () => {
    const model = parse(
      encode3d({
        title: "Deep System",
        crs: "EPSG:27700",
        separator: "/",
        extendedElevation: true,
        items: [
          { t: "label", x: 0, y: 0, z: 0, name: "anon", anonymous: true, underground: true },
        ],
      }),
    );
    expect(model.metadata.crs).toBe("EPSG:27700");
    expect(model.metadata.separator).toBe("/");
    expect(model.metadata.isExtendedElevation).toBe(true);
    expect(model.stations[0].flags.anonymous).toBe(true);
  });

  it("skips ERROR records and DATE ranges without desyncing", () => {
    const model = parse(
      encode3d({
        items: [
          { t: "date-range", days1: 100, days2: 200 },
          { t: "move", x: 0, y: 0, z: 0 },
          { t: "line", x: 0, y: 500, z: 0, survey: "x" },
          { t: "label", x: 0, y: 500, z: 0, name: "end", underground: true },
        ],
      }),
    );
    expect(model.legs).toHaveLength(1);
    expect(model.legs[0].date).toEqual({ from: "1900-04-11", to: "1900-07-20" });
    expect(model.stations.find((s) => s.label === "end")).toBeDefined();
  });

  it("handles an unchanged label (del=0, add=0) via the extended escape form", () => {
    // An XSECT immediately after the LABEL that names the same station produces
    // a (0,0) delta, which MUST use the 0x00 escape (not a bare 0x00 byte).
    const model = parse(
      encode3d({
        items: [
          { t: "label", x: 0, y: 0, z: 0, name: "p", underground: true },
          { t: "xsect", name: "p", l: 100, r: 100, u: 100, d: 100 },
          { t: "label", x: 0, y: 100, z: 0, name: "q", underground: true },
        ],
      }),
    );
    expect(model.stations.map((s) => s.label).sort()).toEqual(["p", "q"]);
    expect(model.lrud).toHaveLength(1);
    expect(model.lrud![0]).toMatchObject({ l: 1, r: 1, u: 1, d: 1 });
  });

  it("rejects unsupported files and bad magic / unsupported versions", () => {
    expect(() => parseCaveFile("cave.lox", new ArrayBuffer(0))).toThrow(UnsupportedFormatError);

    const notSurvex = new TextEncoder().encode("hello world\n");
    expect(() => parse(notSurvex)).toThrow(Survex3dParseError);

    const v7 = new TextEncoder().encode("Survex 3D Image File\nv7\nt\n@0\n");
    expect(() => parse(v7)).toThrow(/version v7/);
  });
});
