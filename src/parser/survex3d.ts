/**
 * Parser for the Survex `.3d` 3D image format, version 8.
 *
 * Implemented against the official specification (https://survex.com/docs/3dformat.htm)
 * and cross-checked byte-for-byte against Survex's reference reader (`src/img.c`,
 * `img_read_item_new` / `read_v8label`). Byte layouts are NOT guessed.
 *
 * Layout summary (v8):
 *   "Survex 3D Image File\n"
 *   "v8\n"
 *   <title>\n            title; may embed \0-separated [coord-system][separator]
 *   <datestamp>\n
 *   <flags : u8>         bit 7 = extended elevation
 *   <items...>           until EOF
 *
 * Item opcodes (first byte):
 *   0x00-0x04  STYLE (normal/diving/cartesian/cylpolar/nosurvey) — no payload
 *   0x0f       MOVE   : i32 x,y,z (centimetres)
 *   0x10-0x13  DATE   : 0/2/3/4-byte date payloads
 *   0x1f       ERROR  : 5 x i32 (ignored)
 *   0x30-0x33  XSECT  : label-diff + 4x (i16|i32) L,R,U,D
 *   0x40-0x7f  LINE   : [label-diff unless bit 0x20] + i32 x,y,z; flags = low 6 bits
 *   0x80-0xff  LABEL  : label-diff + i32 x,y,z; flags = low 7 bits
 *
 * Coordinates are signed 32-bit little-endian integers in centimetres; we expose
 * metres in the CaveModel.
 */

import { ByteCursor, decodeUtf8 } from "./byteCursor";
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

const MAGIC = "Survex 3D Image File";
const FFLAG_EXTENDED = 0x80;
const CM_PER_M = 100;

export class Survex3dParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Survex3dParseError";
  }
}

// Days since 1900-01-01 -> ISO date (proleptic Gregorian; 1900 is NOT a leap year,
// which matches Survex). JS Date uses the same calendar, so this is exact.
const EPOCH_1900 = Date.UTC(1900, 0, 1);
const MS_PER_DAY = 86_400_000;
function daysToIso(days: number): string {
  const d = new Date(EPOCH_1900 + days * MS_PER_DAY);
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Mutable label buffer implementing Survex's del/append delta encoding.
 * Each label item removes `del` bytes from the end then appends `add` bytes.
 */
class LabelBuffer {
  private bytes: number[] = [];

  /** Apply a v8 label delta read from the cursor; returns the new label string. */
  applyDelta(cur: ByteCursor): string {
    const b = cur.u8();
    let del: number;
    let add: number;
    if (b !== 0x00) {
      del = b >> 4;
      add = b & 0x0f;
    } else {
      const d = cur.u8();
      del = d !== 0xff ? d : cur.u32();
      const a = cur.u8();
      add = a !== 0xff ? a : cur.u32();
    }
    if (del > this.bytes.length) {
      throw new Survex3dParseError(
        `Label delta deletes ${del} bytes but only ${this.bytes.length} are buffered`,
      );
    }
    if (del > 0) this.bytes.length -= del;
    for (let i = 0; i < add; i++) this.bytes.push(cur.u8());
    return this.value();
  }

  value(): string {
    return decodeUtf8(this.bytes);
  }
}

interface Builder {
  stations: Station[];
  legs: Leg[];
  lrud: Lrud[];
  byCoord: Map<string, number>;
  byLabel: Map<string, number>;
}

function coordKey(xcm: number, ycm: number, zcm: number): string {
  return `${xcm},${ycm},${zcm}`;
}

/** Find or create a station at the given centimetre coordinate. */
function stationAt(b: Builder, xcm: number, ycm: number, zcm: number): number {
  const key = coordKey(xcm, ycm, zcm);
  const existing = b.byCoord.get(key);
  if (existing !== undefined) return existing;
  const id = b.stations.length;
  b.stations.push({
    id,
    label: "",
    x: xcm / CM_PER_M,
    y: ycm / CM_PER_M,
    z: zcm / CM_PER_M,
    flags: emptyStationFlags(),
  });
  b.byCoord.set(key, id);
  return id;
}

export function parseSurvex3d(buffer: ArrayBuffer): CaveModel {
  const cur = new ByteCursor(buffer);

  // --- Header ---
  const magic = cur.line();
  if (magic !== MAGIC) {
    throw new Survex3dParseError(
      `Not a Survex .3d file: expected "${MAGIC}", got "${magic.slice(0, 40)}"`,
    );
  }

  const versionLine = cur.line();
  if (!/^v\d+$/.test(versionLine)) {
    throw new Survex3dParseError(`Unrecognised .3d version line "${versionLine}"`);
  }
  const version = Number(versionLine.slice(1));
  if (version !== 8) {
    throw new Survex3dParseError(
      `Unsupported Survex .3d format version v${version}; this parser supports v8. ` +
        `Re-save with a recent Survex (cavern writes v8 by default).`,
    );
  }

  // Title line may contain \0-separated extra fields: title, coord-system, separator.
  const titleBytes = cur.lineBytes();
  const titleFields = splitNull(titleBytes);
  const title = titleFields[0] ?? "";
  const crs = titleFields[1] && titleFields[1].length > 0 ? titleFields[1] : undefined;
  const separator = titleFields[2] && titleFields[2].length > 0 ? titleFields[2][0] : ".";

  const datestamp = cur.line();
  const fileFlags = cur.u8();
  const isExtendedElevation = (fileFlags & FFLAG_EXTENDED) !== 0;

  // --- Items ---
  const b: Builder = {
    stations: [],
    legs: [],
    lrud: [],
    byCoord: new Map(),
    byLabel: new Map(),
  };
  const label = new LabelBuffer();
  let curX = 0;
  let curY = 0;
  let curZ = 0;
  let curDate: DateRange | undefined;
  // Pending XSECTs reference stations by name; resolve to indices after parsing.
  const pendingXsect: Array<{
    name: string;
    l: number | null;
    r: number | null;
    u: number | null;
    d: number | null;
    last: boolean;
  }> = [];

  while (!cur.atEnd()) {
    const op = cur.u8();

    if (op <= 0x04) {
      // STYLE_NORMAL/DIVING/CARTESIAN/CYLPOLAR/NOSURVEY — no payload, no geometry.
      // A trailing STYLE_NORMAL (0x00) before EOF acts as the end marker.
      continue;
    }

    if (op === 0x0f) {
      // MOVE
      curX = cur.i32();
      curY = cur.i32();
      curZ = cur.i32();
      continue;
    }

    if (op >= 0x10 && op <= 0x13) {
      curDate = readDate(cur, op);
      continue;
    }

    if (op === 0x1f) {
      // ERROR info: n_legs, length, E, H, V — not used for geometry.
      cur.skip(5 * 4);
      continue;
    }

    if (op >= 0x30 && op <= 0x33) {
      const name = label.applyDelta(cur);
      const wide = op >= 0x32;
      const last = (op & 0x01) !== 0;
      const l = readDim(cur, wide);
      const r = readDim(cur, wide);
      const u = readDim(cur, wide);
      const d = readDim(cur, wide);
      pendingXsect.push({ name, l, r, u, d, last });
      continue;
    }

    if (op >= 0x40 && op <= 0x7f) {
      // LINE — a leg from the current position to the new one.
      const flagBits = op & 0x3f;
      let survey: string;
      if (flagBits & 0x20) {
        survey = label.value(); // 0x20 = no label change
      } else {
        survey = label.applyDelta(cur);
      }
      const x = cur.i32();
      const y = cur.i32();
      const z = cur.i32();
      const from = stationAt(b, curX, curY, curZ);
      const to = stationAt(b, x, y, z);
      const flags = emptyLegFlags();
      flags.surface = (flagBits & 0x01) !== 0;
      flags.duplicate = (flagBits & 0x02) !== 0;
      flags.splay = (flagBits & 0x04) !== 0;
      const leg: Leg = { from, to, flags };
      if (survey) leg.survey = survey;
      if (curDate) leg.date = curDate;
      b.legs.push(leg);
      curX = x;
      curY = y;
      curZ = z;
      continue;
    }

    // op >= 0x80: LABEL — defines/names a station.
    const flagBits = op & 0x7f;
    const name = label.applyDelta(cur);
    const x = cur.i32();
    const y = cur.i32();
    const z = cur.i32();
    const id = stationAt(b, x, y, z);
    const st = b.stations[id];
    st.label = name;
    st.flags.surface = (flagBits & 0x01) !== 0;
    st.flags.underground = (flagBits & 0x02) !== 0;
    st.flags.entrance = (flagBits & 0x04) !== 0;
    st.flags.exported = (flagBits & 0x08) !== 0;
    st.flags.fixed = (flagBits & 0x10) !== 0;
    st.flags.anonymous = (flagBits & 0x20) !== 0;
    st.flags.wall = (flagBits & 0x40) !== 0;
    if (name) b.byLabel.set(name, id);
  }

  // Resolve XSECT references by station label.
  const lrud: Lrud[] = [];
  for (const x of pendingXsect) {
    const station = b.byLabel.get(x.name);
    if (station === undefined) continue; // unresolved; drop quietly
    lrud.push({ station, l: x.l, r: x.r, u: x.u, d: x.d, lastInPassage: x.last });
  }

  const bounds = computeBounds(b.stations);
  const dateRange = computeDateRange(b.legs);

  const model: CaveModel = {
    metadata: {
      title,
      format: "survex-3d-v8",
      separator,
      datestamp,
      bounds,
      isExtendedElevation,
      ...(crs ? { crs } : {}),
      ...(dateRange ? { dateRange } : {}),
    },
    stations: b.stations,
    legs: b.legs,
  };
  if (lrud.length > 0) model.lrud = lrud;
  return model;
}

function splitNull(bytes: Uint8Array): string[] {
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || bytes[i] === 0x00) {
      fields.push(decodeUtf8(bytes.subarray(start, i)));
      start = i + 1;
    }
  }
  return fields;
}

function readDate(cur: ByteCursor, op: number): DateRange | undefined {
  switch (op) {
    case 0x10:
      return undefined; // no date
    case 0x11: {
      const d = cur.u16();
      const iso = daysToIso(d);
      return { from: iso, to: iso };
    }
    case 0x12: {
      // start date + 1-byte span; end = start + span + 1 (verified against
      // survex's dump3ddate.3d reference fixture).
      const d = cur.u16();
      const span = cur.u8();
      return { from: daysToIso(d), to: daysToIso(d + span + 1) };
    }
    case 0x13: {
      const d1 = cur.u16();
      const d2 = cur.u16();
      return { from: daysToIso(d1), to: daysToIso(d2) };
    }
    default:
      throw new Survex3dParseError(`Unexpected date opcode 0x${op.toString(16)}`);
  }
}

function readDim(cur: ByteCursor, wide: boolean): number | null {
  if (wide) {
    const v = cur.u32();
    return v === 0xffffffff ? null : (v | 0) / CM_PER_M; // (v|0) -> signed
  }
  const v = cur.u16();
  if (v === 0xffff) return null;
  const signed = (v << 16) >> 16;
  return signed / CM_PER_M;
}

function computeBounds(stations: Station[]): { min: Vec3; max: Vec3 } {
  if (stations.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
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

function computeDateRange(legs: Leg[]): DateRange | undefined {
  let from: string | undefined;
  let to: string | undefined;
  for (const leg of legs) {
    if (!leg.date) continue;
    if (from === undefined || leg.date.from < from) from = leg.date.from;
    if (to === undefined || leg.date.to > to) to = leg.date.to;
  }
  if (from === undefined || to === undefined) return undefined;
  return { from, to };
}
