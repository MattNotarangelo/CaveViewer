/**
 * App entry point: wires the parser to the viewer and the DOM UI. Keeps the
 * UI framework-light (vanilla DOM) per the project's guiding principle.
 */
import "./style.css";
import { parseCaveFile } from "./parser/index";
import { Viewer, type LeftDragMode } from "./viewer/Viewer";
import { Legend } from "./viewer/legend";
import { NorthIndicator } from "./viewer/northIndicator";
import { ScaleBar } from "./viewer/scaleBar";
import { Hud } from "./ui/hud";
import { ControlsPanel } from "./ui/controls";

const app = document.getElementById("app");
if (!app) throw new Error("#app element not found");

const viewport = document.getElementById("viewport") as HTMLElement;
const overlay = document.getElementById("drop-overlay") as HTMLElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const openBtn = document.getElementById("btn-open") as HTMLButtonElement;
const exampleBtn = document.getElementById("btn-example") as HTMLButtonElement;
const fitBtn = document.getElementById("btn-fit") as HTMLButtonElement;
const snapBtn = document.getElementById("btn-snapshot") as HTMLButtonElement;
const controlsBtn = document.getElementById("btn-controls") as HTMLButtonElement;
const panel = document.getElementById("panel") as HTMLElement;
const controlsHost = document.getElementById("controls-host") as HTMLElement;

const viewer = new Viewer(viewport);
const hud = new Hud();
const legend = new Legend();
const north = new NorthIndicator();
const scaleBar = new ScaleBar();

panel.appendChild(hud.el);
app.appendChild(north.el);
app.appendChild(scaleBar.el);
hud.showWelcome();

// View controls panel (hidden until a model loads).
const controls = new ControlsPanel(
  {
    onView: (v) => viewer.setView(v),
    onProjection: (p) => viewer.setProjection(p),
    onColorMode: (m) => viewer.setColorMode(m),
    onLegVisibility: (show) => viewer.setLegVisibility(show),
  },
  {
    projection: viewer.projectionMode,
    colorMode: viewer.colorModeId,
    show: viewer.legVisibilityState,
  },
);
controlsHost.appendChild(controls.el);
controlsHost.appendChild(legend.el); // stacks below the controls (no overlap)
controlsHost.style.display = "none";

viewer.onCameraChange = () => {
  north.update(viewer.camera3, viewer.target);
  scaleBar.update(viewer.metresPerPixel());
};
viewer.onLegendChange = (spec) => legend.setSpec(spec);

let hasModel = false;

function loadFile(filename: string, buffer: ArrayBuffer): void {
  try {
    const model = parseCaveFile(filename, buffer);
    viewer.setModel(model);
    hud.update(model);
    hasModel = model.legs.length > 0;
    controlsHost.style.display = hasModel ? "" : "none";
    snapBtn.disabled = !hasModel;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    hud.showError(message);
    controlsHost.style.display = "none";
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
exampleBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("./example-cave.lox");
    if (!res.ok) throw new Error(`Example not found (HTTP ${res.status})`);
    loadFile("example-cave.lox", await res.arrayBuffer());
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
