/**
 * App entry point: wires the parser to the viewer and the DOM UI. Keeps the
 * UI framework-light (vanilla DOM) per the project's guiding principle.
 */
import "./style.css";
import { parseCaveFile, type CaveModel } from "./parser/index";
import { Viewer, type LeftDragMode } from "./viewer/Viewer";
import { entranceDistances } from "./viewer/coloring";
import { Legend } from "./viewer/legend";
import { NorthIndicator } from "./viewer/northIndicator";
import { ScaleBar } from "./viewer/scaleBar";
import { Hud } from "./ui/hud";
import { ControlsPanel } from "./ui/controls";
import { StationInfo } from "./ui/stationInfo";
import { StationSearch } from "./ui/stationSearch";
import { MeasurePanel } from "./ui/measurePanel";
import { SurveyTreePanel } from "./ui/surveyTreePanel";
import { ViewCube } from "./viewer/viewCube";
import type { UnitSystem } from "./ui/units";

const app = document.getElementById("app");
if (!app) throw new Error("#app element not found");

const viewport = document.getElementById("viewport") as HTMLElement;
const overlay = document.getElementById("drop-overlay") as HTMLElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const openBtn = document.getElementById("btn-open") as HTMLButtonElement;
const exampleBtn = document.getElementById("btn-example") as HTMLButtonElement;
const fitBtn = document.getElementById("btn-fit") as HTMLButtonElement;
const snapBtn = document.getElementById("btn-snapshot") as HTMLButtonElement;
const measureBtn = document.getElementById("btn-measure") as HTMLButtonElement;
const controlsBtn = document.getElementById("btn-controls") as HTMLButtonElement;
const unitsBtn = document.getElementById("btn-units") as HTMLButtonElement;
const themeBtn = document.getElementById("btn-theme") as HTMLButtonElement;
const panel = document.getElementById("panel") as HTMLElement;
const controlsHost = document.getElementById("controls-host") as HTMLElement;

const viewer = new Viewer(viewport);
const hud = new Hud();
const legend = new Legend();
const north = new NorthIndicator();
const scaleBar = new ScaleBar();
const viewCube = new ViewCube({
  getQuaternion: () => viewer.camera3.quaternion,
  onSnap: (dir) => viewer.snapToDirection(dir),
  onOrbit: (dAz, dPolar) => viewer.orbit(dAz, dPolar),
});

const stationInfo = new StationInfo();
stationInfo.onClose = () => {
  viewer.setSelectedStation(null);
  stationInfo.show(null);
};
const search = new StationSearch();
search.onSelect = (id) => viewer.focusStation(id);
const measurePanel = new MeasurePanel();

// Tooltip that follows the cursor showing the hovered station's name.
const tooltip = document.createElement("div");
tooltip.className = "station-tooltip";
tooltip.style.display = "none";

panel.appendChild(hud.el);
panel.appendChild(stationInfo.el); // stacks under the info card (top-left)
panel.appendChild(measurePanel.el); // shares the spot (only one shows at a time)
app.appendChild(north.el);
app.appendChild(scaleBar.el);
app.appendChild(viewCube.el);
app.appendChild(tooltip);
viewCube.el.style.display = "none"; // shown once a model loads
hud.showWelcome();

// View controls panel (hidden until a model loads).
const controls = new ControlsPanel(
  {
    onView: (v) => viewer.setView(v),
    onProjection: (p) => viewer.setProjection(p),
    onColorMode: (m) => viewer.setColorMode(m),
    onLegVisibility: (show) => viewer.setLegVisibility(show),
    onWallsVisible: (visible) => viewer.setWallsVisible(visible),
    onVerticalScale: (scale) => viewer.setVerticalScale(scale),
  },
  {
    projection: viewer.projectionMode,
    colorMode: viewer.colorModeId,
    show: viewer.legVisibilityState,
    wallsVisible: viewer.wallsVisibleState,
    verticalScale: viewer.verticalExaggeration,
  },
);
const surveyTree = new SurveyTreePanel();
surveyTree.onChange = (hidden) => viewer.setHiddenSurveys(hidden);

controlsHost.appendChild(search.el); // finder sits above the view controls
controlsHost.appendChild(controls.el);
controlsHost.appendChild(surveyTree.el); // per-series visibility
controlsHost.appendChild(legend.el); // stacks below the controls (no overlap)
controlsHost.style.display = "none";

viewer.onCameraChange = () => {
  north.update(viewer.camera3, viewer.target);
  scaleBar.update(viewer.metresPerPixel());
};
viewer.onLegendChange = (spec) => legend.setSpec(spec);
// Plan view forces (and locks) orthographic; keep the projection toggle in sync.
viewer.onPlanModeChange = (inPlan) => controls.setProjectionState(viewer.projectionMode, inPlan);
viewer.onPick = (id) => stationInfo.show(id);
viewer.onMeasure = (a, b) => measurePanel.show(a, b);
viewer.onHover = (id, x, y) => {
  const label = id !== null && currentModel ? currentModel.stations[id].label : "";
  if (!label) {
    tooltip.style.display = "none";
    return;
  }
  tooltip.textContent = label;
  tooltip.style.left = `${x + 14}px`;
  tooltip.style.top = `${y + 14}px`;
  tooltip.style.display = "";
};

let hasModel = false;
let currentModel: CaveModel | null = null;

function loadFile(filename: string, buffer: ArrayBuffer): void {
  try {
    const model = parseCaveFile(filename, buffer);
    currentModel = model;
    viewer.setModel(model);
    hud.update(model);
    stationInfo.setData(model, entranceDistances(model).distance);
    stationInfo.show(null); // clear any prior selection
    search.setModel(model);
    measurePanel.setModel(model);
    surveyTree.setModel(model);
    setMeasureMode(false); // a fresh cave starts with the tool off
    hasModel = model.legs.length > 0;
    controlsHost.style.display = hasModel ? "" : "none";
    viewCube.el.style.display = hasModel ? "" : "none";
    snapBtn.disabled = !hasModel;
    measureBtn.disabled = !hasModel;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    hud.showError(message);
    stationInfo.show(null);
    setMeasureMode(false);
    controlsHost.style.display = "none";
    viewCube.el.style.display = "none";
    legend.setSpec({ kind: "hidden" });
    scaleBar.update(NaN);
  }
}

function readFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => loadFile(file.name, reader.result as ArrayBuffer);
  reader.onerror = () => hud.showError(`Could not read "${file.name}"`);
  reader.readAsArrayBuffer(file);
}

// --- Buttons ---
openBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) readFile(file);
  fileInput.value = ""; // allow re-selecting the same file
});
fitBtn.addEventListener("click", () => viewer.fitToView());
snapBtn.disabled = true;
snapBtn.addEventListener("click", () => viewer.snapshot("cave-survey.png"));

// Measure tool: toggle the mode; the panel + 3D markers come from the viewer.
measureBtn.disabled = true;
function setMeasureMode(on: boolean): void {
  viewer.setMeasuring(on);
  measureBtn.classList.toggle("active", on);
  measureBtn.textContent = on ? "Measuring…" : "Measure";
  if (!on) measurePanel.show(null, null);
}
measureBtn.addEventListener("click", () => setMeasureMode(!measureBtn.classList.contains("active")));
measurePanel.onClose = () => setMeasureMode(false);
exampleBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("./system_migovec.lox");
    if (!res.ok) throw new Error(`Example not found (HTTP ${res.status})`);
    loadFile("system_migovec.lox", await res.arrayBuffer());
  } catch (err) {
    hud.showError(err instanceof Error ? err.message : String(err));
  }
});

// Left-drag control scheme, persisted across sessions. Default: Google Earth–style.
const DRAG_KEY = "cv.leftDrag";
function applyDragMode(mode: LeftDragMode): void {
  viewer.setLeftDragMode(mode);
  controlsBtn.textContent = mode === "pan" ? "Drag: Pan" : "Drag: Orbit";
  controlsBtn.title =
    mode === "pan"
      ? "Left-drag pans, right-drag orbits (Google Earth–style). Click to switch."
      : "Left-drag orbits, right-drag pans (3D-viewer style). Click to switch.";
}
const savedMode: LeftDragMode = localStorage.getItem(DRAG_KEY) === "orbit" ? "orbit" : "pan";
applyDragMode(savedMode);
controlsBtn.addEventListener("click", () => {
  const next: LeftDragMode = viewer.leftDrag === "pan" ? "orbit" : "pan";
  applyDragMode(next);
  localStorage.setItem(DRAG_KEY, next);
});

// Unit system (metric / imperial), persisted across sessions. Affects the HUD
// stats and the scale bar; the model is always stored in metres.
const UNITS_KEY = "cv.units";
let units: UnitSystem = localStorage.getItem(UNITS_KEY) === "imperial" ? "imperial" : "metric";
function applyUnits(next: UnitSystem): void {
  units = next;
  hud.setUnits(next);
  scaleBar.setUnits(next);
  stationInfo.setUnits(next);
  measurePanel.setUnits(next);
  unitsBtn.textContent = next === "imperial" ? "Units: Imperial" : "Units: Metric";
}
applyUnits(units);
unitsBtn.addEventListener("click", () => {
  const next: UnitSystem = units === "metric" ? "imperial" : "metric";
  applyUnits(next);
  localStorage.setItem(UNITS_KEY, next);
});

// Colour theme (dark / light), persisted across sessions. Drives the CSS
// variables via data-theme and keeps the 3D scene background in step.
const THEME_KEY = "cv.theme";
const SCENE_BG = { dark: 0x10131a, light: 0xeef1f6 } as const;
type Theme = keyof typeof SCENE_BG;
let theme: Theme = localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
function applyTheme(next: Theme): void {
  theme = next;
  document.documentElement.setAttribute("data-theme", next);
  viewer.setBackground(SCENE_BG[next]);
  themeBtn.textContent = next === "light" ? "Theme: Light" : "Theme: Dark";
}
applyTheme(theme);
themeBtn.addEventListener("click", () => {
  applyTheme(theme === "dark" ? "light" : "dark");
  localStorage.setItem(THEME_KEY, theme);
});

// --- Drag and drop anywhere on the window ---
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  overlay.classList.add("active");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  if (--dragDepth <= 0) {
    dragDepth = 0;
    overlay.classList.remove("active");
  }
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  overlay.classList.remove("active");
  const file = e.dataTransfer?.files?.[0];
  if (file) readFile(file);
});

// Keyboard shortcuts.
window.addEventListener("keydown", (e) => {
  if (!hasModel) return;
  switch (e.key.toLowerCase()) {
    case "f":
      viewer.fitToView();
      break;
    case "p":
      viewer.setView("plan");
      break;
  }
});
