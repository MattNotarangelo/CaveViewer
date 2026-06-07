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

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const NORTH_UP = new THREE.Vector3(0, 0, -1); // for plan view, North points "up"

// Camera direction (target -> camera) and up vector per preset view.
const VIEW_DIRS: Record<PresetView, { dir: THREE.Vector3; up: THREE.Vector3 }> = {
  plan: { dir: new THREE.Vector3(0, 1, 0), up: NORTH_UP },
  N: { dir: new THREE.Vector3(0, 0, -1), up: WORLD_UP },
  S: { dir: new THREE.Vector3(0, 0, 1), up: WORLD_UP },
  E: { dir: new THREE.Vector3(1, 0, 0), up: WORLD_UP },
  W: { dir: new THREE.Vector3(-1, 0, 0), up: WORLD_UP },
  iso: { dir: new THREE.Vector3(0.6, 0.5, 1).normalize(), up: WORLD_UP },
};

const FOV = 55;

export class Viewer {
  private readonly scene = new THREE.Scene();
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
  private legend: LegendSpec = { kind: "hidden" };
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;

  /** Fires whenever the camera moves (north indicator, scale bar). */
  onCameraChange?: () => void;
  /** Fires when the legend should change (colour mode / model change). */
  onLegendChange?: (spec: LegendSpec) => void;

  constructor(private readonly container: HTMLElement) {
    this.scene.background = new THREE.Color(0x10131a);

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
    this.buildWalls(model); // .lox passage-wall mesh (if any); independent of colour mode
    this.rebuild();
    this.setView("iso");
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
    this.scene.add(this.walls);
  }

  /** Show or hide the .lox passage-wall mesh. */
  setWallsVisible(visible: boolean): void {
    this.wallsVisible = visible;
    if (this.walls) this.walls.visible = visible;
  }

  get wallsVisibleState(): boolean {
    return this.wallsVisible;
  }

  /** Whether the current model has a wall mesh (so the UI can show the toggle). */
  get hasWalls(): boolean {
    return this.walls !== null;
  }

  private clearWalls(): void {
    if (this.walls) {
      this.scene.remove(this.walls);
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
    });
    this.legend = legend;
    this.onLegendChange?.(legend);
    if (segmentCount === 0) {
      geometry.dispose();
      return;
    }
    this.lines = new LineSegments2(geometry, this.material);
    this.lines.computeLineDistances();
    this.scene.add(this.lines);
  }

  // --- Camera framing ---

  /** Frame the whole cave from the default 3D viewpoint. */
  fitToView(): void {
    this.setView("iso");
  }

  /** Snap to a preset viewpoint and frame the cave. */
  setView(view: PresetView): void {
    if (!this.model) return;
    const { dir, up } = VIEW_DIRS[view];
    this.frame(dir, up);
  }

  setProjection(mode: Projection): void {
    if (mode === this.projection) return;
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
    const center = this.modelBox.getCenter(new THREE.Vector3());
    const size = this.modelBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const ndir = dir.clone().normalize();
    const cam = this.activeCam;
    cam.up.copy(up);

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
          i & 1 ? this.modelBox.max.x : this.modelBox.min.x,
          i & 2 ? this.modelBox.max.y : this.modelBox.min.y,
          i & 4 ? this.modelBox.max.z : this.modelBox.min.z,
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
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.dragging) {
      this.lastPointer = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY };
    }
  };

  private onPointerUp = (): void => {
    this.dragging = false;
    this.lastPointer = null;
  };

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
    controls.addEventListener("change", () => this.onCameraChange?.());
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
      this.scene.remove(this.lines);
      this.lines.geometry.dispose();
      this.lines = null;
    }
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
  }

  private animate = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.activeCam);
  };

  dispose(): void {
    this.disposed = true;
    this.clearWalls();
    this.resizeObserver.disconnect();
    const dom = this.renderer.domElement;
    dom.removeEventListener("pointerdown", this.onPointerDown);
    dom.removeEventListener("pointermove", this.onPointerMove);
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
