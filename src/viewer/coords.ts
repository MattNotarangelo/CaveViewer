/**
 * Axis mapping between Survex/surveying coordinates and Three.js world space.
 *
 *   Survex:  x = East,  y = North,  z = Up
 *   Three:   x = East,  y = Up,     z = South (-North)
 *
 * This keeps a right-handed frame with vertical mapped to Three's up-axis, so
 * OrbitControls behaves naturally and the depth/Z meaning is preserved. The
 * parser stays axis-faithful; ALL remapping lives here in the viewer.
 */
import type { Vec3 } from "../parser/index";

export function surveyToThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

/** North as a unit vector in Three world space. */
export const NORTH_THREE: Readonly<[number, number, number]> = [0, 0, -1];

export function boundsCenterThree(min: Vec3, max: Vec3): [number, number, number] {
  const [cx, cy, cz] = surveyToThree(
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  );
  return [cx, cy, cz];
}
