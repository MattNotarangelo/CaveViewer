/**
 * Reconstruct passage-wall geometry from LRUD cross-sections, for formats that
 * carry LRUD but no modelled walls (Survex .3d XSECT, Compass .plt). At each
 * station an elliptical cross-section is built from the Left/Right/Up/Down
 * half-widths, oriented to the passage direction, and consecutive sections are
 * lofted into a tube — the same `{positions, indices}` mesh shape the Therion
 * .lox scrap walls use, so the viewer renders and toggles them identically.
 *
 * This is a deliberately simple, robust per-leg loft: each centreline leg whose
 * both endpoints have LRUD becomes its own tube segment. Segments abut at shared
 * stations; at sharp bends/junctions they can slightly overlap rather than join
 * seamlessly (the hard part the brief calls out). Pure geometry — no Three.js.
 */
import type { CaveModel, Lrud, Station } from "../parser/index";

/** Points sampled around each cross-section ring. */
const RING = 10;

export interface TubeMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function buildLrudTubes(model: CaveModel): TubeMesh {
  const byStation = new Map<number, Lrud>();
  for (const x of model.lrud ?? []) {
    if (x.l !== null || x.r !== null || x.u !== null || x.d !== null) {
      byStation.set(x.station, x);
    }
  }

  const positions: number[] = [];
  const indices: number[] = [];
  if (byStation.size === 0) return finalize(positions, indices);

  // Precompute the ring's unit (cos, sin) samples.
  const ring: Array<[number, number]> = [];
  for (let k = 0; k < RING; k++) {
    const a = (2 * Math.PI * k) / RING;
    ring.push([Math.cos(a), Math.sin(a)]);
  }

  for (const leg of model.legs) {
    if (leg.flags.splay || leg.flags.surface || leg.flags.duplicate) continue;
    const la = byStation.get(leg.from);
    const lb = byStation.get(leg.to);
    if (!la || !lb) continue;
    const a = model.stations[leg.from];
    const b = model.stations[leg.to];

    const t = sub(b, a);
    const len = mag(t);
    if (len < 1e-6) continue;
    scale(t, 1 / len);
    const { right, up } = crossSectionBasis(t);

    const baseA = positions.length / 3;
    addRing(positions, a, la, ring, right, up);
    const baseB = positions.length / 3;
    addRing(positions, b, lb, ring, right, up);

    for (let k = 0; k < RING; k++) {
      const k2 = (k + 1) % RING;
      // two triangles per quad between ring A and ring B
      indices.push(baseA + k, baseA + k2, baseB + k2);
      indices.push(baseA + k, baseB + k2, baseB + k);
    }
  }

  return finalize(positions, indices);
}

function addRing(
  positions: number[],
  s: Station,
  lrud: Lrud,
  ring: Array<[number, number]>,
  right: Vec3,
  up: Vec3,
): void {
  const l = lrud.l ?? 0;
  const r = lrud.r ?? 0;
  const u = lrud.u ?? 0;
  const d = lrud.d ?? 0;
  for (const [cx, cy] of ring) {
    // Elliptical ring scaled per quadrant by the L/R/U/D half-widths.
    const offR = cx >= 0 ? r * cx : l * cx; // cx<0 -> moves along -right (left wall)
    const offU = cy >= 0 ? u * cy : d * cy; // cy<0 -> moves along -up (floor)
    positions.push(
      s.x + right.x * offR + up.x * offU,
      s.y + right.y * offR + up.y * offU,
      s.z + right.z * offR + up.z * offU,
    );
  }
}

/**
 * An orthonormal cross-section frame for a passage tangent `t`:
 * `right` is horizontal and perpendicular to the passage; `up` completes it
 * (vertical for horizontal passages). Falls back gracefully for vertical pitches.
 */
function crossSectionBasis(t: Vec3): { right: Vec3; up: Vec3 } {
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 };
  let right = cross(t, worldUp);
  if (mag(right) < 1e-6) right = cross(t, { x: 1, y: 0, z: 0 }); // vertical passage
  scale(right, 1 / mag(right));
  const up = cross(right, t);
  scale(up, 1 / mag(up));
  return { right, up };
}

function finalize(positions: number[], indices: number[]): TubeMesh {
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function mag(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}
function scale(v: Vec3, s: number): void {
  v.x *= s;
  v.y *= s;
  v.z *= s;
}
