/**
 * Survey-hierarchy helpers (pure logic, no DOM/Three). A leg's `survey` is a
 * separator-delimited path like `cave.entrance.pitch`; these turn the flat set
 * of leg paths into a tree and decide which legs a hidden-set masks.
 */

export interface SurveyNode {
  /** Full path, e.g. `cave.entrance`. */
  path: string;
  /** Last segment, e.g. `entrance`. */
  name: string;
  children: SurveyNode[];
  /** Legs whose path is exactly this node. */
  legCount: number;
}

/** Build a sorted survey tree from the per-leg survey paths. */
export function buildSurveyTree(legSurveys: ReadonlyArray<string>, separator: string): SurveyNode[] {
  const roots: SurveyNode[] = [];
  const byPath = new Map<string, SurveyNode>();

  const ensure = (path: string): SurveyNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const i = path.lastIndexOf(separator);
    const node: SurveyNode = {
      path,
      name: i < 0 ? path : path.slice(i + separator.length),
      children: [],
      legCount: 0,
    };
    byPath.set(path, node);
    if (i < 0) roots.push(node);
    else ensure(path.slice(0, i)).children.push(node);
    return node;
  };

  for (const s of legSurveys) {
    if (s) ensure(s).legCount++;
  }

  const sortRec = (nodes: SurveyNode[]): void => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/**
 * A leg is hidden when its survey path, or any ancestor of it, is in the hidden
 * set — so hiding a parent series hides everything beneath it.
 */
export function isLegHidden(
  survey: string | undefined,
  hidden: ReadonlySet<string>,
  separator: string,
): boolean {
  if (!survey || hidden.size === 0) return false;
  let path = survey;
  for (;;) {
    if (hidden.has(path)) return true;
    const i = path.lastIndexOf(separator);
    if (i < 0) return false;
    path = path.slice(0, i);
  }
}
