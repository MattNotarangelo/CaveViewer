import type { UnitSystem } from "../ui/units";

const FEET_PER_METRE = 3.280839895;
const FEET_PER_MILE = 5280;

/**
 * A scale bar that shows a round real-world distance for the current view.
 * Updated whenever the camera moves or the canvas resizes.
 */
export class ScaleBar {
  readonly el: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly label: HTMLElement;
  private units: UnitSystem = "metric";
  private lastMetresPerPixel = NaN;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "scalebar";
    this.el.style.display = "none";
    this.el.innerHTML = `<div class="scalebar-bar"></div><div class="scalebar-label"></div>`;
    this.bar = this.el.querySelector(".scalebar-bar") as HTMLElement;
    this.label = this.el.querySelector(".scalebar-label") as HTMLElement;
  }

  /** Switches the unit system and redraws with the last known scale. */
  setUnits(units: UnitSystem): void {
    this.units = units;
    this.update(this.lastMetresPerPixel);
  }

  /** @param metresPerPixel world metres covered by one CSS pixel at the target. */
  update(metresPerPixel: number): void {
    this.lastMetresPerPixel = metresPerPixel;
    if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) {
      this.el.style.display = "none";
      return;
    }
    this.el.style.display = "";
    const targetPx = 120;
    if (this.units === "imperial") {
      const feetPerPixel = metresPerPixel * FEET_PER_METRE;
      const feet = niceNumber(targetPx * feetPerPixel);
      this.bar.style.width = `${(feet / feetPerPixel).toFixed(1)}px`;
      this.label.textContent =
        feet >= FEET_PER_MILE ? `${(feet / FEET_PER_MILE).toFixed(0)} mi` : `${feet} ft`;
      return;
    }
    const metres = niceNumber(targetPx * metresPerPixel);
    this.bar.style.width = `${(metres / metresPerPixel).toFixed(1)}px`;
    this.label.textContent = metres >= 1000 ? `${(metres / 1000).toFixed(0)} km` : `${metres} m`;
  }
}

/** Round down to the nearest 1, 2, or 5 times a power of ten. */
function niceNumber(value: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / pow;
  const nice = f >= 5 ? 5 : f >= 2 ? 2 : 1;
  return nice * pow;
}
