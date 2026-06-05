/**
 * CaveModel — the ONE normalized data model that every format parser produces
 * and the renderer consumes. Keep this stable: the UI can be rewritten without
 * touching it, and new format parsers must target exactly this shape.
 *
 * Axes follow the Survex / surveying convention:
 *   x = East, y = North, z = Up (elevation).  Distances are METRES.
 * The renderer is responsible for any axis remapping it needs (e.g. y-up).
 */

export type Vec3 = readonly [number, number, number];

/** Flags carried by a station (point). */
export interface StationFlags {
  /** Station lies on a surface (above-ground) leg. */
  surface: boolean;
  /** Station lies on an underground leg. */
  underground: boolean;
  /** Marked as a cave entrance. */
  entrance: boolean;
  /** Exported as a connection point between surveys. */
  exported: boolean;
  /** Fixed / control point. */
  fixed: boolean;
  /** Anonymous station (no meaningful name). */
  anonymous: boolean;
  /** Lies on a modelled passage wall. */
  wall: boolean;
}

/** Flags carried by a leg (line segment between two stations). */
export interface LegFlags {
  /** Above-ground (surface) leg. */
  surface: boolean;
  /** Duplicates another leg (e.g. a resurvey); excluded from total length. */
  duplicate: boolean;
  /** Splay shot — a radial shot to a wall, not part of the centreline. */
  splay: boolean;
}

/** An ISO `YYYY-MM-DD` date range (from === to for a single date). */
export interface DateRange {
  from: string;
  to: string;
}

export interface Station {
  /** Index of this station within `CaveModel.stations`. */
  id: number;
  /** Survey label, e.g. `entrance.1.2`. May be `''` for an anonymous point. */
  label: string;
  x: number;
  y: number;
  z: number;
  flags: StationFlags;
}

export interface Leg {
  /** Index into `CaveModel.stations`. */
  from: number;
  /** Index into `CaveModel.stations`. */
  to: number;
  flags: LegFlags;
  /** Survey/series path this leg belongs to (for series colouring). */
  survey?: string;
  /** Survey date(s) for this leg, if recorded. */
  date?: DateRange;
}

/** Passage cross-section (Left/Right/Up/Down) measured at a station. */
export interface Lrud {
  /** Index into `CaveModel.stations`. */
  station: number;
  /** Distances in metres; `null` means "not measured / omitted". */
  l: number | null;
  r: number | null;
  u: number | null;
  d: number | null;
  /** True if this is the last station in its passage run. */
  lastInPassage: boolean;
}

export interface CaveMetadata {
  title: string;
  /** Source format identifier, e.g. `survex-3d-v8`. */
  format: string;
  /** Survey hierarchy separator character (defaults to `.`). */
  separator: string;
  /** Coordinate reference system string, if the file declared one. */
  crs?: string;
  /** Raw datestamp string from the file header. */
  datestamp?: string;
  /** Overall date range across all dated legs, if any. */
  dateRange?: DateRange;
  /** Axis-aligned bounding box of all stations, in metres. */
  bounds: { min: Vec3; max: Vec3 };
  /** True if the file is an extended-elevation projection rather than plan. */
  isExtendedElevation: boolean;
}

export interface CaveModel {
  metadata: CaveMetadata;
  stations: Station[];
  legs: Leg[];
  /** Triangle-mesh passage walls (Therion .lox); absent for centreline-only data. */
  walls?: { positions: Float32Array; indices: Uint32Array };
  /** Per-station passage cross-sections, if the format carries them. */
  lrud?: Lrud[];
}

export function emptyStationFlags(): StationFlags {
  return {
    surface: false,
    underground: false,
    entrance: false,
    exported: false,
    fixed: false,
    anonymous: false,
    wall: false,
  };
}

export function emptyLegFlags(): LegFlags {
  return { surface: false, duplicate: false, splay: false };
}
