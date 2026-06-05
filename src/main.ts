/**
 * App entry point: wires the parser to the viewer and the DOM UI. Keeps the
 * UI framework-light (vanilla DOM) per the project's guiding principle.
 */
import "./style.css";
import { parseCaveFile } from "./parser/index";
import { Viewer } from "./viewer/Viewer";
import { DepthLegend } from "./viewer/legend";
import { NorthIndicator } from "./viewer/northIndicator";
import { Hud } from "./ui/hud";

const app = document.getElementById("app");
if (!app) throw new Error("#app element not found");

const viewport = document.getElementById("viewport") as HTMLElement;
const overlay = document.getElementById("drop-overlay") as HTMLElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const openBtn = document.getElementById("btn-open") as HTMLButtonElement;
const exampleBtn = document.getElementById("btn-example") as HTMLButtonElement;
const fitBtn = document.getElementById("btn-fit") as HTMLButtonElement;
const panel = document.getElementById("panel") as HTMLElement;

const viewer = new Viewer(viewport);
const hud = new Hud();
const legend = new DepthLegend();
const north = new NorthIndicator();

panel.appendChild(hud.el);
app.appendChild(legend.el);
app.appendChild(north.el);
hud.showWelcome();
legend.el.style.display = "none";

viewer.onCameraChange = () => north.update(viewer.camera3, viewer.target);

function loadFile(filename: string, buffer: ArrayBuffer): void {
  try {
    const model = parseCaveFile(filename, buffer);
    viewer.setModel(model);
    hud.update(model);
    legend.update(model);
    legend.el.style.display = model.legs.length > 0 ? "" : "none";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    hud.showError(message);
    legend.el.style.display = "none";
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
exampleBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("./example-cave.3d");
    if (!res.ok) throw new Error(`Example not found (HTTP ${res.status})`);
    loadFile("example-cave.3d", await res.arrayBuffer());
  } catch (err) {
    hud.showError(err instanceof Error ? err.message : String(err));
  }
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

// Keyboard: F to fit.
window.addEventListener("keydown", (e) => {
  if (e.key === "f" || e.key === "F") viewer.fitToView();
});
