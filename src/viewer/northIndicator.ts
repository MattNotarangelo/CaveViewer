/**
 * A small compass overlay whose needle always points to survey North as
 * projected into the current screen view.
 */
import * as THREE from "three";
import { NORTH_THREE } from "./coords";

export class NorthIndicator {
  readonly el: HTMLElement;
  private readonly needle: HTMLElement;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "north-indicator";
    this.el.innerHTML = `
      <div class="north-needle">
        <span class="north-arrow"></span>
        <span class="north-n">N</span>
      </div>`;
    this.needle = this.el.querySelector(".north-needle") as HTMLElement;
  }

  /** Update the needle from the current camera and orbit target. */
  update(camera: THREE.Camera, target: THREE.Vector3): void {
    // A preset view teleports the camera, so this can fire before the renderer
    // refreshes the camera matrices — recompute them here or we'd project North
    // through the *previous* frame's orientation (stale, wrong-pointing needle).
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    // Project the target and a point one unit north of it into NDC, then take
    // the screen-space direction between them.
    this.tmpA.copy(target).project(camera);
    this.tmpB
      .set(
        target.x + NORTH_THREE[0],
        target.y + NORTH_THREE[1],
        target.z + NORTH_THREE[2],
      )
      .project(camera);
    const dx = this.tmpB.x - this.tmpA.x;
    const dy = this.tmpB.y - this.tmpA.y; // NDC y is up
    // Screen angle: 0 = north points up. Rotate clockwise for positive angle.
    const angle = Math.atan2(dx, dy) * (180 / Math.PI);
    this.needle.style.transform = `rotate(${angle}deg)`;
  }
}
