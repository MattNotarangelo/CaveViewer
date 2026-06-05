/**
 * A minimal, from-spec encoder for the Survex `.3d` v8 format. Used ONLY by tests
 * and the example-cave generator — never shipped in the app. It mirrors the byte
 * layout the parser reads, so encode→parse round-trips exercise the parser on
 * inputs (labelled LINEs, XSECTs, wide coords) that the real reference fixture
 * does not contain.
 *
 * Coordinates are given in CENTIMETRES (matching the on-disk integer units).
 */

export type Encode3dItem =
  | { t: "style"; style: "normal" | "diving" | "cartesian" | "cylpolar" | "nosurvey" }
  | { t: "move"; x: number; y: number; z: number }
  | {
      t: "line";
      x: number;
      y: number;
      z: number;
      /** Survey label for the leg; omit to keep the previous label (0x20 bit). */
      survey?: string;
      surface?: boolean;
      duplicate?: boolean;
      splay?: boolean;
    }
  | {
      t: "label";
      x: number;
      y: number;
      z: number;
      name: string;
      surface?: boolean;
      underground?: boolean;
      entrance?: boolean;
      exported?: boolean;
      fixed?: boolean;
      anonymous?: boolean;
      wall?: boolean;
    }
  | {
      t: "xsect";
      name: string;
      l: number | null;
      r: number | null;
      u: number | null;
      d: number | null;
      wide?: boolean;
      last?: boolean;
    }
  | { t: "date-single"; days: number }
  | { t: "date-span"; days: number; span: number }
  | { t: "date-range"; days1: number; days2: number };

export interface Encode3dOptions {
  title?: string;
  crs?: string;
  separator?: string;
  datestamp?: string;
  extendedElevation?: boolean;
  items: Encode3dItem[];
}

const STYLE_CODE = {
  normal: 0x00,
  diving: 0x01,
  cartesian: 0x02,
  cylpolar: 0x03,
  nosurvey: 0x04,
} as const;

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
  ascii(s: string) {
    for (const b of new TextEncoder().encode(s)) this.bytes.push(b);
  }
  raw(bytes: Uint8Array) {
    for (const b of bytes) this.bytes.push(b);
  }
  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** Encode a label delta (del from end + append) against a running buffer. */
function writeLabel(sink: ByteSink, prev: Uint8Array, next: Uint8Array): Uint8Array {
  // Longest common prefix.
  let common = 0;
  const min = Math.min(prev.length, next.length);
  while (common < min && prev[common] === next[common]) common++;
  const del = prev.length - common;
  const addBytes = next.subarray(common);
  const add = addBytes.length;
  // The single packed byte (del<<4)|add must be non-zero: 0x00 is reserved as
  // the escape into the extended form. So del==0 && add==0 (label unchanged)
  // must use the extended encoding, matching Survex's reader.
  if (del < 16 && add < 16 && (del | add) !== 0) {
    sink.u8((del << 4) | add);
  } else {
    sink.u8(0x00);
    if (del < 0xff) sink.u8(del);
    else {
      sink.u8(0xff);
      sink.i32(del);
    }
    if (add < 0xff) sink.u8(add);
    else {
      sink.u8(0xff);
      sink.i32(add);
    }
  }
  sink.raw(addBytes);
  return next;
}

function writeDim(sink: ByteSink, v: number | null, wide: boolean) {
  if (wide) {
    sink.i32(v === null ? -1 : v); // -1 == 0xffffffff sentinel
  } else {
    sink.u16(v === null ? 0xffff : v & 0xffff);
  }
}

export function encode3d(opts: Encode3dOptions): Uint8Array {
  const sink = new ByteSink();
  const enc = new TextEncoder();

  // Header.
  sink.ascii("Survex 3D Image File\n");
  sink.ascii("v8\n");
  let titleLine = opts.title ?? "";
  if (opts.crs !== undefined || opts.separator !== undefined) {
    titleLine += "\0" + (opts.crs ?? "");
    if (opts.separator !== undefined) titleLine += "\0" + opts.separator;
  }
  sink.ascii(titleLine);
  sink.u8(0x0a);
  sink.ascii(opts.datestamp ?? "@0");
  sink.u8(0x0a);
  sink.u8(opts.extendedElevation ? 0x80 : 0x00);

  let label: Uint8Array = new Uint8Array(0);

  for (const item of opts.items) {
    switch (item.t) {
      case "style":
        sink.u8(STYLE_CODE[item.style]);
        break;
      case "move":
        sink.u8(0x0f);
        sink.i32(item.x);
        sink.i32(item.y);
        sink.i32(item.z);
        break;
      case "line": {
        let flags = 0x40;
        if (item.surface) flags |= 0x01;
        if (item.duplicate) flags |= 0x02;
        if (item.splay) flags |= 0x04;
        const keepLabel = item.survey === undefined;
        if (keepLabel) flags |= 0x20;
        sink.u8(flags);
        if (!keepLabel) label = writeLabel(sink, label, enc.encode(item.survey));
        sink.i32(item.x);
        sink.i32(item.y);
        sink.i32(item.z);
        break;
      }
      case "label": {
        let flags = 0x80;
        if (item.surface) flags |= 0x01;
        if (item.underground) flags |= 0x02;
        if (item.entrance) flags |= 0x04;
        if (item.exported) flags |= 0x08;
        if (item.fixed) flags |= 0x10;
        if (item.anonymous) flags |= 0x20;
        if (item.wall) flags |= 0x40;
        sink.u8(flags);
        label = writeLabel(sink, label, enc.encode(item.name));
        sink.i32(item.x);
        sink.i32(item.y);
        sink.i32(item.z);
        break;
      }
      case "xsect": {
        const wide = item.wide ?? false;
        sink.u8((wide ? 0x32 : 0x30) | (item.last ? 0x01 : 0x00));
        label = writeLabel(sink, label, enc.encode(item.name));
        writeDim(sink, item.l, wide);
        writeDim(sink, item.r, wide);
        writeDim(sink, item.u, wide);
        writeDim(sink, item.d, wide);
        break;
      }
      case "date-single":
        sink.u8(0x11);
        sink.u16(item.days);
        break;
      case "date-span":
        sink.u8(0x12);
        sink.u16(item.days);
        sink.u8(item.span);
        break;
      case "date-range":
        sink.u8(0x13);
        sink.u16(item.days1);
        sink.u16(item.days2);
        break;
    }
  }

  // End marker: STYLE_NORMAL with empty label, then EOF.
  sink.u8(0x00);
  return sink.toUint8Array();
}

/** Convenience: copy a Uint8Array into a standalone ArrayBuffer for the parser. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
