/**
 * Depth colour legend: a vertical gradient bar annotated with the elevation
 * range it spans (highest at top).
 */
import type { CaveModel } from "../parser/index";
import { depthColorCss } from "./colormap";

export class DepthLegend {
  readonly el: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly hi: HTMLElement;
  private readonly mid: HTMLElement;
  private readonly lo: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "legend";
    this.el.innerHTML = `
      <div class="legend-title">Elevation</div>
      <div class="legend-body">
        <div class="legend-bar"></div>
        <div class="legend-labels">
          <span class="legend-hi"></span>
          <span class="legend-mid"></span>
          <span class="legend-lo"></span>
        </div>
      </div>`;
    this.bar = this.el.querySelector(".legend-bar") as HTMLElement;
    this.hi = this.el.querySelector(".legend-hi") as HTMLElement;
    this.mid = this.el.querySelector(".legend-mid") as HTMLElement;
    this.lo = this.el.querySelector(".legend-lo") as HTMLElement;

    // Top of the bar = high elevation, so the gradient runs red -> blue downward.
    const stops: string[] = [];
    const N = 10;
    for (let i = 0; i <= N; i++) {
      const t = 1 - i / N;
      stops.push(`${depthColorCss(t)} ${(i / N) * 100}%`);
    }
    this.bar.style.background = `linear-gradient(to bottom, ${stops.join(", ")})`;
  }

  update(model: CaveModel): void {
    const lo = model.metadata.bounds.min[2];
    const hi = model.metadata.bounds.max[2];
    this.hi.textContent = `${hi.toFixed(1)} m`;
    this.mid.textContent = `${((hi + lo) / 2).toFixed(1)} m`;
    this.lo.textContent = `${lo.toFixed(1)} m`;
  }
}
