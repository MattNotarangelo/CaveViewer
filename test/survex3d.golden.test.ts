/**
 * Golden test: validate the .3d parser against a REAL Survex v8 file, using
 * Survex's own `dump3d` output as the ground-truth oracle. This proves the byte
 * layout is correct — a plausible parse is not enough; the numbers must match.
 *
 * Fixtures vendored from survex/tests (see fixtures/survex/PROVENANCE.md).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseSurvex3d, caveStats } from "../src/parser/index";
import type { CaveModel } from "../src/parser/index";

function readFixture(name: string): ArrayBuffer {
  const buf = readFileSync(new URL(`./fixtures/survex/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function fixed2(n: number): string {
  // Normalize -0.00 -> 0.00 so it matches dump3d formatting.
  const s = n.toFixed(2);
  return s === "-0.00" ? "0.00" : s;
}

// --- Parse the dump3d reference (.dump) into expected leg/node sets ---
const LEG_RE =
  /^LEG (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) \[(.*?)\] STYLE=(\S+)(?: (\d{4}-\d\d-\d\d))?(?: (\d{4}-\d\d-\d\d))?\s*$/;
const NODE_RE = /^NODE (\S+) (\S+) (\S+) \[(.*?)\](.*)$/;

interface ExpectedDump {
  title: string;
  separator: string;
  legs: string[]; // canonical strings
  nodes: string[]; // canonical strings
}

function parseDump(text: string): ExpectedDump {
  let title = "";
  let separator = ".";
  const legs: string[] = [];
  const nodes: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("TITLE ")) {
      title = line.slice(6).replace(/^"|"$/g, "");
      continue;
    }
    if (line.startsWith("SEPARATOR ")) {
      separator = line.slice(10).replace(/^'|'$/g, "");
      continue;
    }
    const leg = LEG_RE.exec(line);
    if (leg) {
      const [, x1, y1, z1, x2, y2, z2, survey, , d1, d2] = leg;
      const from = d1 ?? "";
      const to = d2 ?? d1 ?? ""; // single date -> from === to
      legs.push([x1, y1, z1, x2, y2, z2, survey, from, to].join("|"));
      continue;
    }
    const node = NODE_RE.exec(line);
    if (node) {
      const [, x, y, z, label] = node;
      nodes.push([x, y, z, label].join("|"));
    }
  }
  return { title, separator, legs, nodes };
}

function modelLegStrings(model: CaveModel): string[] {
  return model.legs.map((leg) => {
    const a = model.stations[leg.from];
    const b = model.stations[leg.to];
    const survey = leg.survey ?? "";
    const from = leg.date?.from ?? "";
    const to = leg.date?.to ?? "";
    return [
      fixed2(a.x), fixed2(a.y), fixed2(a.z),
      fixed2(b.x), fixed2(b.y), fixed2(b.z),
      survey, from, to,
    ].join("|");
  });
}

function modelNodeStrings(model: CaveModel): string[] {
  return model.stations
    .filter((s) => s.label !== "")
    .map((s) => [fixed2(s.x), fixed2(s.y), fixed2(s.z), s.label].join("|"));
}

describe("Survex .3d parser — golden test against real cavern output (dump3ddate)", () => {
  const model = parseSurvex3d(readFixture("dump3ddate.3d"));
  const expected = parseDump(
    readFileSync(new URL("./fixtures/survex/dump3ddate.dump", import.meta.url), "utf-8"),
  );

  it("reads header metadata correctly", () => {
    expect(model.metadata.title).toBe(expected.title); // "cmd_date"
    expect(model.metadata.separator).toBe(expected.separator); // "."
    expect(model.metadata.format).toBe("survex-3d-v8");
    expect(model.metadata.isExtendedElevation).toBe(false);
    expect(model.metadata.datestamp).toBe("@1729487704");
  });

  it("matches every leg's coordinates, survey label, and dates", () => {
    const got = modelLegStrings(model).sort();
    const want = [...expected.legs].sort();
    expect(got.length).toBe(77);
    expect(got).toEqual(want);
  });

  it("matches every named station's coordinates and label", () => {
    const got = modelNodeStrings(model).sort();
    const want = [...expected.nodes].sort();
    expect(got.length).toBe(78); // origin [_] + nodes 1..77
    expect(got).toEqual(want);
  });

  it("computes correct bounds and total length", () => {
    // Legs run from the origin to (0, n, 0) for n = 1..77, so each leg is n m long.
    const stats = caveStats(model);
    expect(stats.legCount).toBe(77);
    expect(stats.stationCount).toBe(78);
    expect(stats.totalLengthM).toBeCloseTo(3003, 6); // sum 1..77
    expect(stats.depthRangeM).toBeCloseTo(0, 6);
    expect(model.metadata.bounds.min).toEqual([0, 0, 0]);
    expect(model.metadata.bounds.max).toEqual([0, 77, 0]);
  });

  it("exercised the date opcodes without desyncing (proves byte counts)", () => {
    // dump3ddate is specifically a date-handling torture test. If any DATE
    // payload size were wrong, the stream would desync and leg coords would not
    // match the dump — which the leg test above would catch. Here we also assert
    // a representative single date and a span-derived range.
    const byNorth = new Map<number, CaveModel["legs"][number]>();
    for (const leg of model.legs) {
      const north = Math.round(model.stations[leg.to].y);
      byNorth.set(north, leg);
    }
    expect(byNorth.get(1)?.date).toEqual({ from: "1900-01-01", to: "1900-01-01" });
    expect(byNorth.get(2)?.date).toEqual({ from: "1900-01-01", to: "1900-01-31" });
  });
});
