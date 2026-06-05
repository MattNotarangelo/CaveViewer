/**
 * The Three.js cave viewer: scene, camera, renderer, orbit controls, and the
 * fat-line centreline. Consumes a CaveModel; knows nothing about file parsing.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { CaveModel } from "../parser/index";
import { buildCenterline } from "./buildCenterline";
import { boundsCenterThree, surveyToThree } from "./coords";

export class Viewer {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly material: LineMaterial;
  private lines: LineSegments2 | null = null;
  private model: CaveModel | null = null;
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;

  /** Called whenever the camera moves (for the north indicator). */
  onCameraChange?: () => void;

  constructor(private readonly container: HTMLElement) {
    this.scene.background = new THREE.Color(0x10131a);

    const { clientWidth: w, clientHeight: h } = container;
    this.camera = new THREE.PerspectiveCamera(55, w / Math.max(1, h), 0.1, 100_000);
    this.camera.position.set(10, 10, 10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.addEventListener("change", () => this.onCameraChange?.());

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

    this.animate();
  }

  /** Replace the displayed cave with a new model and frame it. */
  setModel(model: CaveModel): void {
    this.clearLines();
    this.model = model;

    const { geometry, segmentCount } = buildCenterline(model);
    if (segmentCount === 0) return; // nothing to draw (e.g. labels-only file)

    this.lines = new LineSegments2(geometry, this.material);
    this.lines.computeLineDistances();
    this.scene.add(this.lines);
    this.fitToView();
  }

  /** Frame the whole cave in view. */
  fitToView(): void {
    if (!this.model) return;
    const { min, max } = this.model.metadata.bounds;
    const [ax, ay, az] = surveyToThree(min[0], min[1], min[2]);
    const [bx, by, bz] = surveyToThree(max[0], max[1], max[2]);
    const box = new THREE.Box3(
      new THREE.Vector3(Math.min(ax, bx), Math.min(ay, by), Math.min(az, bz)),
      new THREE.Vector3(Math.max(ax, bx), Math.max(ay, by), Math.max(az, bz)),
    );
    const center = boundsCenterThree(min, max);
    const target = new THREE.Vector3(center[0], center[1], center[2]);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);

    const fov = (this.camera.fov * Math.PI) / 180;
    const distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.8;

    // Look from an oblique angle (NE and slightly above) for a 3/4 view.
    const dir = new THREE.Vector3(0.6, 0.5, 1).normalize();
    this.camera.position.copy(target).addScaledVector(dir, distance);
    this.camera.near = Math.max(0.01, distance / 1000);
    this.camera.far = distance * 10 + maxDim * 4;
    this.camera.updateProjectionMatrix();

    this.controls.target.copy(target);
    this.controls.update();
    this.onCameraChange?.();
  }

  /** The camera, for overlays such as the north indicator. */
  get camera3(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /** The current orbit target (look-at point). */
  get target(): THREE.Vector3 {
    return this.controls.target;
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.material.resolution.set(w, h);
  }

  private animate = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.clearLines();
    this.material.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
