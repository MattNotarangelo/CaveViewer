/**
 * A minimal, from-spec encoder for the PocketTopo `.top` (version 3) format.
 * Used ONLY by tests — never shipped in the app. It mirrors the byte layout the
 * parser reads (header, trips, shots, references, then mapping + drawings), so
 * encode→parse round-trips exercise the parser on every record variant.
 *
 * Layout follows TopoDroid's `ptopo` package (Beat Heeb's reference
 * implementation): little-endian throughout; angles stored as 1/65536 of a full
 * circle; distances in millimetres; strings as 7-bit-varint length + UTF-8.
 */

export interface EncodeTopTrip {
  /** Trip date (proleptic Gregorian, stored as .NET ticks at midnight). */
  date: { y: number; m: number; d: number };
  comment?: string;
  declinationDeg?: number;
}

export interface EncodeTopShot {
  /** `"major.minor"`, a plain non-negative integer, or `""`/omitted = undefined. */
  from?: string;
  to?: string;
  distM: number;
  azimuthDeg: number;
  inclinationDeg: number;
  rollDeg?: number;
  /** bit0 of the flags byte — extended-elevation direction; no geometry. */
  flip?: boolean;
  /** Sets bit1 of the flags byte and appends the comment string. */
  comment?: string;
  /** Index into trips; -1 (default) = no trip. */
  tripIndex?: number;
}

export interface EncodeTopReference {
  station: string;
  eastM: number;
  northM: number;
  altitudeM: number;
  comment?: string;
}

export interface EncodeTopOptions {
  magic?: string; // default "Top"
  version?: number; // default 3
  trips?: EncodeTopTrip[];
  shots?: EncodeTopShot[];
  references?: EncodeTopReference[];
  /** Truncate the file after the references (no mapping/drawings). */
  omitDrawings?: boolean;
}

/** Days from 0001-01-01 to 1970-01-01 (.NET `DateTime(1970,1,1).Ticks / 864e9`). */
const DAYS_TO_UNIX_EPOCH = 719162n;
const TICKS_PER_DAY = 864000000000n;
const MS_PER_DAY = 86400000;

class ByteSink {
  private bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
  }
  u16(v: number) {
    this.u8(v);
    this.u8(v >> 8);
  }
  i32(v: number) {
    this.u8(v);
    this.u8(v >> 8);
    this.u8(v >> 16);
    this.u8(v >> 24);
  }
  i64(v: bigint) {
    for (let i = 0n; i < 8n; i++) this.u8(Number((v >> (8n * i)) & 0xffn));
  }
  ascii(s: string) {
    for (const b of new TextEncoder().encode(s)) this.bytes.push(b);
  }
  /** PocketTopo string: 7-bit varint byte length, then UTF-8 bytes. */
  ptString(s: string) {
    const bytes = new TextEncoder().encode(s);
    let len = bytes.length;
    do {
      let b = len & 0x7f;
      len >>= 7;
      if (len > 0) b |= 0x80;
      this.u8(b);
    } while (len > 0);
    for (const b of bytes) this.bytes.push(b);
  }
  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** Angle in degrees → 1/65536 of a full circle (negatives wrap). */
function angleUnits(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return Math.round((d * 65536) / 360) & 0xffff;
}

/**
 * Station name → Id word: `0x80000000` undefined; plain number n stored as
 * `0x80000001 + n`; `"major.minor"` stored as `major<<16 | minor`.
 */
function stationId(name: string | undefined): number {
  if (name === undefined || name === "" || name === "-") return 0x80000000;
  const dot = name.indexOf(".");
  if (dot < 0) return (0x80000001 + Number(name)) >>> 0;
  const major = Number(name.slice(0, dot));
  const minor = Number(name.slice(dot + 1));
  return ((major << 16) | (minor & 0xffff)) >>> 0;
}

/** Civil date → .NET ticks (100ns since 0001-01-01) at midnight. */
function dateToTicks(y: number, m: number, d: number): bigint {
  const unixDays = BigInt(Date.UTC(y, m - 1, d) / MS_PER_DAY);
  return (unixDays + DAYS_TO_UNIX_EPOCH) * TICKS_PER_DAY;
}

function writeEmptyDrawing(sink: ByteSink) {
  sink.i32(0); // mapping origin x
  sink.i32(0); // mapping origin y
  sink.i32(500); // mapping scale
  sink.u8(0); // ID_NO_ELEMENT terminator
}

export function encodeTop(opts: EncodeTopOptions): Uint8Array {
  const sink = new ByteSink();
  sink.ascii(opts.magic ?? "Top");
  sink.u8(opts.version ?? 3);

  const trips = opts.trips ?? [];
  sink.i32(trips.length);
  for (const t of trips) {
    sink.i64(dateToTicks(t.date.y, t.date.m, t.date.d));
    sink.ptString(t.comment ?? "");
    sink.u16(angleUnits(t.declinationDeg ?? 0));
  }

  const shots = opts.shots ?? [];
  sink.i32(shots.length);
  for (const s of shots) {
    sink.i32(stationId(s.from));
    sink.i32(stationId(s.to));
    sink.i32(Math.round(s.distM * 1000));
    sink.u16(angleUnits(s.azimuthDeg));
    sink.u16(angleUnits(s.inclinationDeg));
    let flags = 0;
    if (s.flip) flags |= 0x01;
    if (s.comment !== undefined) flags |= 0x02;
    sink.u8(flags);
    sink.u8(Math.round(((((s.rollDeg ?? 0) % 360) + 360) % 360) * (256 / 360)) & 0xff);
    sink.u16((s.tripIndex ?? -1) & 0xffff);
    if (s.comment !== undefined) sink.ptString(s.comment);
  }

  const refs = opts.references ?? [];
  sink.i32(refs.length);
  for (const r of refs) {
    sink.i32(stationId(r.station));
    sink.i64(BigInt(Math.round(r.eastM * 1000)));
    sink.i64(BigInt(Math.round(r.northM * 1000)));
    sink.i32(Math.round(r.altitudeM * 1000));
    sink.ptString(r.comment ?? "");
  }

  if (!opts.omitDrawings) {
    // Overview mapping + the two sketch drawings (plan, sideview), all empty.
    sink.i32(0);
    sink.i32(0);
    sink.i32(500);
    writeEmptyDrawing(sink);
    writeEmptyDrawing(sink);
  }

  return sink.toUint8Array();
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}
