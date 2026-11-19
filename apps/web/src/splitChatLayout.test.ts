import { describe, expect, it } from "vite-plus/test";

import {
  buildDefaultLayout,
  computeLayoutRects,
  decodeSplitLayoutTree,
  reconcileLayoutTree,
  removeLeafFromTree,
  resizeSplitBoundary,
  splitLeafInTree,
  swapLeavesInTree,
  type SplitLayoutNode,
} from "./splitChatLayout";

describe("splitChatLayout", () => {
  it("supports arbitrary VS Code-style horizontal, vertical, and nested splits", () => {
    let tree: SplitLayoutNode | null = { kind: "leaf", paneKey: "a" };
    // Split right -> [a | b]
    tree = splitLeafInTree(tree, "a", "b", "right");
    // Split right again on b -> 3 horizontal columns [a | b | c]
    tree = splitLeafInTree(tree, "b", "c", "right");
    // Split left on a -> 4 horizontal columns [d | a | b | c]
    tree = splitLeafInTree(tree, "a", "d", "left");
    expect(tree).toMatchObject({
      kind: "split",
      direction: "horizontal",
      children: [
        { kind: "leaf", paneKey: "d" },
        { kind: "leaf", paneKey: "a" },
        { kind: "leaf", paneKey: "b" },
        { kind: "leaf", paneKey: "c" },
      ],
    });

    // Split b vertically downward -> column 2 becomes vertical [b / e]
    tree = splitLeafInTree(tree, "b", "e", "bottom");
    // Split e vertically upward -> column 2 becomes [b / f / e]
    tree = splitLeafInTree(tree, "e", "f", "top");

    const layout = computeLayoutRects(tree);
    expect(layout.paneRects.size).toBe(6);
    // All panes in column 2 share the exact same x and width, stacked top-to-bottom.
    const rectB = layout.paneRects.get("b")!;
    const rectF = layout.paneRects.get("f")!;
    const rectE = layout.paneRects.get("e")!;
    expect(rectB.left).toBeCloseTo(rectF.left);
    expect(rectF.left).toBeCloseTo(rectE.left);
    expect(rectB.width).toBeCloseTo(rectF.width);
    expect(rectB.top).toBeCloseTo(0);
    expect(rectF.top).toBeCloseTo(rectB.height);
    expect(rectE.top).toBeCloseTo(rectB.height + rectF.height);
    expect(rectB.height + rectF.height + rectE.height).toBeCloseTo(1);

    // 3 vertical dividers between the 4 columns + 2 horizontal dividers inside column 2 = 5 dividers.
    expect(layout.dividers).toHaveLength(5);
    expect(layout.dividers.filter((d) => d.orientation === "vertical")).toHaveLength(3);
    expect(layout.dividers.filter((d) => d.orientation === "horizontal")).toHaveLength(2);
  });

  it("moves an existing pane to split another pane and collapses emptied branches", () => {
    let tree = buildDefaultLayout(["a", "b", "c"]);
    // Move c from bottom row onto the right edge of b -> top row becomes [a | b | c] and vertical root collapses!
    tree = splitLeafInTree(tree, "b", "c", "right");
    expect(tree).toMatchObject({
      kind: "split",
      direction: "horizontal",
      children: [
        { kind: "leaf", paneKey: "a" },
        { kind: "leaf", paneKey: "b" },
        { kind: "leaf", paneKey: "c" },
      ],
    });
  });

  it("resizes only the two adjacent children at a split boundary", () => {
    let tree: SplitLayoutNode | null = {
      kind: "split",
      direction: "horizontal",
      children: [
        { kind: "leaf", paneKey: "a" },
        { kind: "leaf", paneKey: "b" },
        { kind: "leaf", paneKey: "c" },
      ],
      sizes: [0.3, 0.4, 0.3],
    };

    // Move boundary 0 (between a and b) from 0.3 to 0.5 -> a=0.5, b=0.2, c stays 0.3
    tree = resizeSplitBoundary(tree, "", 0, 0.5);
    expect(tree?.kind).toBe("split");
    if (tree?.kind === "split") {
      expect(tree.sizes[0]).toBeCloseTo(0.5);
      expect(tree.sizes[1]).toBeCloseTo(0.2);
      expect(tree.sizes[2]).toBeCloseTo(0.3);
    }

    // Clamps when dragging past minimum child size
    tree = resizeSplitBoundary(tree, "", 0, 0.01);
    if (tree?.kind === "split") {
      expect(tree.sizes[0]).toBeCloseTo(0.08);
      expect(tree.sizes[1]).toBeCloseTo(0.62);
      expect(tree.sizes[2]).toBeCloseTo(0.3);
    }
  });

  it("swaps panes in place and removes leaves cleanly", () => {
    const initial = buildDefaultLayout(["a", "b"]);
    const swapped = swapLeavesInTree(initial, "a", "b");
    expect(swapped).toMatchObject({
      kind: "split",
      direction: "horizontal",
      children: [
        { kind: "leaf", paneKey: "b" },
        { kind: "leaf", paneKey: "a" },
      ],
    });
    expect(removeLeafFromTree(swapped, "a")).toEqual({ kind: "leaf", paneKey: "b" });
  });

  it("reconciles tab switches, removed panes, and newly added panes", () => {
    const initial = splitLeafInTree({ kind: "leaf", paneKey: "a" }, "a", "b", "bottom");
    // Pane 0 switched from tab "a" to tab "a2", pane "c" was added via openToSide.
    const reconciled = reconcileLayoutTree(
      initial,
      [
        { paneKey: "a2", tabKeys: ["a", "a2"] },
        { paneKey: "b", tabKeys: ["b"] },
        { paneKey: "c", tabKeys: ["c"] },
      ],
      "b",
    );
    expect(reconciled).toMatchObject({
      kind: "split",
      direction: "vertical",
      children: [
        { kind: "leaf", paneKey: "a2" },
        {
          kind: "split",
          direction: "horizontal",
          children: [
            { kind: "leaf", paneKey: "b" },
            { kind: "leaf", paneKey: "c" },
          ],
        },
      ],
    });
  });

  it("validates and decodes persisted split trees safely", () => {
    expect(decodeSplitLayoutTree(null)).toBeNull();
    expect(
      decodeSplitLayoutTree({ kind: "split", direction: "diagonal", children: [] }),
    ).toBeNull();

    const decoded = decodeSplitLayoutTree({
      kind: "split",
      direction: "horizontal",
      sizes: [2, 6],
      children: [
        { kind: "leaf", paneKey: "a" },
        { kind: "leaf", paneKey: "b" },
      ],
    });
    expect(decoded).toMatchObject({
      kind: "split",
      direction: "horizontal",
      sizes: [0.25, 0.75],
    });
  });
});
