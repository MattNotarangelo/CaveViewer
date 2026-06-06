/**
 * Parser for the Compass Plot (`.plt`) format — the processed/plotted output of
 * Compass (the US-standard cave survey suite by Larry Fish).
 *
 * Cross-checked against Survex's reference Compass reader (`src/img.c`) and a
 * 1:1 `dump3d` oracle (tests/fixtures/compass/multisurvey.dump). Key facts:
 *  - M/D line coordinates are NORTH, EAST, VERTICAL in FEET (×0.3048 → metres).
 *  - `S<name>` is the station; `N<survey>` opens a section (with `D m d y` date
 *    and `C<comment>`); the full station label is `"<survey> <name>"`.
 *  - `P l r u d` are LRUD passage dimensions in feet; a value < 0 or > 900 means
 *    "missing". `I <dist>` is the cumulative distance (ignored — we have coords).
 *  - Trailing shot flags: `S` splay (its far station is a wall), `L` duplicate,
 *    `P` surface.
 *  - `M` lifts the pen (start a traverse); `D` draws a leg from the previous
 *    station. `Z`/`X` lines are bounding boxes (ignored).
 */
import {
  CaveModel,
  DateRange,
  Leg,
  Lrud,
  Station,
  Vec3,
  emptyLegFlags,
  emptyStationFlags,
} from "./types";

const METRES_PER_FOOT = 0.3048; // exact
const utf8 = new TextDecoder("utf-8");

export class CompassPltParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompassPltParseError";
  }
}

const MD_RE =
  /^[MD]\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+S(\S+)(.*)$/;
const P_RE =
  /\bP\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/;
const FLAGS_RE = /\bI\s+-?\d+(?:\.\d+)?\s+([A-Za-z]+)/;
const DATE_RE = /\bD\s+(\d+)\s+(\d+)\s+(\d+)/;

interface Builder {
  stations: Station[];
  legs: Leg[];
  lrud: Lrud[];
  byLabel: Map<string, number>;
  haveLrud: Set<number>;
}

export function parseCompassPlt(buffer: ArrayBuffer): CaveModel {
  const text = utf8.decode(new Uint8Array(buffer));
  const lines = text.split(/\r?\n/);

  const b: Builder = {
    stations: [],
    legs: [],
    lrud: [],
    byLabel: new Map(),
    haveLrud: new Set(),
  };

  let title = "";
  let survey = "";
  let surveyDate: DateRange | undefined;
  let current: number | null = null; // current pen-position station id

  for (const raw of lines) {
    const line = raw.replace(/\x1a/g, "").trimEnd(); // strip Compass EOF (Ctrl-Z)
    if (line.length === 0) continue;
    const cmd = line[0];

    if (cmd === "M" || cmd === "D") {
      const m = MD_RE.exec(line);
      if (!m) continue; // tolerate malformed coordinate lines
      const north = parseFloat(m[1]);
      const east = parseFloat(m[2]);
      const up = parseFloat(m[3]);
      const name = m[4];
      const tail = m[5];

      const id = stationFor(b, labelOf(survey, name), {
        x: east * METRES_PER_FOOT,
        y: north * METRES_PER_FOOT,
        z: up * METRES_PER_FOOT,
      });

      const flags = parseFlags(tail);
      if (cmd === "D" && current !== null) {
        const leg: Leg = { from: current, to: id, flags: legFlags(flags) };
        if (survey) leg.survey = survey;
        if (surveyDate) leg.date = surveyDate;
        b.legs.push(leg);
        if (flags.splay) b.stations[id].flags.wall = true;
      }
      current = id;

      addLrud(b, id, tail);
      continue;
    }

    switch (cmd) {
      case "N": {
        const rest = line.slice(1);
        survey = rest.split(/\s/)[0] ?? "";
        surveyDate = parseDate(rest);
        current = null;
        break;
      }
      case "S":
        if (!title) title = line.slice(1).trim();
        break;
      // 'Z' (file extent), 'X' (section extent), and other commands carry no
      // geometry we need; skip them.
      default:
        break;
    }
  }

  const bounds = computeBounds(b.stations);
  const model: CaveModel = {
    metadata: {
      title,
      format: "compass-plt",
      separator: " ",
      bounds,
      isExtendedElevation: false,
    },
    stations: b.stations,
    legs: b.legs,
  };
  if (b.lrud.length > 0) model.lrud = b.lrud;
  return model;
}

function labelOf(survey: string, name: string): string {
  return survey ? `${survey} ${name}` : name;
}

function stationFor(
  b: Builder,
  label: string,
  coord: { x: number; y: number; z: number },
): number {
  const existing = b.byLabel.get(label);
  if (existing !== undefined) return existing;
  const id = b.stations.length;
  const flags = emptyStationFlags();
  flags.underground = true;
  b.stations.push({ id, label, x: coord.x, y: coord.y, z: coord.z, flags });
  b.byLabel.set(label, id);
  return id;
}

interface ShotFlags {
  splay: boolean;
  duplicate: boolean;
  surface: boolean;
}

function parseFlags(tail: string): ShotFlags {
  const out: ShotFlags = { splay: false, duplicate: false, surface: false };
  const fm = FLAGS_RE.exec(tail);
  if (!fm) return out;
  for (const ch of fm[1]) {
    if (ch === "S") out.splay = true;
    else if (ch === "L") out.duplicate = true;
    else if (ch === "P") out.surface = true;
  }
  return out;
}

function legFlags(f: ShotFlags): Leg["flags"] {
  const flags = emptyLegFlags();
  flags.splay = f.splay;
  flags.duplicate = f.duplicate;
  flags.surface = f.surface;
  return flags;
}

function addLrud(b: Builder, station: number, tail: string): void {
  if (b.haveLrud.has(station)) return;
  const pm = P_RE.exec(tail);
  if (!pm) return;
  const dim = (s: string): number | null => {
    const v = parseFloat(s);
    return v < 0 || v > 900 ? null : v * METRES_PER_FOOT;
  };
  b.lrud.push({
    station,
    l: dim(pm[1]),
    r: dim(pm[2]),
    u: dim(pm[3]),
    d: dim(pm[4]),
    lastInPassage: false,
  });
  b.haveLrud.add(station);
}

function parseDate(rest: string): DateRange | undefined {
  const dm = DATE_RE.exec(rest);
  if (!dm) return undefined;
  const month = Number(dm[1]);
  const day = Number(dm[2]);
  const year = Number(dm[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { from: iso, to: iso };
}

function computeBounds(stations: Station[]): { min: Vec3; max: Vec3 } {
  if (stations.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const s of stations) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.z < minZ) minZ = s.z;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
    if (s.z > maxZ) maxZ = s.z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
