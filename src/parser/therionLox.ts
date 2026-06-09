/**
 * Parser for the Therion `.lox` format (the binary output of Therion, read by
 * its `loch` 3D viewer). Unlike `.3d`/`.plt`, `.lox` carries modelled passage
 * WALL surfaces (triangle-mesh "scraps"), not just the centreline.
 *
 * Implemented against Therion's reference reader, `src/common-utils/lxFile.{h,cxx}`
 * (`lxFileChunkHdr`, `lxFileImport`). Byte layout is NOT guessed.
 *
 * Structure: the file is a sequence of chunks. Each chunk is a 16-byte header
 * `{ type, recSize, recCount, dataSize }` (4 x uint32 LE), then `recSize` bytes
 * of packed fixed-size records, then `dataSize` bytes of a data section that the
 * records index via {position,size} pointers (offsets relative to that section).
 * All multi-byte values are little-endian; lxFileSize = uint32, lxFileDbl = f64.
 */
import { CaveModel, Leg, Station, Vec3, emptyLegFlags, emptyStationFlags } from "./types";

const CHUNK_SURVEY = 1;
const CHUNK_STATION = 2;
const CHUNK_SHOT = 3;
const CHUNK_SCRAP = 4;
// 5 = SURFACE (DEM), 6 = SURFACEBMP — terrain, not consumed here.

const ST_FLAG_SURFACE = 1;
const ST_FLAG_ENTRANCE = 2;
const ST_FLAG_FIXED = 4;
const ST_FLAG_HAS_WALLS = 16;

const SH_FLAG_SURFACE = 1;
const SH_FLAG_DUPLICATE = 2;
const SH_FLAG_SPLAY = 16;

const utf8 = new TextDecoder("utf-8");

export class TherionLoxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TherionLoxParseError";
  }
}

interface LoxSurvey {
  parent: number;
  name: string;
  title: string;
}

interface LoxStation {
  id: number;
  surveyId: number;
  name: string;
  flags: number;
  x: number;
  y: number;
  z: number;
}

interface LoxShot {
  from: number;
  to: number;
  flags: number;
  surveyId: number;
}

export function parseTherionLox(buffer: ArrayBuffer): CaveModel {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;

  const surveys = new Map<number, LoxSurvey>();
  const loxStations: LoxStation[] = [];
  const loxShots: LoxShot[] = [];
  const wallPositions: number[] = [];
  const wallIndices: number[] = [];

  let p = 0;
  const u32 = (): number => {
    const v = view.getUint32(p, true);
    p += 4;
    return v;
  };
  const f64 = (): number => {
    const v = view.getFloat64(p, true);
    p += 8;
    return v;
  };
  const str = (pos: number, size: number): string => {
    if (size === 0 || pos < 0 || pos + size > len) return "";
    // Therion pads name strings with trailing NULs / spaces; strip them.
    return utf8.decode(bytes.subarray(pos, pos + size)).replace(/\0+/g, "").trim();
  };

  while (p + 16 <= len) {
    const type = u32();
    const recSize = u32();
    const recCount = u32();
    const dataSize = u32();
    const recStart = p;
    const dataStart = recStart + recSize;
    const next = dataStart + dataSize;
    if (next > len || dataStart < recStart) {
      throw new TherionLoxParseError(
        `Chunk (type ${type}) overruns file: needs ${next} bytes of ${len}`,
      );
    }

    switch (type) {
      // Field order follows each struct's Load() in lxFile.cxx, NOT the .h
      // declaration order (they differ).
      case CHUNK_SURVEY:
        for (let i = 0; i < recCount; i++) {
          const id = u32();
          const nPos = u32();
          const nSize = u32();
          const parent = u32();
          const tPos = u32();
          const tSize = u32();
          surveys.set(id, {
            parent,
            name: str(dataStart + nPos, nSize),
            title: str(dataStart + tPos, tSize),
          });
        }
        break;

      case CHUNK_STATION:
        for (let i = 0; i < recCount; i++) {
          const id = u32();
          const surveyId = u32();
          const nPos = u32();
          const nSize = u32();
          u32(); // commentPtr.position (unused)
          u32(); // commentPtr.size
          const flags = u32();
          const x = f64();
          const y = f64();
          const z = f64();
          loxStations.push({ id, surveyId, name: str(dataStart + nPos, nSize), flags, x, y, z });
        }
        break;

      case CHUNK_SHOT:
        for (let i = 0; i < recCount; i++) {
          const from = u32();
          const to = u32();
          p += 8 * 8; // fLRUD[4] + tLRUD[4] = 8 doubles, unused
          const flags = u32();
          u32(); // sectionType
          const surveyId = u32();
          p += 8; // threshold (double)
          loxShots.push({ from, to, flags, surveyId });
        }
        break;

      case CHUNK_SCRAP:
        for (let i = 0; i < recCount; i++) {
          u32(); // id
          u32(); // surveyId
          const numPoints = u32();
          const pPos = u32();
          u32(); // pointsPtr.size
          const num3Angles = u32();
          const aPos = u32();
          u32(); // 3AnglesPtr.size
          // Points/indices must lie within this chunk's data section; a
          // corrupt or crafted file could otherwise read into neighbouring
          // chunks or force a huge allocation.
          if (pPos + numPoints * 24 > dataSize || aPos + num3Angles * 12 > dataSize) {
            throw new TherionLoxParseError(
              `Scrap mesh (${numPoints} points, ${num3Angles} triangles) overruns chunk data section of ${dataSize} bytes`,
            );
          }
          // Merge this scrap's mesh into the global wall buffers; triangle
          // indices are local to the scrap, so offset by the running vertex count.
          const base = wallPositions.length / 3;
          let pp = dataStart + pPos;
          for (let k = 0; k < numPoints; k++) {
            wallPositions.push(
              view.getFloat64(pp, true),
              view.getFloat64(pp + 8, true),
              view.getFloat64(pp + 16, true),
            );
            pp += 24;
          }
          let ap = dataStart + aPos;
          for (let t = 0; t < num3Angles; t++) {
            wallIndices.push(
              base + view.getUint32(ap, true),
              base + view.getUint32(ap + 4, true),
              base + view.getUint32(ap + 8, true),
            );
            ap += 12;
          }
        }
        break;

      default:
        break; // SURFACE / SURFACEBMP / unknown — skip
    }

    p = next;
  }

  return assemble(surveys, loxStations, loxShots, wallPositions, wallIndices);
}

function surveyPath(surveys: Map<number, LoxSurvey>, surveyId: number): string {
  const parts: string[] = [];
  const seen = new Set<number>();
  let id = surveyId;
  while (surveys.has(id) && !seen.has(id)) {
    seen.add(id);
    const s = surveys.get(id)!;
    if (s.name) parts.unshift(s.name);
    if (s.parent === id) break;
    id = s.parent;
  }
  return parts.join(".");
}

function assemble(
  surveys: Map<number, LoxSurvey>,
  loxStations: LoxStation[],
  loxShots: LoxShot[],
  wallPositions: number[],
  wallIndices: number[],
): CaveModel {
  const stations: Station[] = [];
  const idToIndex = new Map<number, number>();

  for (const s of loxStations) {
    const index = stations.length;
    idToIndex.set(s.id, index);
    const path = surveyPath(surveys, s.surveyId);
    const label = path ? (s.name ? `${path}.${s.name}` : path) : s.name;
    const flags = emptyStationFlags();
    flags.surface = (s.flags & ST_FLAG_SURFACE) !== 0;
    flags.underground = !flags.surface;
    flags.entrance = (s.flags & ST_FLAG_ENTRANCE) !== 0;
    flags.fixed = (s.flags & ST_FLAG_FIXED) !== 0;
    flags.wall = (s.flags & ST_FLAG_HAS_WALLS) !== 0;
    flags.anonymous = s.name === "";
    stations.push({ id: index, label, x: s.x, y: s.y, z: s.z, flags });
  }

  const legs: Leg[] = [];
  for (const sh of loxShots) {
    const from = idToIndex.get(sh.from);
    const to = idToIndex.get(sh.to);
    if (from === undefined || to === undefined) continue;
    const flags = emptyLegFlags();
    flags.surface = (sh.flags & SH_FLAG_SURFACE) !== 0;
    flags.duplicate = (sh.flags & SH_FLAG_DUPLICATE) !== 0;
    flags.splay = (sh.flags & SH_FLAG_SPLAY) !== 0;
    const leg: Leg = { from, to, flags };
    const survey = surveyPath(surveys, sh.surveyId);
    if (survey) leg.survey = survey;
    legs.push(leg);
  }

  const bounds = computeBounds(stations, wallPositions);

  // Root survey (its own parent, or one with no parent in the map) names the
  // cave. Some files have an empty container root, so fall back to the first
  // survey that actually has a title/name.
  let title = "";
  for (const [id, s] of surveys) {
    if (s.parent === id || !surveys.has(s.parent)) {
      title = s.title || s.name;
      if (title) break;
    }
  }
  if (!title) {
    for (const s of surveys.values()) {
      title = s.title || s.name;
      if (title) break;
    }
  }

  const model: CaveModel = {
    metadata: {
      title: cleanTherionTitle(title),
      format: "therion-lox",
      separator: ".",
      bounds,
      isExtendedElevation: false,
    },
    stations,
    legs,
  };
  if (wallPositions.length > 0 && wallIndices.length > 0) {
    model.walls = {
      positions: Float32Array.from(wallPositions),
      indices: Uint32Array.from(wallIndices),
    };
  }
  return model;
}

/**
 * Therion titles can carry per-language variants, e.g.
 * `<lang:en>System Migovec<lang:sl>Sistem Migovec`. Prefer English, else the
 * first variant; strip the markup. Plain titles pass through unchanged.
 */
function cleanTherionTitle(raw: string): string {
  const title = raw.trim();
  if (!/<lang:/i.test(title)) return title;
  const parts = title.split(/<lang:([a-z-]+)>/i); // ["", "en", "…", "sl", "…"]
  const byLang = new Map<string, string>();
  for (let i = 1; i + 1 < parts.length; i += 2) {
    byLang.set(parts[i].toLowerCase(), parts[i + 1].trim());
  }
  return (byLang.get("en") ?? parts[2] ?? title).trim();
}

function computeBounds(stations: Station[], wallPositions: number[]): { min: Vec3; max: Vec3 } {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  const acc = (x: number, y: number, z: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  };
  for (const s of stations) acc(s.x, s.y, s.z);
  for (let i = 0; i + 2 < wallPositions.length; i += 3) {
    acc(wallPositions[i], wallPositions[i + 1], wallPositions[i + 2]);
  }
  if (!Number.isFinite(minX)) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
