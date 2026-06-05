/**
 * A scale bar that shows a round real-world distance for the current view.
 * Updated whenever the camera moves or the canvas resizes.
 */
export class ScaleBar {
  readonly el: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly label: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "scalebar";
    this.el.style.display = "none";
    this.el.innerHTML = `<div class="scalebar-bar"></div><div class="scalebar-label"></div>`;
    this.bar = this.el.querySelector(".scalebar-bar") as HTMLElement;
    this.label = this.el.querySelector(".scalebar-label") as HTMLElement;
  }

  /** @param metresPerPixel world metres covered by one CSS pixel at the target. */
  update(metresPerPixel: number): void {
    if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) {
      this.el.style.display = "none";
      return;
    }
    this.el.style.display = "";
    const targetPx = 120;
    const metres = niceNumber(targetPx * metresPerPixel);
    const widthPx = metres / metresPerPixel;
    this.bar.style.width = `${widthPx.toFixed(1)}px`;
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
