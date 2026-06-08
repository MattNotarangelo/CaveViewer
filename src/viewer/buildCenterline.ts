/**
 * Build fat-line centreline geometry from a CaveModel, coloured by the selected
 * mode, with per-leg-type visibility. "Cave" (normal) legs are always shown;
 * splay/surface/duplicate legs are optional.
 */
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { CaveModel } from "../parser/index";
import {
  legColors,
  prepareColorData,
  type ColorMode,
  type LegendSpec,
  legendSpecFor,
} from "./coloring";
import { surveyToThree } from "./coords";
import { isLegHidden } from "./surveyTree";

export interface LegVisibility {
  splay: boolean;
  surface: boolean;
  duplicate: boolean;
}

export interface CenterlineOptions {
  colorMode: ColorMode;
  show: LegVisibility;
  /** Survey paths toggled off in the survey tree (with their descendants). */
  hiddenSurveys?: ReadonlySet<string>;
}

export interface CenterlineGeometry {
  geometry: LineSegmentsGeometry;
  segmentCount: number;
  legend: LegendSpec;
}

export function buildCenterline(
  model: CaveModel,
  options: CenterlineOptions,
): CenterlineGeometry {
  const data = prepareColorData(model, options.colorMode);
  const { show } = options;
  const hidden = options.hiddenSurveys;
  const sep = model.metadata.separator || ".";

  const positions: number[] = [];
  const colors: number[] = [];
  let segmentCount = 0;

  for (const leg of model.legs) {
    if (leg.flags.splay && !show.splay) continue;
    if (leg.flags.surface && !show.surface) continue;
    if (leg.flags.duplicate && !show.duplicate) continue;
    if (hidden && isLegHidden(leg.survey, hidden, sep)) continue;

    const a = model.stations[leg.from];
    const b = model.stations[leg.to];
    const [ax, ay, az] = surveyToThree(a.x, a.y, a.z);
    const [bx, by, bz] = surveyToThree(b.x, b.y, b.z);
    positions.push(ax, ay, az, bx, by, bz);

    const [ca, cb] = legColors(data, model, leg);
    colors.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]);
    segmentCount++;
  }

  const geometry = new LineSegmentsGeometry();
  if (segmentCount > 0) {
    geometry.setPositions(positions);
    geometry.setColors(colors);
  }
  return { geometry, segmentCount, legend: legendSpecFor(data) };
}
