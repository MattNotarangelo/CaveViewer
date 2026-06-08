/**
 * A station finder: a native-autocomplete text box listing every named station.
 * Picking a match (Enter or selecting from the list) focuses that station.
 */
import type { CaveModel } from "../parser/index";

let listId = 0;

export class StationSearch {
  readonly el: HTMLElement;
  /** Fires with the chosen station id. */
  onSelect?: (id: number) => void;

  private readonly input: HTMLInputElement;
  private readonly datalist: HTMLDataListElement;
  private readonly byLabel = new Map<string, number>();

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "controls search";

    const id = `station-search-${listId++}`;
    this.input = document.createElement("input");
    this.input.type = "search";
    this.input.placeholder = "Find station…";
    this.input.className = "search-input";
    this.input.setAttribute("list", id);
    this.input.setAttribute("aria-label", "Find station");

    this.datalist = document.createElement("datalist");
    this.datalist.id = id;

    this.input.addEventListener("change", () => this.commit());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.commit();
    });

    this.el.append(this.input, this.datalist);
  }

  /** Rebuild the suggestion list from the loaded model's named stations. */
  setModel(model: CaveModel): void {
    this.byLabel.clear();
    const frag = document.createDocumentFragment();
    for (const s of model.stations) {
      if (!s.label || s.flags.anonymous || this.byLabel.has(s.label)) continue;
      this.byLabel.set(s.label, s.id);
      const opt = document.createElement("option");
      opt.value = s.label;
      frag.appendChild(opt);
    }
    this.datalist.replaceChildren(frag);
    this.input.value = "";
  }

  private commit(): void {
    const id = this.byLabel.get(this.input.value.trim());
    if (id !== undefined) this.onSelect?.(id);
  }
}
