/**
 * The Three.js cave viewer: scene, perspective/orthographic cameras, orbit
 * controls, and the fat-line centreline. Consumes a CaveModel; knows nothing
 * about file parsing.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { CaveModel } from "../parser/index";
import { buildCenterline, type LegVisibility } from "./buildCenterline";
import type { ColorMode, LegendSpec } from "./coloring";
import { surveyToThree } from "./coords";
import { buildLrudTubes } from "./buildLrudTubes";

/** What a plain left-drag does. See {@link Viewer.setLeftDragMode}. */
export type LeftDragMode = "pan" | "orbit";
export type Projection = "perspective" | "orthographic";
/** Preset camera viewpoints. Compass letters name the side the camera sits on. */
export type PresetView = "plan" | "N" | "S" | "E" | "W" | "iso";

// Reusable scratch objects for per-frame picking (avoid per-call allocation).
const _pickMat = new THREE.Matrix4();
const _pickVec = new THREE.Vector3();

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Plan view looks (almost) straight down on a vertical-axis frame. The tiny tilt
// toward +Z (South) keeps the up-vector from being parallel to the view (which
// would make lookAt / the ortho fit degenerate) and orients North to the top of
// the screen. It's imperceptible — and under orthographic projection (which plan
// is locked to) it has no visual effect at all.
const PLAN_TILT = 0.012; // radians (~0.7°)
const PLAN_DIR = new THREE.Vector3(0, Math.cos(PLAN_TILT), Math.sin(PLAN_TILT));

// Camera direction (target -> camera) and up vector per preset view.
const VIEW_DIRS: Record<PresetView, { dir: THREE.Vector3; up: THREE.Vector3 }> = {
  plan: { dir: PLAN_DIR, up: WORLD_UP },
  N: { dir: new THREE.Vector3(0, 0, -1), up: WORLD_UP },
  S: { dir: new THREE.Vector3(0, 0, 1), up: WORLD_UP },
  E: { dir: new THREE.Vector3(1, 0, 0), up: WORLD_UP },
  W: { dir: new THREE.Vector3(-1, 0, 0), up: WORLD_UP },
  iso: { dir: new THREE.Vector3(0.6, 0.5, 1).normalize(), up: WORLD_UP },
};

const FOV = 55;

// Picking: a press that moves less than this (px) is a click, not a drag; a
// station within this screen radius (px) of the click is selected.
const CLICK_MOVE_PX = 5;
const PICK_TOLERANCE_PX = 14;

export class Viewer {
  private readonly scene = new THREE.Scene();
  // Holds the cave geometry (lines + walls); its Y-scale is the vertical
  // exaggeration. Markers/measure live outside it so they stay round and are
  // positioned at the exaggerated coordinates directly.
  private readonly modelGroup = new THREE.Group();
  private verticalScale = 1;
  private readonly perspCam: THREE.PerspectiveCamera;
  private readonly orthoCam: THREE.OrthographicCamera;
  private projection: Projection = "perspective";
  private readonly renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private readonly material: LineMaterial;
  private lines: LineSegments2 | null = null;
  private walls: THREE.Mesh | null = null;
  private wallsVisible = true;
  private model: CaveModel | null = null;
  private modelBox = new THREE.Box3();
  private leftDragMode: LeftDragMode = "pan";
  private shiftActive = false;
  private dragging = false;
  private lastPointer: { pointerId: number; clientX: number; clientY: number } | null = null;
  private colorMode: ColorMode = "height";
  private legVisibility: LegVisibility = { splay: false, surface: true, duplicate: true };
  private hiddenSurveys: ReadonlySet<string> = new Set();
  private legend: LegendSpec = { kind: "hidden" };
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;
  private needsRender = true; // draw the first frame; set true on any visual change
  // Plan view is locked top-down + orthographic; remember the projection it was
  // entered from so leaving plan can restore it.
  private inPlan = false;
  private prePlanProjection: Projection | null = null;
  // Station picking: a click (no drag) selects the nearest station in screen
  // space; a marker highlights it.
  private downPos: { x: number; y: number } | null = null;
  private selectedStation: number | null = null;
  private marker: THREE.Mesh | null = null;
  // Persistent markers for entrance / fixed-point stations (+ their station ids
  // so they can be repositioned when vertical exaggeration changes).
  private flagMarkers: THREE.Mesh[] = [];
  private flagStationIds: number[] = [];
  // Pick acceleration: flat Three-space coords for pickable (named) stations,
  // built once per model so hover/click picking doesn't re-walk objects.
  private pickPositions = new Float32Array(0);
  private pickableIds: number[] = [];
  // Hover is coalesced to one pick per animation frame (pointermove can fire
  // many times per frame); the latest screen position waits here.
  private pendingHover: { x: number; y: number } | null = null;
  // Measure tool: pick two stations; draw a line + endpoint markers between them.
  private measuring = false;
  private measurePts: number[] = [];
  private measureMarkers: (THREE.Mesh | null)[] = [null, null];
  private measureLine: THREE.Line | null = null;

  /** Fires whenever the camera moves (north indicator, scale bar). */
  onCameraChange?: () => void;
  /** Fires when the legend should change (colour mode / model change). */
  onLegendChange?: (spec: LegendSpec) => void;
  /** Fires when plan view is entered/left, so the UI can lock the projection toggle. */
  onPlanModeChange?: (inPlan: boolean) => void;
  /** Fires when a station is clicked (or deselected with null). */
  onPick?: (stationId: number | null) => void;
  /** Fires on hover (not dragging) with the station under the cursor, or null. */
  onHover?: (stationId: number | null, clientX: number, clientY: number) => void;
  /** Fires when the measure tool has two endpoints (or null,null when cleared). */
  onMeasure?: (aId: number | null, bId: number | null) => void;

  constructor(private readonly container: HTMLElement) {
    this.scene.background = new THREE.Color(0x10131a);
    this.scene.add(this.modelGroup);

    // Lighting affects only lit materials (the .lox wall mesh); the fat-line
    // centreline is unlit, so these are harmless when no walls are present.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2118, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(0.5, 1, 0.4);
    this.scene.add(sun);

    const { clientWidth: w, clientHeight: h } = container;
    const aspect = w / Math.max(1, h);
    this.perspCam = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 100_000);
    this.perspCam.position.set(10, 10, 10);
    this.orthoCam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100_000);
    this.orthoCam.position.set(10, 10, 10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.controls = this.makeControls();

    this.material = new LineMaterial({
      vertexColors: true,
      linewidth: 2.5, // pixels
      worldUnits: false,
      dashed: false,
      alphaToCoverage: true,
    });
    this.material.resolution.set(w, h);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    // Track drags + the Shift modifier (swaps left-drag pan<->orbit, live).
    const dom = this.renderer.domElement;
    dom.addEventListener("pointerdown", this.onPointerDown);
    dom.addEventListener("pointermove", this.onPointerMove);
    dom.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("keydown", this.onShiftChange);
    window.addEventListener("keyup", this.onShiftChange);

    this.animate();
  }

  // --- Model ---

  /** Replace the displayed cave with a new model and frame it. */
  setModel(model: CaveModel): void {
    this.model = model;
    this.modelBox = this.computeBox(model);
    this.hiddenSurveys = new Set(); // survey visibility is per-model
    this.buildPickCache(model);
    this.clearMarker(); // selection + marker belong to the previous model
    this.clearMeasure();
    this.buildWalls(model); // .lox passage-wall mesh (if any); independent of colour mode
    this.buildFlagMarkers(model); // entrance / fixed-point markers
    this.rebuild();
    this.setView("iso");
  }

  private clearMarker(): void {
    this.selectedStation = null;
    if (this.marker) {
      this.scene.remove(this.marker);
      this.marker.geometry.dispose();
      (this.marker.material as THREE.Material).dispose();
      this.marker = null;
    }
    this.requestRender();
  }

  /**
   * Build the lit triangle-mesh passage walls: the Therion .lox scrap meshes if
   * present, otherwise tubes reconstructed from LRUD cross-sections (.3d/.plt).
   */
  private buildWalls(model: CaveModel): void {
    this.clearWalls();
    let walls = model.walls;
    if ((!walls || walls.indices.length === 0) && model.lrud && model.lrud.length > 0) {
      walls = buildLrudTubes(model);
    }
    if (!walls || walls.indices.length === 0) return;
    const src = walls.positions;
    const remapped = new Float32Array(src.length);
    for (let i = 0; i + 2 < src.length; i += 3) {
      const [x, y, z] = surveyToThree(src[i], src[i + 1], src[i + 2]);
      remapped[i] = x;
      remapped[i + 1] = y;
      remapped[i + 2] = z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(remapped, 3));
    geometry.setIndex(new THREE.BufferAttribute(walls.indices, 1));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0x9a8c78,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      depthWrite: false, // let the centreline show through the translucent walls
    });
    this.walls = new THREE.Mesh(geometry, material);
    this.walls.visible = this.wallsVisible;
    this.modelGroup.add(this.walls);
    this.requestRender();
  }

  /** Show or hide the .lox passage-wall mesh. */
  setWallsVisible(visible: boolean): void {
    this.wallsVisible = visible;
    if (this.walls) this.walls.visible = visible;
    this.requestRender();
  }

  get wallsVisibleState(): boolean {
    return this.wallsVisible;
  }

  /** Whether the current model has a wall mesh (so the UI can show the toggle). */
  get hasWalls(): boolean {
    return this.walls !== null;
  }

  /** Sets the scene clear colour so the 3D view matches the UI theme. */
  setBackground(color: number): void {
    (this.scene.background as THREE.Color).set(color);
    this.requestRender();
  }

  private clearWalls(): void {
    if (this.walls) {
      this.modelGroup.remove(this.walls);
      this.walls.geometry.dispose();
      (this.walls.material as THREE.Material).dispose();
      this.walls = null;
    }
  }

  setColorMode(mode: ColorMode): void {
    this.colorMode = mode;
    this.rebuild();
  }

  get colorModeId(): ColorMode {
    return this.colorMode;
  }

  setLegVisibility(show: LegVisibility): void {
    this.legVisibility = { ...show };
    this.rebuild();
  }

  /** Hide the given survey paths (and their descendants) from the centreline. */
  setHiddenSurveys(hidden: ReadonlySet<string>): void {
    this.hiddenSurveys = hidden;
    this.rebuild();
  }

  get legVisibilityState(): Readonly<LegVisibility> {
    return this.legVisibility;
  }

  get currentLegend(): LegendSpec {
    return this.legend;
  }

  private rebuild(): void {
    if (!this.model) return;
    this.clearLines();
    const { geometry, segmentCount, legend } = buildCenterline(this.model, {
      colorMode: this.colorMode,
      show: this.legVisibility,
      hiddenSurveys: this.hiddenSurveys,
    });
    this.legend = legend;
    this.onLegendChange?.(legend);
    if (segmentCount === 0) {
      geometry.dispose();
      return;
    }
    this.lines = new LineSegments2(geometry, this.material);
    this.lines.computeLineDistances();
    this.modelGroup.add(this.lines);
    this.requestRender();
  }

  // --- Camera framing ---

  /** Frame the whole cave from the default 3D viewpoint. */
  fitToView(): void {
    this.setView("iso");
  }

  /** The model's bounding box with vertical exaggeration applied (rendered extent). */
  private scaledModelBox(): THREE.Box3 {
    const b = this.modelBox.clone();
    b.min.y *= this.vScale();
    b.max.y *= this.vScale();
    return b;
  }

  get verticalExaggeration(): number {
    return this.verticalScale;
  }

  /**
   * Stretch the cave vertically by `scale` (1 = true scale). Geometry scales via
   * a group; markers/measurements reposition to the exaggerated coordinates, and
   * the framed feature is tracked so the view doesn't jump.
   */
  setVerticalScale(scale: number): void {
    const next = Math.max(1, Math.min(scale, 10));
    if (next === this.verticalScale) return;
    const before = this.vScale();
    this.verticalScale = next;
    const after = this.vScale();
    // In plan view vScale() is pinned to 1, so this is a true no-op — the user's
    // zoom/pan is left untouched. Exaggeration takes effect when they leave plan.
    if (after === before) return;
    this.applyVScale();
    const ratio = after / before;
    this.controls.target.y *= ratio;
    this.activeCam.position.y *= ratio;
    this.controls.update();
    this.requestRender();
  }

  /** Apply the effective vertical scale to the geometry group + markers. */
  private applyVScale(): void {
    this.modelGroup.scale.y = this.vScale();
    if (this.selectedStation !== null) this.setSelectedStation(this.selectedStation);
    for (let i = 0; i < this.measurePts.length; i++) {
      this.measureMarkers[i]?.position.copy(this.stationPoint(this.measurePts[i]));
    }
    if (this.measurePts.length === 2) this.drawMeasureLine();
    for (let i = 0; i < this.flagMarkers.length; i++) {
      this.flagMarkers[i].position.copy(this.stationPoint(this.flagStationIds[i]));
    }
    this.requestRender();
  }

  private clearFlagMarkers(): void {
    for (const m of this.flagMarkers) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.flagMarkers = [];
    this.flagStationIds = [];
  }

  /** Place a marker on each entrance (green) and fixed (amber) station. */
  private buildFlagMarkers(model: CaveModel): void {
    this.clearFlagMarkers();
    for (const s of model.stations) {
      const color = s.flags.entrance ? 0x3fb950 : s.flags.fixed ? 0xe3a008 : null;
      if (color === null) continue;
      const m = this.makeSphere(color);
      m.position.copy(this.stationPoint(s.id));
      this.flagMarkers.push(m);
      this.flagStationIds.push(s.id);
    }
  }

  /** Snap to a preset viewpoint and frame the cave. */
  setView(view: PresetView): void {
    if (!this.model) return;
    if (view === "plan") {
      this.enterPlanView();
      return;
    }
    this.exitPlanView(true);
    const { dir, up } = VIEW_DIRS[view];
    this.frame(dir, up);
  }

  /**
   * Frame the cave looking from an arbitrary world direction (target -> camera).
   * Used by the ViewCube's face clicks. The Top face enters locked plan view;
   * other faces are normal snaps (purely-vertical ones get the same tiny tilt as
   * plan so the up-vector stays well-defined).
   */
  snapToDirection(dir: THREE.Vector3): void {
    if (!this.model) return;
    const n = dir.clone().normalize();
    if (n.y > 0.99) {
      this.enterPlanView();
      return;
    }
    this.exitPlanView(true);
    if (Math.abs(n.y) > 0.99) n.set(0, n.y * Math.cos(PLAN_TILT), Math.sin(PLAN_TILT)).normalize();
    this.frame(n, WORLD_UP);
  }

  /**
   * Orbit the camera around the target by the given angle deltas (radians).
   * Drives free rotation from the ViewCube drag, which always leaves the locked
   * plan view and orbits freely in the world-up frame.
   */
  orbit(deltaAzimuth: number, deltaPolar: number): void {
    if (!this.model) return;
    this.exitPlanView(false); // keep projection; a free drag shouldn't snap projection
    const cam = this.activeCam;
    if (cam.up.distanceToSquared(WORLD_UP) > 1e-6) {
      cam.up.copy(WORLD_UP);
      this.syncControlsUp(WORLD_UP);
    }
    const target = this.controls.target;
    const offset = cam.position.clone().sub(target);
    const s = new THREE.Spherical().setFromVector3(offset);
    s.theta -= deltaAzimuth;
    s.phi = Math.max(0.05, Math.min(Math.PI - 0.05, s.phi - deltaPolar));
    offset.setFromSpherical(s);
    cam.position.copy(target).add(offset);
    this.controls.update();
  }

  /** Whether plan view (locked top-down + orthographic) is active. */
  get planLocked(): boolean {
    return this.inPlan;
  }

  /**
   * Enter plan view: force orthographic, frame top-down North-up, then lock the
   * polar angle so dragging can only spin the map about vertical (never tilt
   * out of top-down). Pan/zoom and the global drag toggle are otherwise normal.
   */
  private enterPlanView(): void {
    const wasPlan = this.inPlan;
    if (!wasPlan) {
      this.prePlanProjection = this.projection;
      this.inPlan = true;
      this.applyVScale(); // plan ignores exaggeration → un-stretch before framing
    }
    if (this.projection !== "orthographic") this.applyProjection("orthographic");
    this.frame(VIEW_DIRS.plan.dir, VIEW_DIRS.plan.up);
    this.controls.minPolarAngle = PLAN_TILT;
    this.controls.maxPolarAngle = PLAN_TILT;
    if (!wasPlan) this.onPlanModeChange?.(true);
  }

  /** Leave plan view: unlock the polar angle and optionally restore projection. */
  private exitPlanView(restoreProjection: boolean): void {
    if (!this.inPlan) return;
    this.inPlan = false;
    this.applyVScale(); // restore exaggeration now that we're leaving plan
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    const restore = this.prePlanProjection;
    this.prePlanProjection = null;
    if (restoreProjection && restore && restore !== this.projection) {
      this.applyProjection(restore);
    }
    this.onPlanModeChange?.(false);
  }

  /**
   * OrbitControls captures its up-axis frame (`_quat`) once at construction, so
   * when the camera up changes (e.g. North-up plan) a straight-down view lands
   * on the gimbal pole and inherits stale azimuth as roll — the "random" plan
   * rotation. Re-derive that frame from the current up so every snap is
   * deterministic. Reaches into a private field; guarded so a three.js rename
   * degrades gracefully rather than throwing.
   */
  private syncControlsUp(up: THREE.Vector3): void {
    const c = this.controls as unknown as {
      _quat?: THREE.Quaternion;
      _quatInverse?: THREE.Quaternion;
    };
    if (c._quat && c._quatInverse) {
      c._quat.setFromUnitVectors(up, WORLD_UP);
      c._quatInverse.copy(c._quat).invert();
    }
  }

  setProjection(mode: Projection): void {
    // Plan view is locked to orthographic — perspective looking straight down is
    // meaningless (no foreshortening to convey).
    if (this.inPlan && mode === "perspective") return;
    if (mode === this.projection) return;
    this.applyProjection(mode);
    if (this.inPlan) {
      this.controls.minPolarAngle = PLAN_TILT;
      this.controls.maxPolarAngle = PLAN_TILT;
    }
  }

  /** Swap projection, rebuilding controls and re-framing from the current view. */
  private applyProjection(mode: Projection): void {
    const dir = this.currentDir();
    const up = this.activeCam.up.clone();
    const target = this.controls.target.clone();
    this.projection = mode;
    this.controls.dispose();
    this.controls = this.makeControls();
    this.controls.target.copy(target);
    if (this.model) this.frame(dir, up);
    else this.controls.update();
  }

  get projectionMode(): Projection {
    return this.projection;
  }

  /** Position the active camera along `dir` (target -> camera) and fit `modelBox`. */
  private frame(dir: THREE.Vector3, up: THREE.Vector3): void {
    if (this.aspect() <= 0) return; // container not laid out yet; avoid NaN frustum
    const box = this.scaledModelBox(); // accounts for vertical exaggeration
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const ndir = dir.clone().normalize();
    const cam = this.activeCam;
    cam.up.copy(up);
    this.syncControlsUp(up);

    if (cam instanceof THREE.PerspectiveCamera) {
      const fov = (cam.fov * Math.PI) / 180;
      const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.6;
      cam.position.copy(center).addScaledVector(ndir, dist);
      cam.near = Math.max(0.01, dist / 1000);
      cam.far = dist * 4 + maxDim * 4;
      cam.updateProjectionMatrix();
    } else {
      // Orthographic: tightly fit by projecting the box corners onto the image plane.
      const camDir = ndir.clone().negate();
      const right = new THREE.Vector3().crossVectors(camDir, up).normalize();
      const trueUp = new THREE.Vector3().crossVectors(right, camDir).normalize();
      let halfW = 1;
      let halfH = 1;
      const c = new THREE.Vector3();
      for (let i = 0; i < 8; i++) {
        c.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).sub(center);
        halfW = Math.max(halfW, Math.abs(c.dot(right)));
        halfH = Math.max(halfH, Math.abs(c.dot(trueUp)));
      }
      const aspect = this.aspect();
      halfW = Math.max(halfW, halfH * aspect) * 1.08;
      halfH = Math.max(halfH, halfW / aspect) * 1.0;
      const dist = maxDim * 2;
      cam.left = -halfW;
      cam.right = halfW;
      cam.top = halfH;
      cam.bottom = -halfH;
      cam.near = 0.01;
      cam.far = dist + maxDim * 2;
      cam.zoom = 1;
      cam.position.copy(center).addScaledVector(ndir, dist);
      cam.updateProjectionMatrix();
    }

    this.controls.target.copy(center);
    this.controls.update();
    this.onCameraChange?.();
  }

  /** World metres per CSS pixel at the orbit target — drives the scale bar. */
  metresPerPixel(): number {
    const h = this.container.clientHeight || 1;
    const cam = this.activeCam;
    if (cam instanceof THREE.PerspectiveCamera) {
      const dist = cam.position.distanceTo(this.controls.target);
      const visibleH = 2 * Math.tan((cam.fov * Math.PI) / 360) * dist;
      return visibleH / h;
    }
    const visibleH = (cam.top - cam.bottom) / cam.zoom;
    return visibleH / h;
  }

  // --- Snapshot ---

  /** Render and download the current view as a PNG. */
  snapshot(filename = "cave.png"): void {
    this.renderer.render(this.scene, this.activeCam);
    const url = this.renderer.domElement.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }

  // --- Controls ---

  /**
   * Choose what a plain left-drag does:
   *  - "pan"   — Google Earth–style: left pans, right orbits (rotate + tilt).
   *  - "orbit" — 3D-viewer / Aven-style: left orbits, right pans.
   * In both, the middle button / scroll wheel zooms. OrbitControls natively
   * swaps the left-drag action (pan<->orbit) while Shift is held; we leave the
   * button mapping alone so we don't fight that, and {@link onShiftChange} just
   * makes the swap apply mid-drag too.
   */
  setLeftDragMode(mode: LeftDragMode): void {
    this.leftDragMode = mode;
    if (mode === "pan") {
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    } else {
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    }
  }

  // OrbitControls only reads the Shift key when a gesture starts. To make the
  // native pan<->orbit swap apply *mid-drag*, restart the in-progress gesture
  // (carrying the new Shift state) so OrbitControls re-evaluates the action.
  private onShiftChange = (e: KeyboardEvent): void => {
    if (e.shiftKey === this.shiftActive) return;
    this.shiftActive = e.shiftKey;
    if (this.dragging && this.lastPointer) {
      const dom = this.renderer.domElement;
      const { pointerId, clientX, clientY } = this.lastPointer;
      const base = {
        pointerId,
        clientX,
        clientY,
        pointerType: "mouse",
        bubbles: true,
        shiftKey: this.shiftActive,
      };
      dom.dispatchEvent(new PointerEvent("pointerup", { ...base, button: 0, buttons: 0 }));
      dom.dispatchEvent(new PointerEvent("pointerdown", { ...base, button: 0, buttons: 1 }));
    }
  };

  // Track left-button drags so a Shift change can restart the in-progress gesture.
  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0) {
      this.dragging = true;
      this.lastPointer = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY };
      this.downPos = { x: e.clientX, y: e.clientY };
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.dragging) {
      this.lastPointer = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY };
      return;
    }
    // Defer the (O(stations)) hover pick to the next frame so rapid pointermove
    // events coalesce into at most one pick per frame.
    if (this.onHover) this.pendingHover = { x: e.clientX, y: e.clientY };
  };

  private onPointerLeave = (): void => {
    this.pendingHover = null;
    this.onHover?.(null, 0, 0); // hide the tooltip when the cursor leaves the canvas
  };

  private onPointerUp = (e: PointerEvent): void => {
    // A press that barely moved is a click → select the station under it (a
    // larger move was an orbit/pan, which leaves the selection untouched).
    if (this.downPos && this.onPick) {
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      if (moved < CLICK_MOVE_PX) {
        const id = this.pickStation(e.clientX, e.clientY);
        if (this.measuring) this.handleMeasureClick(id);
        else {
          this.setSelectedStation(id);
          this.onPick(id);
        }
      }
    }
    this.downPos = null;
    this.dragging = false;
    this.lastPointer = null;
  };

  /**
   * Nearest named station to a screen position, within a pixel tolerance. Uses
   * the cached position array and a single combined view-projection matrix so a
   * pick is one mat4 multiply per pickable station (cheap enough at 10k+).
   */
  private pickStation(clientX: number, clientY: number): number | null {
    if (!this.model || this.pickableIds.length === 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const cam = this.activeCam;
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    // World->NDC in one matrix; the intermediate (rigid) transform keeps w=1, so
    // a single applyMatrix4 matches Vector3.project()'s two-step result.
    const m = _pickMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const vs = this.vScale();
    const v = _pickVec;
    let best = -1;
    let bestD2 = PICK_TOLERANCE_PX * PICK_TOLERANCE_PX;
    for (const id of this.pickableIds) {
      const i = id * 3;
      v.set(this.pickPositions[i], this.pickPositions[i + 1] * vs, this.pickPositions[i + 2]).applyMatrix4(m);
      if (v.z < -1 || v.z > 1) continue; // behind camera / clipped
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      const d2 = (sx - px) * (sx - px) + (sy - py) * (sy - py);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = id;
      }
    }
    return best >= 0 ? best : null;
  }

  /** Cache pickable stations' Three-space positions for fast picking. */
  private buildPickCache(model: CaveModel): void {
    const n = model.stations.length;
    this.pickPositions = new Float32Array(n * 3);
    this.pickableIds = [];
    for (const s of model.stations) {
      const [x, y, z] = surveyToThree(s.x, s.y, s.z);
      const i = s.id * 3;
      this.pickPositions[i] = x;
      this.pickPositions[i + 1] = y;
      this.pickPositions[i + 2] = z;
      if (!s.flags.anonymous) this.pickableIds.push(s.id); // skip wall/splay points
    }
  }

  /** Highlight a station with the marker (or clear with null). */
  setSelectedStation(id: number | null): void {
    this.selectedStation = id;
    if (id === null || !this.model) {
      if (this.marker) this.marker.visible = false;
      this.requestRender();
      return;
    }
    if (!this.marker) {
      this.marker = this.makeSphere(0x58a6ff);
    }
    this.marker.position.copy(this.stationPoint(id));
    this.marker.visible = true;
    this.requestRender(); // moving an existing marker also needs a redraw
  }

  get selectedStationId(): number | null {
    return this.selectedStation;
  }

  /** A bright depth-test-free sphere marker, sized relative to the model. */
  private makeSphere(color: number): THREE.Mesh {
    const size = this.modelBox.getSize(new THREE.Vector3());
    const r = Math.max(Math.max(size.x, size.y, size.z) * 0.004, 0.3);
    const mat = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
    mesh.renderOrder = 999; // draw over walls/lines
    this.scene.add(mesh);
    this.requestRender();
    return mesh;
  }

  /** Effective vertical scale: exaggeration applies everywhere except plan view,
   * where it would be meaningless (you look straight down the scaled axis). */
  private vScale(): number {
    return this.inPlan ? 1 : this.verticalScale;
  }

  /** Rendered world position of a station (Three coords, vertical exaggeration applied). */
  private stationPoint(id: number): THREE.Vector3 {
    const s = this.model!.stations[id];
    const [x, y, z] = surveyToThree(s.x, s.y, s.z);
    return new THREE.Vector3(x, y * this.vScale(), z);
  }

  /** Enter/leave the measure tool; clears any prior measurement and selection. */
  setMeasuring(on: boolean): void {
    this.measuring = on;
    this.clearMeasure();
    this.setSelectedStation(null);
    this.onPick?.(null);
  }

  private handleMeasureClick(id: number | null): void {
    if (id === null) return; // ignore empty clicks while measuring
    if (this.measurePts.length === 2) this.clearMeasure(); // a third click starts over
    const slot = this.measurePts.length;
    this.measurePts.push(id);
    const m = this.makeSphere(0xffc451);
    m.position.copy(this.stationPoint(id));
    this.measureMarkers[slot] = m;
    if (this.measurePts.length === 2) {
      this.drawMeasureLine();
      this.onMeasure?.(this.measurePts[0], this.measurePts[1]);
    } else {
      this.onMeasure?.(id, null);
    }
  }

  private drawMeasureLine(): void {
    if (this.measureLine) this.scene.remove(this.measureLine);
    const a = this.stationPoint(this.measurePts[0]);
    const b = this.stationPoint(this.measurePts[1]);
    const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffc451, depthTest: false, transparent: true });
    this.measureLine = new THREE.Line(geom, mat);
    this.measureLine.renderOrder = 998;
    this.scene.add(this.measureLine);
    this.requestRender();
  }

  private clearMeasure(): void {
    this.measurePts = [];
    for (let i = 0; i < this.measureMarkers.length; i++) {
      const m = this.measureMarkers[i];
      if (m) {
        this.scene.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      this.measureMarkers[i] = null;
    }
    if (this.measureLine) {
      this.scene.remove(this.measureLine);
      this.measureLine.geometry.dispose();
      (this.measureLine.material as THREE.Material).dispose();
      this.measureLine = null;
    }
    this.requestRender();
  }

  /** Select a station and pan the camera to centre it (keeps zoom/orientation). */
  focusStation(id: number): void {
    if (!this.model || id < 0 || id >= this.model.stations.length) return;
    const s = this.model.stations[id];
    const [x, y, z] = surveyToThree(s.x, s.y, s.z);
    const p = new THREE.Vector3(x, y, z);
    this.activeCam.position.add(p.clone().sub(this.controls.target));
    this.controls.target.copy(p);
    this.controls.update();
    this.setSelectedStation(id);
    this.onPick?.(id);
  }

  get leftDrag(): LeftDragMode {
    return this.leftDragMode;
  }

  get camera3(): THREE.Camera {
    return this.activeCam;
  }

  get target(): THREE.Vector3 {
    return this.controls.target;
  }

  // --- Internals ---

  private get activeCam(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.projection === "perspective" ? this.perspCam : this.orthoCam;
  }

  private makeControls(): OrbitControls {
    const controls = new OrbitControls(this.activeCam, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    this.controls = controls; // setLeftDragMode reads this.controls
    this.setLeftDragMode(this.leftDragMode);
    controls.addEventListener("change", () => {
      this.onCameraChange?.();
      this.needsRender = true;
    });
    return controls;
  }

  private currentDir(): THREE.Vector3 {
    const d = this.activeCam.position.clone().sub(this.controls.target);
    if (d.lengthSq() < 1e-9) return VIEW_DIRS.iso.dir.clone();
    return d.normalize();
  }

  private aspect(): number {
    const { clientWidth: w, clientHeight: h } = this.container;
    return w / Math.max(1, h);
  }

  private computeBox(model: CaveModel): THREE.Box3 {
    const { min, max } = model.metadata.bounds;
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      // surveyToThree(x, y, z) = (x, z, -y); expand over all 8 survey-space corners.
      const x = i & 1 ? max[0] : min[0];
      const y = i & 2 ? max[1] : min[1];
      const z = i & 4 ? max[2] : min[2];
      box.expandByPoint(v.set(x, z, -y));
    }
    return box;
  }

  private clearLines(): void {
    if (this.lines) {
      this.modelGroup.remove(this.lines);
      this.lines.geometry.dispose();
      this.lines = null;
    }
    this.requestRender();
  }

  private handleResize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    const aspect = w / h;
    this.perspCam.aspect = aspect;
    this.perspCam.updateProjectionMatrix();
    // Orthographic: preserve vertical extent, recompute horizontal from aspect.
    const halfH = (this.orthoCam.top - this.orthoCam.bottom) / 2;
    this.orthoCam.left = -halfH * aspect;
    this.orthoCam.right = halfH * aspect;
    this.orthoCam.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.material.resolution.set(w, h);
    this.onCameraChange?.();
    this.requestRender();
  }

  // On-demand rendering: only draw when something changed. OrbitControls.update()
  // returns true while the camera is moving (incl. damping settling); other state
  // changes set `needsRender`. Keeps the GPU idle when the view is static.
  private animate = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.animate);
    if (this.pendingHover && this.onHover) {
      const { x, y } = this.pendingHover;
      this.pendingHover = null;
      this.onHover(this.pickStation(x, y), x, y);
    }
    const cameraMoved = this.controls.update();
    if (cameraMoved || this.needsRender) {
      this.renderer.render(this.scene, this.activeCam);
      this.needsRender = false;
    }
  };

  /** Mark the scene dirty so the next animation frame renders it. */
  private requestRender = (): void => {
    this.needsRender = true;
  };

  dispose(): void {
    this.disposed = true;
    this.clearWalls();
    this.resizeObserver.disconnect();
    const dom = this.renderer.domElement;
    dom.removeEventListener("pointerdown", this.onPointerDown);
    dom.removeEventListener("pointermove", this.onPointerMove);
    dom.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("keydown", this.onShiftChange);
    window.removeEventListener("keyup", this.onShiftChange);
    this.clearLines();
    this.material.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
