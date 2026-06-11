/**
 * Colour modes for the centreline. Pure logic (no Three.js, no DOM) so it is
 * unit-testable: given a CaveModel it produces per-endpoint RGB colours and a
 * legend spec. Inspired by CaveView.js's shading modes.
 */
import type { CaveModel, Leg } from "../parser/index";
import { depthColor, hslToRgb, type RGB } from "./colormap";

export type ColorMode = "height" | "distance" | "inclination" | "survey" | "date" | "single";

export interface ColorModeInfo {
  id: ColorMode;
  label: string;
}

export const COLOR_MODES: ReadonlyArray<ColorModeInfo> = [
  { id: "height", label: "Depth (elevation)" },
  { id: "distance", label: "Distance from entrance" },
  { id: "inclination", label: "Gradient (steepness)" },
  { id: "survey", label: "Survey / series" },
  { id: "date", label: "Survey date" },
  { id: "single", label: "Single colour" },
];

const GREY: RGB = [0.5, 0.5, 0.55];
const SINGLE: RGB = [0.36, 0.78, 0.98];

/** Legend description for the current colour mode (consumed by the DOM legend). */
export type LegendSpec =
  | { kind: "gradient"; title: string; hi: string; mid: string; lo: string }
  | { kind: "note"; title: string; text: string }
  | { kind: "hidden" };

/** Precomputed data a colour mode needs, built once per (model, mode). */
export interface ColorData {
  mode: ColorMode;
  minZ: number;
  maxZ: number;
  /** Geodesic distance (m) from the nearest entrance, per station id. */
  distance?: Float64Array;
  maxDistance: number;
  /** Survey-date range (days since the Unix epoch); absent when nothing is dated. */
  dateMin?: number;
  dateMax?: number;
}

export function prepareColorData(model: CaveModel, mode: ColorMode): ColorData {
  const minZ = model.metadata.bounds.min[2];
  const maxZ = model.metadata.bounds.max[2];
  if (mode === "distance") {
    const { distance, max } = entranceDistances(model);
    return { mode, minZ, maxZ, distance, maxDistance: max };
  }
  if (mode === "date") {
    let dateMin: number | undefined;
    let dateMax: number | undefined;
    for (const leg of model.legs) {
      const d = legDateDay(leg);
      if (d === null) continue;
      if (dateMin === undefined || d < dateMin) dateMin = d;
      if (dateMax === undefined || d > dateMax) dateMax = d;
    }
    return { mode, minZ, maxZ, maxDistance: 0, dateMin, dateMax };
  }
  return { mode, minZ, maxZ, maxDistance: 0 };
}

/** Colours for a leg's two endpoints, in the same order as [from, to]. */
export function legColors(data: ColorData, model: CaveModel, leg: Leg): [RGB, RGB] {
  switch (data.mode) {
    case "height": {
      const span = data.maxZ - data.minZ || 1;
      const a = model.stations[leg.from];
      const b = model.stations[leg.to];
      return [depthColor((a.z - data.minZ) / span), depthColor((b.z - data.minZ) / span)];
    }
    case "distance": {
      const dist = data.distance!;
      const max = data.maxDistance || 1;
      const ca = colorForDistance(dist[leg.from], max);
      const cb = colorForDistance(dist[leg.to], max);
      return [ca, cb];
    }
    case "inclination": {
      const c = inclinationColor(model, leg);
      return [c, c];
    }
    case "survey": {
      const c = leg.survey ? surveyColor(leg.survey) : GREY;
      return [c, c];
    }
    case "date": {
      const d = legDateDay(leg);
      if (d === null || data.dateMin === undefined || data.dateMax === undefined) {
        return [GREY, GREY];
      }
      const span = data.dateMax - data.dateMin;
      const c = depthColor(span > 0 ? (d - data.dateMin) / span : 0.5);
      return [c, c];
    }
    case "single":
      return [SINGLE, SINGLE];
  }
}

export function legendSpecFor(data: ColorData): LegendSpec {
  switch (data.mode) {
    case "height":
      return {
        kind: "gradient",
        title: "Elevation",
        hi: `${data.maxZ.toFixed(1)} m`,
        mid: `${((data.maxZ + data.minZ) / 2).toFixed(1)} m`,
        lo: `${data.minZ.toFixed(1)} m`,
      };
    case "distance":
      return {
        kind: "gradient",
        title: "From entrance",
        hi: `${data.maxDistance.toFixed(0)} m`,
        mid: `${(data.maxDistance / 2).toFixed(0)} m`,
        lo: "0 m",
      };
    case "inclination":
      return {
        kind: "gradient",
        title: "Gradient",
        hi: "+90° up",
        mid: "level",
        lo: "−90° down",
      };
    case "survey":
      return { kind: "note", title: "Colour", text: "by survey / series" };
    case "date":
      if (data.dateMin === undefined || data.dateMax === undefined) {
        return { kind: "note", title: "Survey date", text: "no dates recorded" };
      }
      return {
        kind: "gradient",
        title: "Survey date",
        hi: isoOfDay(data.dateMax),
        mid: isoOfDay((data.dateMin + data.dateMax) / 2),
        lo: isoOfDay(data.dateMin),
      };
    case "single":
      return { kind: "hidden" };
  }
}

const MS_PER_DAY = 86400000;

/** A leg's date as days since the Unix epoch (midpoint of its range), if dated. */
function legDateDay(leg: Leg): number | null {
  if (!leg.date) return null;
  const a = Date.parse(leg.date.from);
  const b = Date.parse(leg.date.to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (a + b) / 2 / MS_PER_DAY;
}

function isoOfDay(day: number): string {
  return new Date(Math.round(day * MS_PER_DAY)).toISOString().slice(0, 10);
}

function colorForDistance(d: number, max: number): RGB {
  if (!Number.isFinite(d)) return GREY;
  return depthColor(d / max);
}

function inclinationColor(model: CaveModel, leg: Leg): RGB {
  const a = model.stations[leg.from];
  const b = model.stations[leg.to];
  const dz = b.z - a.z;
  const horiz = Math.hypot(b.x - a.x, b.y - a.y);
  const deg = (Math.atan2(dz, horiz) * 180) / Math.PI; // −90..+90
  return depthColor((deg + 90) / 180); // level -> mid, up -> warm, down -> cool
}

/** Stable colour for a survey path: hash the string to a hue. */
export function surveyColor(survey: string): RGB {
  let h = 0;
  for (let i = 0; i < survey.length; i++) {
    h = (h * 31 + survey.charCodeAt(i)) >>> 0;
  }
  return hslToRgb(h % 360, 0.6, 0.6);
}

/**
 * Multi-source Dijkstra: geodesic distance along centreline legs from the
 * nearest entrance. Falls back to fixed stations, then to station 0, if no
 * entrances are flagged. Splay shots are excluded from the graph.
 */
export function entranceDistances(model: CaveModel): {
  distance: Float64Array;
  max: number;
} {
  const n = model.stations.length;
  const distance = new Float64Array(n).fill(Infinity);
  if (n === 0) return { distance, max: 0 };

  // Build adjacency from non-splay legs.
  const adj: Array<Array<{ to: number; w: number }>> = Array.from({ length: n }, () => []);
  for (const leg of model.legs) {
    if (leg.flags.splay) continue;
    const a = model.stations[leg.from];
    const b = model.stations[leg.to];
    const w = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    adj[leg.from].push({ to: leg.to, w });
    adj[leg.to].push({ to: leg.from, w });
  }

  const sources = chooseSources(model);
  const heap = new MinHeap();
  for (const s of sources) {
    distance[s] = 0;
    heap.push(s, 0);
  }

  let max = 0;
  while (heap.size > 0) {
    const { id, dist } = heap.pop();
    if (dist > distance[id]) continue; // stale entry
    if (dist > max) max = dist;
    for (const edge of adj[id]) {
      const nd = dist + edge.w;
      if (nd < distance[edge.to]) {
        distance[edge.to] = nd;
        heap.push(edge.to, nd);
      }
    }
  }
  return { distance, max };
}

function chooseSources(model: CaveModel): number[] {
  const entrances = model.stations.filter((s) => s.flags.entrance).map((s) => s.id);
  if (entrances.length > 0) return entrances;
  const fixed = model.stations.filter((s) => s.flags.fixed).map((s) => s.id);
  if (fixed.length > 0) return fixed;
  return model.stations.length > 0 ? [0] : [];
}

/** A small binary min-heap keyed by distance. */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): { id: number; dist: number } {
    const id = this.ids[0];
    const dist = this.keys[0];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      this.siftDown(0);
    }
    return { id, dist };
  }

  private siftDown(i: number): void {
    const n = this.ids.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let m = i;
      if (l < n && this.keys[l] < this.keys[m]) m = l;
      if (r < n && this.keys[r] < this.keys[m]) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
  }

  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
