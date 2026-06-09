/**
 * Measure-tool readout: straight-line + horizontal distance, vertical change,
 * and compass bearing between two picked stations. Respects the unit system.
 */
import type { CaveModel } from "../parser/index";
import { escapeHtml } from "./escapeHtml";
import { formatLength, toDisplayLength, unitLabel, type UnitSystem } from "./units";

export class MeasurePanel {
  readonly el: HTMLElement;
  /** Fires when the user closes the panel (exits the measure tool). */
  onClose?: () => void;

  private units: UnitSystem = "metric";
  private model: CaveModel | null = null;
  private a: number | null = null;
  private b: number | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "hud measure-panel";
    this.el.style.display = "none";
  }

  setModel(model: CaveModel): void {
    this.model = model;
  }

  setUnits(units: UnitSystem): void {
    this.units = units;
    this.render();
  }

  /** Show the measurement: one endpoint (prompt for second) or both (results). */
  show(a: number | null, b: number | null): void {
    this.a = a;
    this.b = b;
    this.render();
  }

  private render(): void {
    if (!this.model || this.a === null) {
      this.el.style.display = "none";
      return;
    }
    const head = `
      <div class="station-info-head">
        <span class="station-info-name">Measure</span>
        <button class="station-info-close" type="button" title="Exit measure" aria-label="Exit measure">×</button>
      </div>`;
    const a = this.model.stations[this.a];

    if (this.b === null) {
      this.el.innerHTML = `${head}
        <p class="hud-hint">From <b>${escapeHtml(a.label || "(anonymous)")}</b> — click a second station.</p>`;
    } else {
      const b = this.model.stations[this.b];
      const u = this.units;
      const lbl = unitLabel(u);
      const dEast = b.x - a.x;
      const dNorth = b.y - a.y;
      const dz = b.z - a.z;
      const slope = Math.hypot(dEast, dNorth, dz);
      const plan = Math.hypot(dEast, dNorth);
      let bearing = (Math.atan2(dEast, dNorth) * 180) / Math.PI; // 0 = N, 90 = E
      if (bearing < 0) bearing += 360;
      const vert = `${dz >= 0 ? "+" : "−"}${toDisplayLength(Math.abs(dz), u).toFixed(1)} ${lbl}`;
      this.el.innerHTML = `${head}
        <p class="measure-ends">${escapeHtml(a.label || "(anon)")} → ${escapeHtml(b.label || "(anon)")}</p>
        <dl class="hud-stats">
          <dt>Straight line</dt><dd>${formatLength(slope, u)}</dd>
          <dt>Horizontal</dt><dd>${formatLength(plan, u)}</dd>
          <dt>Vertical</dt><dd>${vert}</dd>
          <dt>Bearing</dt><dd>${bearing.toFixed(1)}°</dd>
        </dl>`;
    }
    this.el.style.display = "";
    this.el
      .querySelector(".station-info-close")
      ?.addEventListener("click", () => this.onClose?.());
  }
}

