/**
 * Derived statistics over a CaveModel. Kept separate from the model so the model
 * stays pure data and these can evolve independently.
 */

import { CaveModel } from "./types";

export interface CaveStats {
  stationCount: number;
  legCount: number;
  /** Total length (m) of "real" centreline legs: excludes splay, surface, duplicate. */
  totalLengthM: number;
  /** Total length (m) of every leg, including splays/surface/duplicates. */
  totalLengthAllM: number;
  /** Vertical extent (m): max elevation minus min elevation. */
  depthRangeM: number;
  /** Size of the bounding box per axis (m): [east, north, vertical]. */
  extentM: readonly [number, number, number];
}

function legLength(model: CaveModel, fromId: number, toId: number): number {
  const a = model.stations[fromId];
  const b = model.stations[toId];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function caveStats(model: CaveModel): CaveStats {
  let totalLengthM = 0;
  let totalLengthAllM = 0;
  for (const leg of model.legs) {
    const len = legLength(model, leg.from, leg.to);
    totalLengthAllM += len;
    if (!leg.flags.splay && !leg.flags.surface && !leg.flags.duplicate) {
      totalLengthM += len;
    }
  }
  const { min, max } = model.metadata.bounds;
  return {
    stationCount: model.stations.length,
    legCount: model.legs.length,
    totalLengthM,
    totalLengthAllM,
    depthRangeM: max[2] - min[2],
    extentM: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}
