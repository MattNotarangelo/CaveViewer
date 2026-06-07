/**
 * The info panel: survey title, derived stats, and a privacy reassurance.
 */
import { caveStats, type CaveModel } from "../parser/index";

const REPO_URL = "https://github.com/MattNotarangelo/CaveViewer";

function formatLength(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`;
}

export class Hud {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;

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

  showWelcome(): void {
    this.body.innerHTML = `
      <p class="hud-hint">Drag &amp; drop a Survex <code>.3d</code>, Compass
      <code>.plt</code> or Therion <code>.lox</code> file anywhere, or use the
      buttons below.</p>`;
  }

  showError(message: string): void {
    this.body.innerHTML = `<p class="hud-error">⚠ ${escapeHtml(message)}</p>`;
  }

  update(model: CaveModel): void {
    const s = caveStats(model);
    const m = model.metadata;
    const rows: Array<[string, string]> = [
      ["Title", m.title || "(untitled)"],
      ["Stations", s.stationCount.toLocaleString()],
      ["Legs", s.legCount.toLocaleString()],
      ["Total length", formatLength(s.totalLengthM)],
      ["Vertical range", `${s.depthRangeM.toFixed(1)} m`],
      [
        "Extent (E×N×V)",
        `${s.extentM[0].toFixed(0)} × ${s.extentM[1].toFixed(0)} × ${s.extentM[2].toFixed(0)} m`,
      ],
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
