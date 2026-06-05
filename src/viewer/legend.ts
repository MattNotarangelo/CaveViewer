/**
 * Adaptive colour legend. Renders a gradient bar with high/mid/low labels for
 * continuous colour modes, a short note for categorical modes, or hides itself.
 */
import type { LegendSpec } from "./coloring";
import { depthColorCss } from "./colormap";

export class Legend {
  readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "legend";
    this.el.style.display = "none";
  }

  setSpec(spec: LegendSpec): void {
    if (spec.kind === "hidden") {
      this.el.style.display = "none";
      return;
    }
    this.el.style.display = "";
    if (spec.kind === "note") {
      this.el.innerHTML = `
        <div class="legend-title">${spec.title}</div>
        <div class="legend-note">${spec.text}</div>`;
      return;
    }
    this.el.innerHTML = `
      <div class="legend-title">${spec.title}</div>
      <div class="legend-body">
        <div class="legend-bar" style="background:${gradientCss()}"></div>
        <div class="legend-labels">
          <span>${spec.hi}</span>
          <span>${spec.mid}</span>
          <span>${spec.lo}</span>
        </div>
      </div>`;
  }
}

/** Top = high value; the ramp runs red -> blue downward. */
function gradientCss(): string {
  const stops: string[] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = 1 - i / N;
    stops.push(`${depthColorCss(t)} ${(i / N) * 100}%`);
  }
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}
