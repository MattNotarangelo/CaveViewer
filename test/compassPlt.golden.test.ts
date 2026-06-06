/**
 * Golden test: validate the Compass `.plt` parser against Survex's own decode of
 * the SAME file. Survex reads the `.plt` and `dump3d` emits the reference
 * (multisurvey.dump); we assert our parse reproduces its stations, legs (incl.
 * splay flags), and LRUD numerically. This is an independent oracle — not our
 * own encoder. Fixtures vendored from survex/tests (see PROVENANCE.md).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseCompassPlt } from "../src/parser/index";
import type { CaveModel } from "../src/parser/index";

function readFixture(name: string): ArrayBuffer {
  const buf = readFileSync(new URL(`./fixtures/compass/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function fixed2(n: number): string {
  const s = n.toFixed(2);
  return s === "-0.00" ? "0.00" : s;
}

// dump3d lines for a .plt decode: NODE, LEG (with optional SPLAY), XSECT.
const NODE_RE = /^NODE (\S+) (\S+) (\S+) \[(.*?)\](.*)$/;
const LEG_RE = /^LEG (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) \[(.*?)\](.*)$/;
const XSECT_RE = /^XSECT (\S+) (\S+) (\S+) (\S+) \[(.*?)\]/;

interface ExpectedDump {
  nodes: Set<string>; // "x|y|z|label"
  legs: Set<string>; // "x1|y1|z1|x2|y2|z2|survey|splay"
  xsects: Map<string, string>; // label -> "l|r|u|d"
}

function parseDump(text: string): ExpectedDump {
  const nodes = new Set<string>();
  const legs = new Set<string>();
  const xsects = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m = NODE_RE.exec(line);
    if (m) {
      nodes.add([m[1], m[2], m[3], m[4]].join("|"));
      continue;
    }
    m = LEG_RE.exec(line);
    if (m) {
      const splay = /\bSPLAY\b/.test(m[8]);
      legs.add([m[1], m[2], m[3], m[4], m[5], m[6], m[7], splay ? "S" : ""].join("|"));
      continue;
    }
    m = XSECT_RE.exec(line);
    if (m) {
      xsects.set(m[5], [m[1], m[2], m[3], m[4]].join("|"));
    }
  }
  return { nodes, legs, xsects };
}

function modelNodes(model: CaveModel): Set<string> {
  return new Set(
    model.stations.map((s) => [fixed2(s.x), fixed2(s.y), fixed2(s.z), s.label].join("|")),
  );
}

function modelLegs(model: CaveModel): Set<string> {
  return new Set(
    model.legs.map((leg) => {
      const a = model.stations[leg.from];
      const b = model.stations[leg.to];
      return [
        fixed2(a.x), fixed2(a.y), fixed2(a.z),
        fixed2(b.x), fixed2(b.y), fixed2(b.z),
        leg.survey ?? "", leg.flags.splay ? "S" : "",
      ].join("|");
    }),
  );
}

function modelXsects(model: CaveModel): Map<string, string> {
  const out = new Map<string, string>();
  for (const x of model.lrud ?? []) {
    const s = model.stations[x.station];
    const fmt = (v: number | null) => (v === null ? "-1" : fixed2(v));
    out.set(s.label, [fmt(x.l), fmt(x.r), fmt(x.u), fmt(x.d)].join("|"));
  }
  return out;
}

describe("Compass .plt parser — golden test vs survex decode (multisurvey)", () => {
  const model = parseCompassPlt(readFixture("multisurvey.plt"));
  const expected = parseDump(
    readFileSync(new URL("./fixtures/compass/multisurvey.dump", import.meta.url), "utf-8"),
  );

  it("reports the right format and reads feet -> metres", () => {
    expect(model.metadata.format).toBe("compass-plt");
    // Z6 in the .plt is 123.5 N, -70.2 E, -87.1 Up (ft); survex: -21.40 37.64 -26.55 (m).
    const z6 = model.stations.find((s) => s.label === "Z+ Z6")!;
    expect(fixed2(z6.x)).toBe("-21.40");
    expect(fixed2(z6.y)).toBe("37.64");
    expect(fixed2(z6.z)).toBe("-26.55");
  });

  it("matches every station's coordinates and full label", () => {
    expect(model.stations.length).toBe(expected.nodes.size); // 10
    expect(modelNodes(model)).toEqual(expected.nodes);
  });

  it("matches every leg's endpoints, survey, and splay flag", () => {
    expect(model.legs.length).toBe(expected.legs.size); // 8 (incl. 2 splays)
    expect(modelLegs(model)).toEqual(expected.legs);
    expect(model.legs.filter((l) => l.flags.splay).length).toBe(2);
  });

  it("matches LRUD cross-sections from the P records", () => {
    expect(modelXsects(model)).toEqual(expected.xsects);
  });
});

describe("Compass .plt parser — robustness across real fixtures", () => {
  // multisection: multiple sections; pre1970: dates before the Unix epoch.
  for (const name of ["multisurvey.plt", "multisection.plt", "pre1970.plt"]) {
    it(`parses ${name} into a well-formed model`, () => {
      const model = parseCompassPlt(readFixture(name));
      expect(model.stations.length).toBeGreaterThan(0);
      expect(model.legs.length).toBeGreaterThan(0);
      // Every leg references real stations and bounds are finite.
      for (const leg of model.legs) {
        expect(model.stations[leg.from]).toBeDefined();
        expect(model.stations[leg.to]).toBeDefined();
      }
      for (const v of [...model.metadata.bounds.min, ...model.metadata.bounds.max]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    });
  }
});
