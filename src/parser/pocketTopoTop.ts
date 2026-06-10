/**
 * Parser for the PocketTopo `.top` (version 3) format — the native file of
 * PocketTopo, Beat Heeb's DistoX paperless-surveying app.
 *
 * Byte layout cross-checked against TopoDroid's `ptopo` package (a port of the
 * reference implementation, with Beat Heeb's own 2026 corrections):
 * https://github.com/marcocorvi/topodroid/tree/master/src/com/topodroid/ptopo
 *  - Header `"Top"` + version byte (3). Then trips, shots and references, each
 *    an Int32 count followed by records; everything little-endian. The trailing
 *    mapping + sketch drawings carry no geometry and are ignored.
 *  - Angles are stored as 1/65536 of a full circle; distances in millimetres;
 *    strings as 7-bit-varint length + UTF-8; trip times as .NET ticks (100 ns
 *    since 0001-01-01).
 *  - Station Id word: `0x80000000` = undefined ("-"); other values with the
 *    high bit set are plain numbers (`0x80000001` = "0"); high bit clear is
 *    `major<<16 | minor` rendered as "major.minor".
 *
 * Unlike the processed formats (.3d/.plt/.lox), `.top` stores RAW shot
 * measurements, so this parser also computes station coordinates: it applies
 * each trip's declination, averages consecutive repeats of the same shot (the
 * standard DistoX triple-shot practice), and propagates positions breadth-first
 * from reference points (or the origin). Loops are not adjusted — redundant
 * legs keep the first position reached, which is fine for viewing.
 */
import { ByteCursor, ByteCursorError } from "./byteCursor";
import {
  CaveModel,
  DateRange,
  Leg,
  Station,
  Vec3,
  emptyLegFlags,
  emptyStationFlags,
} from "./types";

export class PocketTopoParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PocketTopoParseError";
  }
}

const ID_UNDEFINED = 0x80000000;
const DEG_PER_UNIT = 360 / 65536;
/** Days from 0001-01-01 to 1970-01-01 (.NET `DateTime(1970,1,1).Ticks / 864e9`). */
const DAYS_TO_UNIX_EPOCH = 719162n;
const TICKS_PER_DAY = 864000000000n;
const MS_PER_DAY = 86400000;

interface RawShot {
  from: string | null; // null = undefined station ("-")
  to: string | null;
  distM: number;
  azimuthDeg: number; // magnetic
  inclinationDeg: number;
  tripIndex: number;
}

interface Trip {
  date: string; // ISO YYYY-MM-DD
  comment: string;
  declinationDeg: number;
}

interface Reference {
  station: string;
  x: number;
  y: number;
  z: number;
}

export function parsePocketTopo(buffer: ArrayBuffer): CaveModel {
  try {
    return parse(new ByteCursor(buffer));
  } catch (e) {
    if (e instanceof ByteCursorError) {
      throw new PocketTopoParseError(`Corrupt .top file: ${e.message}`);
    }
    throw e;
  }
}

function parse(cur: ByteCursor): CaveModel {
  if (cur.u8() !== 0x54 || cur.u8() !== 0x6f || cur.u8() !== 0x70) {
    throw new PocketTopoParseError('Not a PocketTopo file (missing "Top" magic)');
  }
  const version = cur.u8();
  if (version !== 3) {
    throw new PocketTopoParseError(
      `Unsupported PocketTopo file version ${version} (only version 3 is supported)`,
    );
  }

  const trips: Trip[] = [];
  const tripCount = readCount(cur, "trip");
  for (let i = 0; i < tripCount; i++) trips.push(readTrip(cur));

  const shots: RawShot[] = [];
  const shotCount = readCount(cur, "shot");
  for (let i = 0; i < shotCount; i++) shots.push(readShot(cur));

  const references: Reference[] = [];
  const refCount = readCount(cur, "reference");
  for (let i = 0; i < refCount; i++) {
    const ref = readReference(cur);
    if (ref) references.push(ref);
  }
  // The rest of the file (overview mapping + the two sketch drawings) carries
  // no geometry; ignore it.

  return buildModel(trips, shots, references);
}

function readCount(cur: ByteCursor, what: string): number {
  const n = cur.i32();
  if (n < 0) throw new PocketTopoParseError(`Corrupt .top file: negative ${what} count`);
  return n;
}

function readTrip(cur: ByteCursor): Trip {
  // .NET ticks; BigInt keeps the day computation exact at midnight boundaries.
  const lo = BigInt(cur.u32());
  const hi = BigInt(cur.u32());
  const ticks = (hi << 32n) | lo;
  const unixDays = Number(ticks / TICKS_PER_DAY - DAYS_TO_UNIX_EPOCH);
  const date = new Date(unixDays * MS_PER_DAY).toISOString().slice(0, 10);
  const comment = readString(cur);
  const declinationDeg = signedAngle(cur.i16());
  return { date, comment, declinationDeg };
}

function readShot(cur: ByteCursor): RawShot {
  const from = readStationId(cur);
  const to = readStationId(cur);
  const distM = cur.i32() / 1000;
  const azimuthDeg = cur.u16() * DEG_PER_UNIT;
  const inclinationDeg = signedAngle(cur.i16());
  const flags = cur.u8();
  cur.skip(1); // roll — drawing orientation only
  const tripIndex = cur.i16();
  if (flags & 0x02) readString(cur); // shot comment — not carried by CaveModel
  return { from, to, distM, azimuthDeg, inclinationDeg, tripIndex };
}

function readReference(cur: ByteCursor): Reference | null {
  const station = readStationId(cur);
  const x = readI64mm(cur) / 1000;
  const y = readI64mm(cur) / 1000;
  const z = cur.i32() / 1000;
  readString(cur); // comment
  return station === null ? null : { station, x, y, z };
}

/** Decode a station Id word to its display name, or null for "undefined". */
function readStationId(cur: ByteCursor): string | null {
  const id = cur.u32();
  if (id === ID_UNDEFINED) return null;
  if (id > ID_UNDEFINED) return String(id - ID_UNDEFINED - 1); // plain number
  return `${id >>> 16}.${id & 0xffff}`; // major.minor
}

/** 1/65536-circle units (signed i16) → degrees in [-180, 180). */
function signedAngle(raw: number): number {
  return raw * DEG_PER_UNIT;
}

/** PocketTopo string: 7-bit varint byte length, then UTF-8. */
function readString(cur: ByteCursor): string {
  let len = 0;
  let shift = 0;
  let b: number;
  do {
    b = cur.u8();
    len |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);
  if (len === 0) return "";
  return new TextDecoder("utf-8").decode(cur.take(len));
}

/** Little-endian signed 64-bit integer as a number (exact for |v| < 2^53 mm). */
function readI64mm(cur: ByteCursor): number {
  const lo = cur.u32();
  const hi = cur.i32();
  return hi * 2 ** 32 + lo;
}

// ---------------------------------------------------------------------------
// Coordinate propagation: raw shots → positioned CaveModel.
// ---------------------------------------------------------------------------

interface AveragedLeg {
  from: string;
  to: string;
  dx: number;
  dy: number;
  dz: number;
  tripIndex: number;
}

interface Splay {
  station: string;
  dx: number;
  dy: number;
  dz: number;
  /** True when the named station is the shot TARGET (delta points at it). */
  reversed: boolean;
  tripIndex: number;
}

function buildModel(trips: Trip[], shots: RawShot[], references: Reference[]): CaveModel {
  const { legs, splays } = collectShots(trips, shots);

  const stations: Station[] = [];
  const byLabel = new Map<string, number>();
  const stationFor = (label: string): number => {
    const existing = byLabel.get(label);
    if (existing !== undefined) return existing;
    const id = stations.length;
    const flags = emptyStationFlags();
    flags.underground = true;
    stations.push({ id, label, x: NaN, y: NaN, z: NaN, flags });
    byLabel.set(label, id);
    return id;
  };

  // Create named stations in shot order, then reference-only stations.
  for (const leg of legs) {
    stationFor(leg.from);
    stationFor(leg.to);
  }
  for (const splay of splays) stationFor(splay.station);
  for (const ref of references) stationFor(ref.station);

  positionStations(stations, byLabel, legs, references);

  const model: CaveModel = {
    metadata: {
      title: trips.find((t) => t.comment !== "")?.comment ?? "",
      format: "pockettopo-top",
      separator: ".",
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      isExtendedElevation: false,
    },
    stations,
    legs: [],
  };

  for (const leg of legs) {
    const out: Leg = {
      from: byLabel.get(leg.from)!,
      to: byLabel.get(leg.to)!,
      flags: emptyLegFlags(),
    };
    const survey = seriesOf(leg.from);
    if (survey !== undefined) out.survey = survey;
    const trip = trips[leg.tripIndex];
    if (trip) out.date = { from: trip.date, to: trip.date };
    model.legs.push(out);
  }

  for (const splay of splays) {
    const fromId = byLabel.get(splay.station)!;
    const base = stations[fromId];
    const sign = splay.reversed ? -1 : 1;
    const endId = stations.length;
    const flags = emptyStationFlags();
    flags.underground = true;
    flags.anonymous = true;
    flags.wall = true;
    stations.push({
      id: endId,
      label: "",
      x: base.x + sign * splay.dx,
      y: base.y + sign * splay.dy,
      z: base.z + sign * splay.dz,
      flags,
    });
    const legFlags = emptyLegFlags();
    legFlags.splay = true;
    const out: Leg = { from: fromId, to: endId, flags: legFlags };
    const survey = seriesOf(splay.station);
    if (survey !== undefined) out.survey = survey;
    const trip = trips[splay.tripIndex];
    if (trip) out.date = { from: trip.date, to: trip.date };
    model.legs.push(out);
  }

  model.metadata.bounds = computeBounds(stations);
  const dateRange = overallDateRange(model.legs);
  if (dateRange) model.metadata.dateRange = dateRange;
  return model;
}

/**
 * Convert raw shots to displacement vectors (declination applied), averaging
 * consecutive repeats of the same from→to pair, and splitting out splays
 * (shots with an undefined end).
 */
function collectShots(
  trips: Trip[],
  shots: RawShot[],
): { legs: AveragedLeg[]; splays: Splay[] } {
  const legs: AveragedLeg[] = [];
  const splays: Splay[] = [];
  let group: { leg: AveragedLeg; count: number } | null = null;

  for (const shot of shots) {
    if (shot.from === null && shot.to === null) continue; // unassigned reading
    const declination = trips[shot.tripIndex]?.declinationDeg ?? 0;
    const az = ((shot.azimuthDeg + declination) * Math.PI) / 180;
    const incl = (shot.inclinationDeg * Math.PI) / 180;
    const h = shot.distM * Math.cos(incl);
    const dx = h * Math.sin(az);
    const dy = h * Math.cos(az);
    const dz = shot.distM * Math.sin(incl);

    if (shot.from === null || shot.to === null) {
      group = null;
      if (shot.distM === 0) continue; // comment-only row, no geometry
      splays.push({
        station: (shot.from ?? shot.to)!,
        dx,
        dy,
        dz,
        reversed: shot.from === null,
        tripIndex: shot.tripIndex,
      });
      continue;
    }

    if (group && group.leg.from === shot.from && group.leg.to === shot.to) {
      // A repeat of the previous shot: fold it into the running average.
      const n = group.count + 1;
      group.leg.dx += (dx - group.leg.dx) / n;
      group.leg.dy += (dy - group.leg.dy) / n;
      group.leg.dz += (dz - group.leg.dz) / n;
      group.count = n;
      continue;
    }
    const leg: AveragedLeg = { from: shot.from, to: shot.to, dx, dy, dz, tripIndex: shot.tripIndex };
    legs.push(leg);
    group = { leg, count: 1 };
  }
  return { legs, splays };
}

/**
 * Breadth-first position propagation. Components containing a reference point
 * are anchored to it (absolute coordinates); the rest start at the origin —
 * matching PocketTopo's own rendering. Redundant (loop-closing) legs keep the
 * first position reached.
 */
function positionStations(
  stations: Station[],
  byLabel: Map<string, number>,
  legs: AveragedLeg[],
  references: Reference[],
): void {
  const adjacency = new Map<number, { other: number; dx: number; dy: number; dz: number }[]>();
  const link = (a: number, b: number, dx: number, dy: number, dz: number) => {
    let list = adjacency.get(a);
    if (!list) adjacency.set(a, (list = []));
    list.push({ other: b, dx, dy, dz });
  };
  for (const leg of legs) {
    const f = byLabel.get(leg.from)!;
    const t = byLabel.get(leg.to)!;
    link(f, t, leg.dx, leg.dy, leg.dz);
    link(t, f, -leg.dx, -leg.dy, -leg.dz);
  }

  const positioned = new Set<number>();
  const bfs = (start: number) => {
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head];
      const here = stations[id];
      for (const edge of adjacency.get(id) ?? []) {
        if (positioned.has(edge.other)) continue;
        const s = stations[edge.other];
        s.x = here.x + edge.dx;
        s.y = here.y + edge.dy;
        s.z = here.z + edge.dz;
        positioned.add(edge.other);
        queue.push(edge.other);
      }
    }
  };

  for (const ref of references) {
    const id = byLabel.get(ref.station)!;
    const s = stations[id];
    s.flags.fixed = true;
    if (positioned.has(id)) continue;
    s.x = ref.x;
    s.y = ref.y;
    s.z = ref.z;
    positioned.add(id);
    bfs(id);
  }
  for (const station of stations) {
    if (positioned.has(station.id)) continue;
    station.x = 0;
    station.y = 0;
    station.z = 0;
    positioned.add(station.id);
    bfs(station.id);
  }
}

/** The series ("major") part of a major.minor station name, if it has one. */
function seriesOf(label: string): string | undefined {
  const dot = label.indexOf(".");
  return dot < 0 ? undefined : label.slice(0, dot);
}

function overallDateRange(legs: Leg[]): DateRange | undefined {
  let from: string | undefined;
  let to: string | undefined;
  for (const leg of legs) {
    if (!leg.date) continue;
    if (from === undefined || leg.date.from < from) from = leg.date.from;
    if (to === undefined || leg.date.to > to) to = leg.date.to;
  }
  return from && to ? { from, to } : undefined;
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
