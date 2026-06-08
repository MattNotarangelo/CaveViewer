import { describe, expect, it } from "vitest";
import { buildSurveyTree, isLegHidden } from "../src/viewer/surveyTree";

describe("buildSurveyTree", () => {
  it("nests paths into a sorted tree with leg counts", () => {
    const tree = buildSurveyTree(["cave.a", "cave.a", "cave.b", "cave"], ".");
    expect(tree).toHaveLength(1);
    const cave = tree[0];
    expect(cave.path).toBe("cave");
    expect(cave.name).toBe("cave");
    expect(cave.legCount).toBe(1); // the bare "cave" leg
    expect(cave.children.map((c) => c.name)).toEqual(["a", "b"]); // sorted
    expect(cave.children[0].legCount).toBe(2); // two "cave.a" legs
  });

  it("creates intermediate nodes even with no direct legs", () => {
    const tree = buildSurveyTree(["x.y.z"], ".");
    expect(tree[0].path).toBe("x");
    expect(tree[0].legCount).toBe(0);
    expect(tree[0].children[0].path).toBe("x.y");
    expect(tree[0].children[0].children[0].path).toBe("x.y.z");
  });

  it("ignores empty survey strings", () => {
    expect(buildSurveyTree(["", "a"], ".")).toHaveLength(1);
  });
});

describe("isLegHidden", () => {
  const sep = ".";
  it("hides a leg whose exact path is hidden", () => {
    expect(isLegHidden("cave.a", new Set(["cave.a"]), sep)).toBe(true);
  });

  it("hides descendants when an ancestor is hidden", () => {
    expect(isLegHidden("cave.a.deep", new Set(["cave.a"]), sep)).toBe(true);
    expect(isLegHidden("cave.a.deep", new Set(["cave"]), sep)).toBe(true);
  });

  it("keeps a leg whose path/ancestors are not hidden", () => {
    expect(isLegHidden("cave.b", new Set(["cave.a"]), sep)).toBe(false);
    expect(isLegHidden("cave.a", new Set(), sep)).toBe(false);
    expect(isLegHidden(undefined, new Set(["cave"]), sep)).toBe(false);
  });
});
