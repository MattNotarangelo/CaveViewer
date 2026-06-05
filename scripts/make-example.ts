/**
 * Generates `public/example-cave.3d` — a synthetic but plausible cave used by the
 * "Load example cave" button. Deterministic (no RNG): a descending helical main
 * passage with a branching side gallery, named stations, dates, and a few LRUD
 * cross-sections. Written with the from-spec encoder; the committed binary is
 * decoded by the same parser the app ships, so generating it also smoke-tests
 * the round-trip.
 *
 * Run: `npm run gen:example`
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encode3d, type Encode3dItem } from "../test/helpers/encode3d";

const M = 100; // centimetres per metre
const items: Encode3dItem[] = [];

function deg(d: number): number {
  return (d * Math.PI) / 180;
}

// Day numbers since 1900-01-01 for a couple of survey trips.
const TRIP1 = 45000; // ~2023
const TRIP2 = 45100;

// --- Main passage: a descending helix, ~15 m radius, ~1.3 m drop per step. ---
const MAIN_STEPS = 110;
const RADIUS = 15 * M;
const DROP = 130; // cm per step
type P = { x: number; y: number; z: number };
const main: P[] = [];
for (let i = 0; i <= MAIN_STEPS; i++) {
  const a = deg(i * 11);
  main.push({
    x: Math.round(RADIUS * Math.cos(a)),
    y: Math.round(RADIUS * Math.sin(a)),
    z: -i * DROP,
  });
}

// Entrance station (fixed control point) + first move.
items.push({ t: "label", x: main[0].x, y: main[0].y, z: main[0].z, name: "entrance", entrance: true, fixed: true, underground: true });
items.push({ t: "date-single", days: TRIP1 });
items.push({ t: "move", x: main[0].x, y: main[0].y, z: main[0].z });
for (let i = 1; i <= MAIN_STEPS; i++) {
  const p = main[i];
  items.push({ t: "line", x: p.x, y: p.y, z: p.z, survey: "main" });
  // Name every 10th station.
  if (i % 10 === 0) {
    items.push({ t: "label", x: p.x, y: p.y, z: p.z, name: `main.${i}`, underground: true });
  }
}

// --- Side gallery: branches off main.40, heads outward and gently down. ---
const branchStart = main[40];
items.push({ t: "label", x: branchStart.x, y: branchStart.y, z: branchStart.z, name: "main.40", underground: true, exported: true });
items.push({ t: "date-single", days: TRIP2 });
items.push({ t: "move", x: branchStart.x, y: branchStart.y, z: branchStart.z });
const BRANCH_STEPS = 40;
let bx = branchStart.x;
let by = branchStart.y;
let bz = branchStart.z;
for (let i = 1; i <= BRANCH_STEPS; i++) {
  // Head roughly east-north-east, undulating, descending slowly.
  bx += 180 + Math.round(40 * Math.sin(deg(i * 25)));
  by += 90 + Math.round(60 * Math.cos(deg(i * 18)));
  bz -= 35 + Math.round(20 * Math.sin(deg(i * 30)));
  items.push({ t: "line", x: bx, y: by, z: bz, survey: "branch" });
  if (i % 10 === 0) {
    items.push({ t: "label", x: bx, y: by, z: bz, name: `branch.${i}`, underground: true });
  }
}
// End chamber with a passage cross-section.
items.push({ t: "label", x: bx, y: by, z: bz, name: "branch.end", underground: true });
items.push({ t: "xsect", name: "branch.end", l: 3 * M, r: 4 * M, u: 6 * M, d: 1 * M, last: true });
items.push({ t: "xsect", name: "branch.10", l: 2 * M, r: 2 * M, u: 3 * M, d: 1 * M });

const bytes = encode3d({
  title: "Example Cave (synthetic)",
  separator: ".",
  datestamp: "@1700000000",
  items,
});

const out = fileURLToPath(new URL("../public/example-cave.3d", import.meta.url));
writeFileSync(out, bytes);
console.log(`Wrote ${out} (${bytes.length} bytes, ${items.length} items)`);
