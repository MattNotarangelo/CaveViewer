/**
 * An Autodesk-style ViewCube: a small cube in the corner that mirrors the main
 * camera's orientation. Click a face to snap to that view; drag to orbit.
 *
 * Renders its own tiny Three.js scene (separate canvas) and stays in sync by
 * reading the main camera's quaternion each frame. Face geometry uses survey
 * world axes (East = +X, Up = +Y, North = -Z), so a clicked face's local normal
 * is the world direction to look from.
 */
import * as THREE from "three";

export interface ViewCubeCallbacks {
  /** Current main-camera world quaternion (read every frame to mirror it). */
  getQuaternion: () => THREE.Quaternion;
  /** Snap the main view to look from this world direction (target -> camera). */
  onSnap: (dir: THREE.Vector3) => void;
  /** Orbit the main camera by these angle deltas (radians). */
  onOrbit: (deltaAzimuth: number, deltaPolar: number) => void;
}

const SIZE = 96; // CSS px
const DRAG_THRESHOLD = 4; // px of movement before a press becomes a drag
const ORBIT_SPEED = 0.01; // radians per px

// BoxGeometry material order is [+X, -X, +Y, -Y, +Z, -Z]; label each with the
// survey direction that face represents.
const FACE_LABELS = ["E", "W", "Top", "Bottom", "S", "N"];

export class ViewCube {
  readonly el: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly cube: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();
  private readonly cb: ViewCubeCallbacks;
  private disposed = false;
  private lastQuat: THREE.Quaternion | null = null; // last rendered main-camera orientation
  private press: { x: number; y: number; lastX: number; lastY: number; dragging: boolean } | null =
    null;

  constructor(cb: ViewCubeCallbacks) {
    this.cb = cb;
    this.el = document.createElement("div");
    this.el.className = "viewcube";
    this.el.title = "Click a face to snap to that view; drag to rotate";

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(SIZE, SIZE);
    this.el.appendChild(this.renderer.domElement);

    // A fixed orthographic camera looking down -Z at the cube.
    this.camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
    this.camera.position.set(0, 0, 4);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(2, 3, 4);
    this.scene.add(key);

    const materials = FACE_LABELS.map((label) => this.faceMaterial(label));
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), materials);
    this.scene.add(this.cube);
    // Crisp edges so the cube reads as a cube at small size.
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.cube.geometry),
      new THREE.LineBasicMaterial({ color: 0x1b1f27 }),
    );
    this.cube.add(edges);

    const dom = this.renderer.domElement;
    dom.style.cursor = "grab";
    dom.addEventListener("pointerdown", this.onPointerDown);
    dom.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);

    this.animate();
  }

  /** A face texture: label centred on a light tile. */
  private faceMaterial(label: string): THREE.MeshLambertMaterial {
    const px = 128;
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#e8ebf2";
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#1b1f27";
    ctx.font = `${label.length > 1 ? 30 : 44}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, px / 2, px / 2 + 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    return new THREE.MeshLambertMaterial({ map: texture });
  }

  private animate = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.animate);
    // Only redraw when the main camera's orientation changed — keeps the GPU
    // idle when the view is static. Mirror it by rotating world axes by the
    // world->view rotation so they appear as the main camera sees them.
    const q = this.cb.getQuaternion();
    if (this.lastQuat && q.equals(this.lastQuat)) return;
    this.lastQuat = q.clone();
    this.cube.quaternion.copy(q).invert();
    this.renderer.render(this.scene, this.camera);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.press = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, dragging: false };
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
    this.renderer.domElement.style.cursor = "grabbing";
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.press) return;
    const dx = e.clientX - this.press.lastX;
    const dy = e.clientY - this.press.lastY;
    if (!this.press.dragging) {
      const moved = Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y);
      if (moved < DRAG_THRESHOLD) return;
      this.press.dragging = true;
    }
    this.press.lastX = e.clientX;
    this.press.lastY = e.clientY;
    this.cb.onOrbit(dx * ORBIT_SPEED, dy * ORBIT_SPEED);
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.renderer.domElement.style.cursor = "grab";
    if (this.press && !this.press.dragging) this.snapFromClick(e);
    this.press = null;
  };

  /** Raycast the click into the cube and snap to the hit face's world axis. */
  private snapFromClick(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.cube, false)[0];
    if (!hit || !hit.face) return;
    // The geometry's local face normal is axis-aligned and equals the world
    // direction the face represents (cube rotation is display-only).
    const n = hit.face.normal;
    this.cb.onSnap(new THREE.Vector3(n.x, n.y, n.z));
  }

  dispose(): void {
    this.disposed = true;
    const dom = this.renderer.domElement;
    dom.removeEventListener("pointerdown", this.onPointerDown);
    dom.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    for (const m of this.cube.material as THREE.MeshLambertMaterial[]) {
      m.map?.dispose();
      m.dispose();
    }
    this.cube.geometry.dispose();
    for (const child of this.cube.children) {
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.renderer.dispose();
    dom.remove();
  }
}
