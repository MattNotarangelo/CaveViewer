/**
 * Collapsible survey-series tree with per-series visibility checkboxes. Toggling
 * a node cascades to its descendants; parents show an indeterminate state when
 * their children are mixed. Emits the set of hidden survey paths on change.
 */
import type { CaveModel } from "../parser/index";
import { buildSurveyTree, type SurveyNode } from "../viewer/surveyTree";

export class SurveyTreePanel {
  readonly el: HTMLElement;
  /** Fires with the set of survey paths to hide. */
  onChange?: (hidden: Set<string>) => void;

  private separator = ".";
  private readonly checkboxes = new Map<string, HTMLInputElement>();
  private readonly parentOf = new Map<string, string | null>();

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "controls survey-tree";
    this.el.style.display = "none";
  }

  /** Rebuild the tree for a model; hides itself if the file has no survey paths. */
  setModel(model: CaveModel): void {
    this.separator = model.metadata.separator || ".";
    this.checkboxes.clear();
    this.parentOf.clear();
    this.el.replaceChildren();

    const tree = buildSurveyTree(
      model.legs.map((l) => l.survey ?? ""),
      this.separator,
    );
    if (tree.length === 0) {
      this.el.style.display = "none";
      return;
    }

    const title = document.createElement("div");
    title.className = "controls-show-title";
    title.textContent = "Surveys";
    const body = document.createElement("div");
    body.className = "survey-tree-body";
    for (const node of tree) body.appendChild(this.renderNode(node, null));
    this.el.append(title, body);
    this.el.style.display = "";
  }

  private renderNode(node: SurveyNode, parent: string | null): HTMLElement {
    this.parentOf.set(node.path, parent);

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    this.checkboxes.set(node.path, cb);
    cb.addEventListener("click", (e) => e.stopPropagation()); // don't toggle <details>
    cb.addEventListener("change", () => this.onToggle(node.path, cb.checked));

    const label = document.createElement("label");
    label.className = "survey-tree-row";
    label.append(cb, document.createTextNode(" " + (node.name || "(root)")));

    if (node.children.length === 0) return label;

    const details = document.createElement("details");
    details.open = true;
    const summary = document.createElement("summary");
    summary.appendChild(label);
    const kids = document.createElement("div");
    kids.className = "survey-tree-children";
    for (const c of node.children) kids.appendChild(this.renderNode(c, node.path));
    details.append(summary, kids);
    return details;
  }

  private onToggle(path: string, checked: boolean): void {
    // Cascade to this node and every descendant.
    const prefix = path + this.separator;
    for (const [p, cb] of this.checkboxes) {
      if (p === path || p.startsWith(prefix)) {
        cb.checked = checked;
        cb.indeterminate = false;
      }
    }
    this.refreshIndeterminate();
    this.emit();
  }

  /** Set each parent's checked/indeterminate state from its direct children. */
  private refreshIndeterminate(): void {
    const deepestFirst = [...this.checkboxes.keys()].sort((a, b) => b.length - a.length);
    for (const path of deepestFirst) {
      const childPaths = [...this.checkboxes.keys()].filter((c) => this.parentOf.get(c) === path);
      if (childPaths.length === 0) continue;
      const cb = this.checkboxes.get(path)!;
      const states = childPaths.map((c) => {
        const child = this.checkboxes.get(c)!;
        return child.indeterminate ? "mixed" : child.checked ? "on" : "off";
      });
      if (states.every((s) => s === "on")) {
        cb.checked = true;
        cb.indeterminate = false;
      } else if (states.every((s) => s === "off")) {
        cb.checked = false;
        cb.indeterminate = false;
      } else {
        cb.indeterminate = true;
      }
    }
  }

  private emit(): void {
    const hidden = new Set<string>();
    for (const [path, cb] of this.checkboxes) {
      if (!cb.checked && !cb.indeterminate) hidden.add(path);
    }
    this.onChange?.(hidden);
  }
}
