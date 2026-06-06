/**
 * Generates `public/example-cave.3d` — a synthetic but plausible cave used by the
 * "Load example cave" button. Deterministic (no RNG): a descending helical main
 * passage with a branching side gallery, named stations, dates, LRUD cross-
 * sections, and — so the "Show" toggles have something to act on — splay shots,
 * an above-ground surface tie to a second entrance, and a duplicate (re-survey)
 * leg. Written with the from-spec encoder; the committed binary is
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

// --- Splay shots: wall/floor/ceiling shots fanned radially from stations along
//     the main passage. They are not part of the centreline (hidden by default);
//     toggling "Splays" reveals the passage's rough shape and size. ---
const SPLAY_LEN = 4 * M;
const splayDirs = [
  { dx: 1, dy: 0.2, dz: 0.2 },
  { dx: -0.8, dy: 0.8, dz: 0.1 },
  { dx: 0.1, dy: -1, dz: 0.2 },
  { dx: 0, dy: 0, dz: 1 }, // ceiling
  { dx: 0, dy: 0, dz: -1 }, // floor
];
for (let i = 6; i <= MAIN_STEPS; i += 8) {
  const s = main[i];
  for (const d of splayDirs) {
    items.push({ t: "move", x: s.x, y: s.y, z: s.z });
    items.push({
      t: "line",
      survey: "main",
      splay: true,
      x: s.x + Math.round(d.dx * SPLAY_LEN),
      y: s.y + Math.round(d.dy * SPLAY_LEN),
      z: s.z + Math.round(d.dz * SPLAY_LEN),
    });
  }
}

// --- Surface tie: an above-ground traverse from the entrance to a second
//     entrance on the hillside. Shown by default; toggle "Surface" to hide. ---
const e2 = { x: main[0].x + 25 * M, y: main[0].y + 18 * M, z: 6 * M };
items.push({ t: "move", x: main[0].x, y: main[0].y, z: main[0].z });
items.push({ t: "line", x: main[0].x + 9 * M, y: main[0].y + 6 * M, z: 3 * M, survey: "surface", surface: true });
items.push({ t: "line", x: main[0].x + 17 * M, y: main[0].y + 13 * M, z: 5 * M, survey: "surface", surface: true });
items.push({ t: "line", x: e2.x, y: e2.y, z: e2.z, survey: "surface", surface: true });
items.push({ t: "label", x: e2.x, y: e2.y, z: e2.z, name: "entrance2", entrance: true, surface: true });

// --- Duplicate leg: a re-survey tie between main.10 and main.20, bowed out so it
//     is visible. Flagged duplicate so it isn't double-counted in total length.
//     Shown by default; toggle "Duplicate" to hide. ---
const a10 = main[10];
const a20 = main[20];
const midDup = {
  x: Math.round((a10.x + a20.x) / 2) + 4 * M,
  y: Math.round((a10.y + a20.y) / 2) + 4 * M,
  z: Math.round((a10.z + a20.z) / 2),
};
items.push({ t: "move", x: a10.x, y: a10.y, z: a10.z });
items.push({ t: "line", x: midDup.x, y: midDup.y, z: midDup.z, survey: "main", duplicate: true });
items.push({ t: "line", x: a20.x, y: a20.y, z: a20.z, survey: "main", duplicate: true });

const bytes = encode3d({
  title: "Example Cave (synthetic)",
  separator: ".",
  datestamp: "@1700000000",
  items,
});

const out = fileURLToPath(new URL("../public/example-cave.3d", import.meta.url));
writeFileSync(out, bytes);
console.log(`Wrote ${out} (${bytes.length} bytes, ${items.length} items)`);
