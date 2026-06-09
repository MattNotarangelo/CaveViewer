/**
 * A station finder: a native-autocomplete text box listing every named station.
 * Picking a match (Enter or selecting from the list) focuses that station.
 */
import type { CaveModel } from "../parser/index";

let listId = 0;
/** Cap on suggestions shown at once — keeps the datalist light for huge caves. */
const MAX_SUGGESTIONS = 50;

export class StationSearch {
  readonly el: HTMLElement;
  /** Fires with the chosen station id. */
  onSelect?: (id: number) => void;

  private readonly input: HTMLInputElement;
  private readonly datalist: HTMLDataListElement;
  private readonly byLabel = new Map<string, number>();
  private labels: string[] = [];

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

    this.input.addEventListener("input", () => this.refreshSuggestions());
    this.input.addEventListener("change", () => this.commit());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.commit();
    });

    this.el.append(this.input, this.datalist);
  }

  /** Index the loaded model's named stations; suggestions are filtered on input. */
  setModel(model: CaveModel): void {
    this.byLabel.clear();
    this.labels = [];
    for (const s of model.stations) {
      if (!s.label || s.flags.anonymous || this.byLabel.has(s.label)) continue;
      this.byLabel.set(s.label, s.id);
      this.labels.push(s.label);
    }
    this.input.value = "";
    this.refreshSuggestions();
  }

  /** Show up to MAX_SUGGESTIONS labels matching the current query (substring). */
  private refreshSuggestions(): void {
    const q = this.input.value.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    let shown = 0;
    for (const label of this.labels) {
      if (q && !label.toLowerCase().includes(q)) continue;
      const opt = document.createElement("option");
      opt.value = label;
      frag.appendChild(opt);
      if (++shown >= MAX_SUGGESTIONS) break;
    }
    this.datalist.replaceChildren(frag);
  }

  private commit(): void {
    const id = this.byLabel.get(this.input.value.trim());
    if (id !== undefined) this.onSelect?.(id);
  }
}
