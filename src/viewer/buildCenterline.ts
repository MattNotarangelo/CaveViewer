/**
 * Build fat-line centreline geometry from a CaveModel, coloured by depth.
 * Splay shots (wall radials) are excluded — they are not part of the centreline.
 */
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { CaveModel } from "../parser/index";
import { depthColor } from "./colormap";
import { surveyToThree } from "./coords";

export interface CenterlineGeometry {
  geometry: LineSegmentsGeometry;
  /** Number of leg segments included. */
  segmentCount: number;
}

export function buildCenterline(model: CaveModel): CenterlineGeometry {
  const minZ = model.metadata.bounds.min[2];
  const maxZ = model.metadata.bounds.max[2];
  const span = maxZ - minZ || 1; // avoid divide-by-zero for flat caves

  const positions: number[] = [];
  const colors: number[] = [];
  let segmentCount = 0;

  for (const leg of model.legs) {
    if (leg.flags.splay) continue;
    const a = model.stations[leg.from];
    const b = model.stations[leg.to];

    const [ax, ay, az] = surveyToThree(a.x, a.y, a.z);
    const [bx, by, bz] = surveyToThree(b.x, b.y, b.z);
    positions.push(ax, ay, az, bx, by, bz);

    const ca = depthColor((a.z - minZ) / span);
    const cb = depthColor((b.z - minZ) / span);
    colors.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]);
    segmentCount++;
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  geometry.setColors(colors);
  return { geometry, segmentCount };
}
