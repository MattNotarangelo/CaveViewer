/**
 * The info panel: survey title, derived stats, and a privacy reassurance.
 */
import { caveStats, type CaveModel } from "../parser/index";
import { escapeHtml } from "./escapeHtml";
import { formatLength, toDisplayLength, unitLabel, type UnitSystem } from "./units";

const REPO_URL = "https://github.com/MattNotarangelo/CaveViewer";

export class Hud {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private units: UnitSystem = "metric";
  private model: CaveModel | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "hud";
    this.el.innerHTML = `
      <h1 class="hud-title">Cave Survey Viewer</h1>
      <div class="hud-body"></div>
      <p class="hud-privacy">🔒 Everything runs in your browser. Your survey files
      never leave this machine — nothing is uploaded.</p>
      <a class="hud-repo" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">
        View source on GitHub ↗</a>`;
    this.body = this.el.querySelector(".hud-body") as HTMLElement;
  }

  /** Switches the unit system and re-renders the stats if a model is loaded. */
  setUnits(units: UnitSystem): void {
    this.units = units;
    if (this.model) this.update(this.model);
  }

  showWelcome(): void {
    this.model = null;
    this.body.innerHTML = `
      <p class="hud-hint">Drag &amp; drop a Survex <code>.3d</code>, Compass
      <code>.plt</code>, Therion <code>.lox</code> or PocketTopo <code>.top</code>
      file anywhere, or use the buttons below.</p>`;
  }

  showError(message: string): void {
    this.body.innerHTML = `<p class="hud-error">⚠ ${escapeHtml(message)}</p>`;
  }

  update(model: CaveModel): void {
    this.model = model;
    const u = this.units;
    const s = caveStats(model);
    const m = model.metadata;
    const lbl = unitLabel(u);
    const ext = s.extentM.map((v) => toDisplayLength(v, u).toFixed(0));
    const rows: Array<[string, string]> = [
      ["Title", m.title || "(untitled)"],
      ["Stations", s.stationCount.toLocaleString()],
      ["Legs", s.legCount.toLocaleString()],
      ["Total length", formatLength(s.totalLengthM, u)],
      ["Vertical range", `${toDisplayLength(s.depthRangeM, u).toFixed(1)} ${lbl}`],
      ["Extent (E×N×V)", `${ext[0]} × ${ext[1]} × ${ext[2]} ${lbl}`],
      ["Format", m.format],
    ];
    if (m.dateRange) {
      const { from, to } = m.dateRange;
      rows.push(["Survey dates", from === to ? from : `${from} → ${to}`]);
    }
    if (m.crs) rows.push(["Coord system", m.crs]);

    this.body.innerHTML = `<dl class="hud-stats">${rows
      .map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`)
      .join("")}</dl>`;
  }
}

