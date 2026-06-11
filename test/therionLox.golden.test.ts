/**
 * Tests for the Therion `.lox` parser.
 *
 * 1. Cross-format golden test: parse a REAL `.lox` and the SAME cave's `.3d`,
 *    and assert they agree (station count, leg count, bounds). The `.3d` parser
 *    is independently validated against survex's `dump3d`, so this anchors the
 *    `.lox` coordinate decoding to reality. Fixtures: see fixtures/therion.
 * 2. Synthetic test: a hand-built minimal `.lox` exercises the wall-mesh
 *    (scrap) path, station/leg flags, and survey-path labels precisely — the
 *    parts a centreline-only real fixture can't cover.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseSurvex3d, parseTherionLox } from "../src/parser/index";

function fixtureBuffer(name: string): ArrayBuffer {
  const buf = readFileSync(new URL(`./fixtures/therion/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function stationBounds(m: { stations: { x: number; y: number; z: number }[] }): number[] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const s of m.stations) {
    [s.x, s.y, s.z].forEach((v, i) => {
      if (v < min[i]) min[i] = v;
      if (v > max[i]) max[i] = v;
    });
  }
  return [...min, ...max].map((n) => +n.toFixed(3));
}

describe("Therion .lox — cross-format golden test vs the same cave's .3d", () => {
  const lox = parseTherionLox(fixtureBuffer("ResurgenceDeLAvenir.lox"));
  const threeD = parseSurvex3d(fixtureBuffer("ResurgenceDeLAvenir.3d"));

  it("reports the therion-lox format", () => {
    expect(lox.metadata.format).toBe("therion-lox");
  });

  it("decodes the same station/leg counts as the .3d", () => {
    expect(lox.stations.length).toBe(threeD.stations.length);
    expect(lox.legs.length).toBe(threeD.legs.length);
  });

  it("decodes the same coordinates (identical bounds) as the trusted .3d parser", () => {
    expect(stationBounds(lox)).toEqual(stationBounds(threeD));
  });

  it('keeps stations whose given name merely ends in "." (e.g. "9.") named', () => {
    // "S1.9." is a real named station in this dataset — the .3d agrees — and
    // must not be confused with Therion's "." anonymous-point convention.
    const odd = lox.stations.find((s) => s.label === "ResurgenceDeLAvenir.S1.9.");
    expect(odd).toBeDefined();
    expect(odd!.flags.anonymous).toBe(false);
  });
});

// --- Minimal hand-built .lox (little-endian), field order per lxFile.cxx Load() ---
const u32 = (n: number): number[] => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return [...b];
};
const f64 = (n: number): number[] => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n, true);
  return [...b];
};
const ascii = (s: string): number[] => [...new TextEncoder().encode(s)];
const chunk = (type: number, recs: number[], recCount: number, data: number[]): number[] => [
  ...u32(type),
  ...u32(recs.length),
  ...u32(recCount),
  ...u32(data.length),
  ...recs,
  ...data,
];

function buildSyntheticLox(): ArrayBuffer {
  // SURVEY: id, namePtr{pos,size}, parent, titlePtr{pos,size}; data = "cave"+"Test Cave"
  const survey = chunk(
    1,
    [...u32(0), ...u32(0), ...u32(4), ...u32(0), ...u32(4), ...u32(9)],
    1,
    ascii("caveTest Cave"),
  );
  // STATION: id, surveyId, namePtr{pos,size}, commentPtr{pos,size}, flags, x,y,z; data="ab"
  const stA = [...u32(0), ...u32(0), ...u32(0), ...u32(1), ...u32(0), ...u32(0), ...u32(2), ...f64(0), ...f64(0), ...f64(0)];
  const stB = [...u32(1), ...u32(0), ...u32(1), ...u32(1), ...u32(0), ...u32(0), ...u32(16), ...f64(10), ...f64(0), ...f64(-2)];
  // stC is named "." — Therion's anonymous splay/wall-point convention.
  const stC = [...u32(2), ...u32(0), ...u32(2), ...u32(1), ...u32(0), ...u32(0), ...u32(0), ...f64(1), ...f64(1), ...f64(1)];
  const station = chunk(2, [...stA, ...stB, ...stC], 3, ascii("ab."));
  // SHOT: from,to, fLRUD[4], tLRUD[4], flags, sectionType, surveyId, threshold
  const shot = chunk(
    3,
    [...u32(0), ...u32(1), ...f64(0), ...f64(0), ...f64(0), ...f64(0), ...f64(0), ...f64(0), ...f64(0), ...f64(0), ...u32(0), ...u32(0), ...u32(0), ...f64(0)],
    1,
    [],
  );
  // SCRAP: id, surveyId, numPoints, pointsPtr{pos,size}, num3Angles, 3AnglesPtr{pos,size}
  const points = [...f64(0), ...f64(0), ...f64(0), ...f64(10), ...f64(0), ...f64(0), ...f64(5), ...f64(5), ...f64(-2)];
  const tris = [...u32(0), ...u32(1), ...u32(2)];
  const scrap = chunk(
    4,
    [...u32(0), ...u32(0), ...u32(3), ...u32(0), ...u32(72), ...u32(1), ...u32(72), ...u32(12)],
    1,
    [...points, ...tris],
  );
  return Uint8Array.from([...survey, ...station, ...shot, ...scrap]).buffer;
}

describe("Therion .lox — synthetic: walls, flags, labels", () => {
  const m = parseTherionLox(buildSyntheticLox());

  it("builds survey-path labels and station flags", () => {
    expect(m.metadata.title).toBe("Test Cave");
    expect(m.stations.map((s) => s.label).sort()).toEqual(["", "cave.a", "cave.b"]);
    const byLabel = new Map(m.stations.map((s) => [s.label, s]));
    expect(byLabel.get("cave.a")!.flags.entrance).toBe(true);
    expect(byLabel.get("cave.b")!.flags.wall).toBe(true);
    expect(byLabel.get("cave.b")).toMatchObject({ x: 10, y: 0, z: -2 });
  });

  it('marks the station named "." anonymous and unlabelled', () => {
    const anon = m.stations.filter((s) => s.flags.anonymous);
    expect(anon).toHaveLength(1);
    expect(anon[0]).toMatchObject({ label: "", x: 1, y: 1, z: 1 });
  });

  it("decodes the centreline leg", () => {
    expect(m.legs).toHaveLength(1);
    expect(m.legs[0].flags.splay).toBe(false);
    expect(m.stations[m.legs[0].from].label).toBe("cave.a");
    expect(m.stations[m.legs[0].to].label).toBe("cave.b");
  });

  it("decodes the scrap wall mesh (3 vertices, 1 triangle)", () => {
    expect(m.walls).toBeDefined();
    expect(Array.from(m.walls!.positions)).toEqual([0, 0, 0, 10, 0, 0, 5, 5, -2]);
    expect(Array.from(m.walls!.indices)).toEqual([0, 1, 2]);
  });
});
