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

export function surveyToThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

/** North as a unit vector in Three world space. */
export const NORTH_THREE: Readonly<[number, number, number]> = [0, 0, -1];
