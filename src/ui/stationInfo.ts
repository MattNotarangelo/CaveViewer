/**
 * Selected-station detail panel: shows the clicked station's name, position,
 * elevation, and geodesic distance from the entrance. Respects the unit system.
 */
import type { CaveModel } from "../parser/index";
import { escapeHtml } from "./escapeHtml";
import { formatLength, toDisplayLength, unitLabel, type UnitSystem } from "./units";

export class StationInfo {
  readonly el: HTMLElement;
  /** Fires when the user clears the selection (close button). */
  onClose?: () => void;

  private units: UnitSystem = "metric";
  private model: CaveModel | null = null;
  private distances: Float64Array | null = null;
  private id: number | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "hud station-info";
    this.el.style.display = "none";
  }

  /** Provide the model + per-station entrance distances for the loaded cave. */
  setData(model: CaveModel, distances: Float64Array): void {
    this.model = model;
    this.distances = distances;
  }

  setUnits(units: UnitSystem): void {
    this.units = units;
    this.render();
  }

  /** Show details for a station id, or hide the panel with null. */
  show(id: number | null): void {
    this.id = id;
    this.render();
  }

  private render(): void {
    if (this.id === null || !this.model) {
      this.el.style.display = "none";
      return;
    }
    const s = this.model.stations[this.id];
    const u = this.units;
    const lbl = unitLabel(u);
    const coord = (v: number): string => `${toDisplayLength(v, u).toFixed(1)} ${lbl}`;
    const d = this.distances?.[this.id];
    const dist = d !== undefined && Number.isFinite(d) ? formatLength(d, u) : "—";

    const flags: string[] = [];
    if (s.flags.entrance) flags.push("entrance");
    if (s.flags.fixed) flags.push("fixed");
    if (s.flags.surface) flags.push("surface");

    this.el.innerHTML = `
      <div class="station-info-head">
        <span class="station-info-name">${escapeHtml(s.label || "(anonymous)")}</span>
        <button class="station-info-close" type="button" title="Clear selection" aria-label="Clear selection">×</button>
      </div>
      <dl class="hud-stats">
        <dt>Elevation</dt><dd>${coord(s.z)}</dd>
        <dt>East</dt><dd>${coord(s.x)}</dd>
        <dt>North</dt><dd>${coord(s.y)}</dd>
        <dt>From entrance</dt><dd>${dist}</dd>
      </dl>
      ${flags.length ? `<p class="station-info-flags">${flags.join(" · ")}</p>` : ""}`;
    this.el.style.display = "";
    this.el
      .querySelector(".station-info-close")
      ?.addEventListener("click", () => this.onClose?.());
  }
}

