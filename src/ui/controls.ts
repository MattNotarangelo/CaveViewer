/**
 * The view-controls panel: preset views, projection toggle, colour-by selector,
 * and per-leg-type visibility checkboxes. Framework-light vanilla DOM; emits
 * changes through callbacks.
 */
import type { LegVisibility } from "../viewer/buildCenterline";
import type { PresetView, Projection } from "../viewer/Viewer";
import { COLOR_MODES, type ColorMode } from "../viewer/coloring";

export interface ControlsCallbacks {
  onView: (v: PresetView) => void;
  onProjection: (p: Projection) => void;
  onColorMode: (m: ColorMode) => void;
  onLegVisibility: (show: LegVisibility) => void;
  onWallsVisible: (visible: boolean) => void;
  onVerticalScale: (scale: number) => void;
}

export interface ControlsInitial {
  projection: Projection;
  colorMode: ColorMode;
  show: LegVisibility;
  wallsVisible: boolean;
  verticalScale: number;
}

// Quick view shortcuts. Cardinal elevations now live on the ViewCube (drag to
// orbit, click a face); these two cover the common "straight down" and "oblique"
// framings.
const VIEW_BUTTONS: Array<{ view: PresetView; label: string; title: string }> = [
  { view: "plan", label: "Plan", title: "Plan view (looking down, North up)" },
  { view: "iso", label: "3D", title: "Oblique 3D view" },
];

export class ControlsPanel {
  readonly el: HTMLElement;
  private readonly projBtn: HTMLButtonElement;
  private projection: Projection;

  constructor(cb: ControlsCallbacks, initial: ControlsInitial) {
    this.projection = initial.projection;
    this.el = document.createElement("div");
    this.el.className = "controls";

    // View presets.
    const viewRow = document.createElement("div");
    viewRow.className = "controls-row controls-views";
    for (const b of VIEW_BUTTONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = b.label;
      btn.title = b.title;
      btn.addEventListener("click", () => cb.onView(b.view));
      viewRow.appendChild(btn);
    }

    // Projection toggle.
    this.projBtn = document.createElement("button");
    this.projBtn.type = "button";
    this.updateProjLabel();
    this.projBtn.addEventListener("click", () => {
      this.projection = this.projection === "perspective" ? "orthographic" : "perspective";
      this.updateProjLabel();
      cb.onProjection(this.projection);
    });
    const projRow = document.createElement("div");
    projRow.className = "controls-row";
    projRow.appendChild(this.projBtn);

    // Colour-by selector.
    const colourRow = document.createElement("label");
    colourRow.className = "controls-row controls-select";
    colourRow.textContent = "Colour by ";
    const select = document.createElement("select");
    for (const mode of COLOR_MODES) {
      const opt = document.createElement("option");
      opt.value = mode.id;
      opt.textContent = mode.label;
      if (mode.id === initial.colorMode) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => cb.onColorMode(select.value as ColorMode));
    colourRow.appendChild(select);

    // Leg-type visibility.
    const showRow = document.createElement("div");
    showRow.className = "controls-row controls-show";
    const state: LegVisibility = { ...initial.show };
    const makeToggle = (key: keyof LegVisibility, label: string): HTMLElement => {
      const wrap = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = state[key];
      box.addEventListener("change", () => {
        state[key] = box.checked;
        cb.onLegVisibility({ ...state });
      });
      wrap.appendChild(box);
      wrap.appendChild(document.createTextNode(" " + label));
      return wrap;
    };
    // The wall mesh (Therion .lox passage surfaces) — separate from the
    // "Surface" leg toggle above, which hides above-ground *legs*.
    const wallsWrap = document.createElement("label");
    const wallsBox = document.createElement("input");
    wallsBox.type = "checkbox";
    wallsBox.checked = initial.wallsVisible;
    wallsBox.title = "Show modelled passage walls (Therion .lox)";
    wallsBox.addEventListener("change", () => cb.onWallsVisible(wallsBox.checked));
    wallsWrap.append(wallsBox, document.createTextNode(" Walls"));

    const showTitle = document.createElement("span");
    showTitle.className = "controls-show-title";
    showTitle.textContent = "Show:";
    showRow.append(
      showTitle,
      makeToggle("splay", "Splays"),
      makeToggle("surface", "Surface"),
      makeToggle("duplicate", "Duplicate"),
      wallsWrap,
    );

    // Vertical exaggeration slider.
    const vexRow = document.createElement("label");
    vexRow.className = "controls-row controls-select";
    const vexLabel = document.createElement("span");
    const fmtVex = (v: number): string => `Vertical exaggeration ×${v}`;
    vexLabel.textContent = fmtVex(initial.verticalScale);
    const vex = document.createElement("input");
    vex.type = "range";
    vex.min = "1";
    vex.max = "8";
    vex.step = "0.5";
    vex.value = String(initial.verticalScale);
    vex.addEventListener("input", () => {
      const v = parseFloat(vex.value);
      vexLabel.textContent = fmtVex(v);
      cb.onVerticalScale(v);
    });
    vexRow.append(vexLabel, vex);

    this.el.append(viewRow, projRow, colourRow, showRow, vexRow);
  }

  /**
   * Reflect the viewer's projection state and lock the toggle while plan view
   * forces orthographic (perspective is meaningless looking straight down).
   */
  setProjectionState(projection: Projection, locked: boolean): void {
    this.projection = projection;
    this.updateProjLabel();
    this.projBtn.disabled = locked;
    if (locked) this.projBtn.title = "Plan view is locked to orthographic (true-scale).";
  }

  private updateProjLabel(): void {
    const isPersp = this.projection === "perspective";
    this.projBtn.textContent = isPersp ? "View: Perspective" : "View: Orthographic";
    this.projBtn.title = isPersp
      ? "Perspective projection. Click for orthographic (true-scale)."
      : "Orthographic (true-scale) projection. Click for perspective.";
  }
}
