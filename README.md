# Cave Survey Viewer

A modern, web-native 3D viewer for cave survey data. Drag a survey file onto the
page and get an interactive, depth-coloured 3D model you can orbit, pan, and zoom.

**Everything runs client-side. Your survey files never leave your machine —
nothing is uploaded.** Cave survey data is private to its surveyors, so this is a
feature, not a limitation. The app deploys as a pure static site.

![Example cave render](docs/example-render.png)

## Status

| Phase | Scope | State |
|-------|-------|-------|
| **1** | Survex `.3d` (v8): centreline render, orbit/pan/zoom, depth colouring, drag-and-drop, fit-to-view, length/bounds readout, north indicator | ✅ done |
| **1+** | Preset plan/elevation views, orthographic toggle, scale bar, colour modes (elevation / distance-from-entrance / gradient / survey / date / single), leg-type visibility toggles, PNG export _(ideas adopted from [CaveView.js](https://github.com/aardgoose/CaveView.js))_ | ✅ done |
| **2** | **Compass `.plt`** (processed coordinates, LRUD, splays, multi-survey) | ✅ done |
| **3** | **Therion `.lox`** + lit triangle-mesh passage walls (the modelled scrap surfaces); **LRUD passage tubes** reconstructed for `.3d`/`.plt` | ✅ done |
| **4** | **Interaction & UX**: ViewCube navigation (drag to orbit, click a face to snap); click a station for its details; hover labels + station finder; **measure tool** (straight-line / horizontal / vertical / bearing / shortest route along the cave); **survey-tree show/hide**; **vertical exaggeration**; entrance & fixed-point markers; light/dark theme; metric/imperial units; render-on-demand (idle GPU) | ✅ done |
| **5** | **PocketTopo `.top`** (raw DistoX shots: declination, repeated-shot averaging, splays, reference anchoring, trip dates) | ✅ done |
| next | Cross-sections from splays; clipping plane / depth cursor; depth fog | planned |

## Architecture

The project is split into two cleanly separated parts. **The parser is the
durable asset; the renderer is the demo on top.**

```
src/
  parser/          # No dependency on the renderer. Independently testable.
    types.ts       # The CaveModel contract (see below)
    byteCursor.ts  # Little-endian binary reader with bounds checking
    survex3d.ts    # Survex .3d v8 parser
    compassPlt.ts  # Compass .plt parser
    therionLox.ts  # Therion .lox parser (centreline + scrap wall meshes)
    pocketTopoTop.ts # PocketTopo .top parser (raw shots → coordinates)
    caveStats.ts   # Derived stats (total length, depth range, ...)
    index.ts       # parseCaveFile(filename, buffer) dispatcher + exports
  viewer/          # Three.js. Consumes a CaveModel; knows nothing about files.
    Viewer.ts          # Scene, cameras, OrbitControls, picking, render-on-demand
    buildCenterline.ts # Fat-line centreline (colour + leg/survey visibility)
    buildLrudTubes.ts  # LRUD → passage tubes for .3d/.plt
    coloring.ts, colormap.ts, coords.ts, legend.ts, scaleBar.ts
    northIndicator.ts  # Compass needle
    viewCube.ts        # Autodesk-style navigation cube
    surveyTree.ts      # Survey-hierarchy build + leg-visibility logic (pure)
  ui/              # Vanilla DOM (framework-light by design)
    hud.ts, controls.ts, units.ts
    stationInfo.ts, stationSearch.ts, measurePanel.ts, surveyTreePanel.ts
  main.ts          # Wires parser → viewer → DOM
```

Every format parser converts its input into **one** normalized model, so the UI
can be rewritten without touching parsing, and new formats reuse the whole renderer.

### The CaveModel contract

```ts
interface CaveModel {
  metadata: {
    title: string;
    format: string;          // e.g. "survex-3d-v8"
    separator: string;       // survey hierarchy separator (default ".")
    crs?: string;            // coordinate reference system, if declared
    datestamp?: string;
    dateRange?: { from: string; to: string };   // ISO YYYY-MM-DD
    bounds: { min: Vec3; max: Vec3 };            // metres
    isExtendedElevation: boolean;
  };
  stations: { id, label, x, y, z, flags }[];     // x=East, y=North, z=Up (metres)
  legs:     { from, to, flags, survey?, date? }[]; // from/to index into stations
  walls?:   { positions: Float32Array; indices: Uint32Array };  // .lox triangle mesh
  lrud?:    { station, l, r, u, d, lastInPassage }[];           // passage cross-sections
}
```

Axes follow the surveying convention (`x`=East, `y`=North, `z`=Up), in **metres**.
The parser stays axis-faithful; all axis remapping for rendering lives in
`viewer/coords.ts`.

## Supported formats & spec references

| Format | Type | Spec / reference |
|--------|------|------------------|
| Survex `.3d` (v8) | binary | [Official 3d format spec](https://survex.com/docs/3dformat.htm); cross-checked against Survex's reference reader [`src/img.c`](https://github.com/ojwb/survex/blob/master/src/img.c) (`img_read_item_new`, `read_v8label`) |
| Compass `.plt` | text | Cross-checked against Survex's reference Compass reader [`src/img.c`](https://github.com/ojwb/survex/blob/master/src/img.c); coordinates are North/East/Up in feet → metres |
| Therion `.lox` | binary | Reverse-engineered from Therion's reference reader [`src/common-utils/lxFile.{h,cxx}`](https://github.com/therion/therion/blob/master/src/common-utils/lxFile.cxx) (chunked format; record fields follow each struct's `Load()`, not the `.h` declaration order) |
| PocketTopo `.top` (v3) | binary | Cross-checked against TopoDroid's [`ptopo`](https://github.com/marcocorvi/topodroid/tree/master/src/com/topodroid/ptopo) package, a port of Beat Heeb's reference implementation (incl. his 2026 station-id corrections); angles are 1/65536 of a circle, distances in mm |

The `.3d` parser implements the v8 layout exactly — byte offsets are taken from
the spec and the reference C reader, not guessed. Files older than v8 are rejected
with a clear message (re-save with a recent `cavern`, which writes v8 by default).
The `.plt` parser reads Compass's processed plot coordinates, LRUD passage data,
splay/duplicate/surface shot flags, and multi-survey sections. The `.lox` parser
reads the centreline plus the modelled passage-wall triangle meshes ("scraps"),
which the viewer renders as a lit, translucent surface — `.lox` is validated by a
cross-format test against the same cave's `.3d`.

The `.top` parser is different in kind: PocketTopo files store **raw shot
measurements** (distance / azimuth / inclination), not processed coordinates, so
the parser also acts as a minimal processor — it applies each trip's magnetic
declination, averages consecutive repeats of the same shot (the standard DistoX
triple-shot practice), turns shots with an undefined target into splays, and
propagates station positions breadth-first from reference points (or the origin).
Survey loops are **not** adjusted: redundant legs keep the first position
reached, so a loop's misclosure stays visible rather than being distributed.

## Develop, test, build

Requires Node 20+.

```bash
npm install
npm run dev          # Vite dev server with HMR
npm test             # parser test suite (vitest)
npm run typecheck    # tsc --noEmit
npm run build        # type-check then produce static site in dist/
npm run preview      # serve the production build locally
```

The "Load example cave" button loads `public/system_migovec.lox` — the Tolminski
Migovec cave system (~47 km, 21k+ stations), surveyed by the JSPDT and Imperial
College Caving Club and published openly by the [Migovec Resurvey
Project](https://github.com/iccaving/migovec-survey-data). It exercises the
viewer on a real, large survey, including the modelled passage-wall mesh that
`.lox` carries. See [`NOTICE`](./NOTICE) for attribution.

### Testing — parser correctness is the whole ballgame

A plausible render is **not** proof the parser is correct; the numbers must match.

- **Golden test** (`test/survex3d.golden.test.ts`): parses a **real** `cavern`-written
  v8 file (`dump3ddate.3d`, vendored from Survex's own test suite) and asserts every
  leg coordinate, station label, and date against Survex's own `dump3d` reference
  output. This is the ground-truth oracle. See `test/fixtures/survex/PROVENANCE.md`.
- **Round-trip / edge cases** (`test/survex3d.encode.test.ts`): a from-spec encoder
  exercises paths the golden fixture lacks — labelled LINEs, splay/surface/duplicate
  flags, XSECT (narrow + wide), anonymous stations, CRS/separator headers, ERROR and
  DATE records, the `(del=0, add=0)` label escape, and error handling.
- **Compass golden test** (`test/compassPlt.golden.test.ts`): parses a real `.plt`
  (`multisurvey.plt`) and asserts stations, legs (incl. splays), and LRUD against
  Survex's own decode of the same file (`multisurvey.dump`) — an independent oracle.
- **Therion golden test** (`test/therionLox.golden.test.ts`): cross-checks the `.lox`
  parse of a real cave against the same cave's `.3d`, so the reverse-engineered
  binary layout is anchored to reference-tool output.
- **PocketTopo round-trip** (`test/pocketTopo.encode.test.ts`): a from-spec encoder
  builds synthetic `.top` files and the tests assert the *computed* geometry —
  declination, repeated-shot averaging, splays, reference anchoring, trip dates,
  plain-number vs `major.minor` station ids, and error handling.
- **Pure-logic unit tests** cover the non-parser building blocks too — unit
  conversion/formatting (`test/units.test.ts`) and the survey-tree hierarchy +
  leg-visibility logic (`test/surveyTree.test.ts`).

## Deploy — Cloudflare Pages

Pure static output, no server code or functions.

| Setting | Value |
|---------|-------|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 20 |

Auto-deploys on push to `main`. The build emits a relative `base` so it works from
any path.

## Adding a new format parser

1. Create `src/parser/<format>.ts` exporting `parse<Format>(buffer: ArrayBuffer): CaveModel`.
   Depend only on `types.ts` and `byteCursor.ts` — never on the renderer.
2. For binary formats, work against the **official spec**; for byte layouts,
   cross-check a reference implementation rather than guessing.
3. Dispatch to it by extension in `parseCaveFile` (`src/parser/index.ts`).
4. Commit a **small fixture with known coordinates** and a golden test that asserts
   the numbers — ideally validated against the format's own reference tooling.
5. The renderer needs no changes: it consumes the normalized `CaveModel`.

## Controls

Two drag schemes, toggled by the **"Drag: Pan / Orbit"** toolbar button (your
choice is remembered):

- **Pan** (default, Google Earth–style): left-drag pans · right-drag orbits (rotate + tilt) · scroll zooms
- **Orbit** (3D-viewer / Aven-style): left-drag orbits · right-drag pans · scroll zooms

**ViewCube** (bottom-right): drag the cube to orbit, or click a face to snap to
that view. Replaces dedicated cardinal-elevation buttons — the faces are labelled
with the compass directions.

**View controls** (panel, top-right):

- **Quick views**: Plan (top-down, North up — locked to orthographic) and 3D. <kbd>P</kbd> = plan.
- **Projection**: toggle Perspective ⇄ Orthographic (true-scale); locked to orthographic in plan view.
- **Colour by**: elevation, distance-from-entrance, gradient (steepness), survey/series, survey date (oldest cool → newest warm; undated legs grey), or single colour. The legend adapts to the mode.
- **Vertical exaggeration**: a 1×–8× slider to stretch deep caves vertically (no effect in plan).
- **Show**: toggle splay / surface / duplicate legs, and the passage-wall mesh (Walls — Therion `.lox` scrap meshes, or tubes reconstructed from LRUD cross-sections for `.3d`/`.plt`).
- **Surveys**: a collapsible tree to show/hide individual survey series.
- **Find station…**: type to locate a station; choosing one pans to it and selects it.

**Selecting & measuring:**

- **Hover** a station to see its name; **click** it for a panel with name, position, elevation, and distance from the entrance. Entrances (green) and fixed points (amber) are marked.
- **Measure**: toolbar toggle; click two stations for the straight-line / horizontal / vertical distance and compass bearing, plus the shortest **route distance along the cave** (the route is highlighted in the view; “no route” if the stations aren't connected).

**Toolbar** (bottom):

- **Fit to view**: the "Fit view" button or press <kbd>F</kbd>.
- **Save PNG**: download the current view as an image.
- **Units**: toggle metric ⇄ imperial. **Theme**: toggle dark ⇄ light. (Both remembered.)
- **Open a file**: drag-and-drop a `.3d` / `.plt` / `.lox` / `.top` anywhere, or use "Open file…".

## License

This project is licensed under the **GNU Affero General Public License v3.0 or
later** (`SPDX-License-Identifier: AGPL-3.0-or-later`) — see [`LICENSE`](./LICENSE).

This is a strong copyleft licence: you are free to use, modify, and even sell this
software, **but** any version you distribute **or host as a network service** must
make its complete corresponding source code available under the same licence. In
short — no closed-source forks, and no closed-source hosted deployments.

**Test vectors:** `test/fixtures/survex/` and `test/fixtures/compass/` vendor small
reference test vectors from the [Survex](https://survex.com/) project (GPL v2+,
which is licence-compatible with AGPL-3.0), used **only** by the test suite to
validate parser interoperability against genuine reference-tool output. They are
not imported by the app and are not in the build output. See each directory's
`PROVENANCE.md` and the top-level [`NOTICE`](./NOTICE) for details.

**Contributing:** by submitting a contribution (e.g. a pull request) you agree to
license it under the project's licence, AGPL-3.0-or-later (inbound = outbound).
