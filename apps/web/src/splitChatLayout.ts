export type SplitDirection = "horizontal" | "vertical";
export type SplitEdge = "left" | "right" | "top" | "bottom";

export interface SplitLayoutLeaf {
  readonly kind: "leaf";
  readonly paneKey: string;
}

export interface SplitLayoutBranch {
  readonly kind: "split";
  readonly direction: SplitDirection;
  readonly children: readonly SplitLayoutNode[];
  readonly sizes: readonly number[];
}

export type SplitLayoutNode = SplitLayoutLeaf | SplitLayoutBranch;

export interface NormalizedRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface SplitDividerDescriptor {
  readonly id: string;
  readonly splitPath: string;
  readonly boundaryIndex: number;
  readonly orientation: "vertical" | "horizontal";
  readonly branchRect: NormalizedRect;
  readonly position: number;
  readonly minPosition: number;
  readonly maxPosition: number;
  readonly defaultPosition: number;
}

export interface ComputedSplitLayout {
  readonly paneRects: ReadonlyMap<string, NormalizedRect>;
  readonly dividers: readonly SplitDividerDescriptor[];
}

export interface PaneKeyGroup {
  readonly paneKey: string;
  readonly tabKeys: readonly string[];
}

const MIN_SPLIT_CHILD_SIZE = 0.08;

function normalizeSizes(sizes: readonly number[], count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [1];
  const valid =
    sizes.length === count &&
    sizes.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (!valid) {
    return Array.from({ length: count }, () => 1 / count);
  }
  const total = sizes.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) {
    return Array.from({ length: count }, () => 1 / count);
  }
  return sizes.map((value) => value / total);
}

function normalizeLayoutTree(node: SplitLayoutNode | null): SplitLayoutNode | null {
  if (!node) return null;
  if (node.kind === "leaf") {
    return node.paneKey ? node : null;
  }

  const normalizedChildren: SplitLayoutNode[] = [];
  const rawSizes: number[] = [];
  const inputSizes = normalizeSizes(node.sizes, node.children.length);

  for (let i = 0; i < node.children.length; i++) {
    const child = normalizeLayoutTree(node.children[i] ?? null);
    if (!child) continue;
    const weight = inputSizes[i] ?? 1 / node.children.length;
    if (child.kind === "split" && child.direction === node.direction) {
      // Flatten nested branches sharing the same split axis so siblings resize cleanly.
      const childSizes = normalizeSizes(child.sizes, child.children.length);
      for (let j = 0; j < child.children.length; j++) {
        normalizedChildren.push(child.children[j]!);
        rawSizes.push(weight * childSizes[j]!);
      }
    } else {
      normalizedChildren.push(child);
      rawSizes.push(weight);
    }
  }

  if (normalizedChildren.length === 0) return null;
  if (normalizedChildren.length === 1) return normalizedChildren[0]!;

  return {
    kind: "split",
    direction: node.direction,
    children: normalizedChildren,
    sizes: normalizeSizes(rawSizes, normalizedChildren.length),
  };
}

function makeBranch(
  direction: SplitDirection,
  children: readonly SplitLayoutNode[],
  sizes?: readonly number[],
): SplitLayoutNode {
  if (children.length === 1) return children[0]!;
  return {
    kind: "split",
    direction,
    children,
    sizes: normalizeSizes(sizes ?? [], children.length),
  };
}

export function buildDefaultLayout(paneKeys: readonly string[]): SplitLayoutNode | null {
  const keys = paneKeys.filter(Boolean);
  if (keys.length === 0) return null;
  if (keys.length === 1) return { kind: "leaf", paneKey: keys[0]! };
  if (keys.length === 2) {
    return makeBranch("horizontal", [
      { kind: "leaf", paneKey: keys[0]! },
      { kind: "leaf", paneKey: keys[1]! },
    ]);
  }
  const topCount = keys.length <= 4 ? 2 : Math.ceil(keys.length / 2);
  const topLeaves = keys.slice(0, topCount).map<SplitLayoutLeaf>((paneKey) => ({
    kind: "leaf",
    paneKey,
  }));
  const bottomLeaves = keys.slice(topCount).map<SplitLayoutLeaf>((paneKey) => ({
    kind: "leaf",
    paneKey,
  }));
  return makeBranch("vertical", [
    makeBranch("horizontal", topLeaves),
    makeBranch("horizontal", bottomLeaves),
  ]);
}

function collectLeafKeys(node: SplitLayoutNode | null, out: string[] = []): string[] {
  if (!node) return out;
  if (node.kind === "leaf") {
    out.push(node.paneKey);
    return out;
  }
  for (const child of node.children) {
    collectLeafKeys(child, out);
  }
  return out;
}

export function removeLeafFromTree(
  node: SplitLayoutNode | null,
  paneKey: string,
): SplitLayoutNode | null {
  if (!node) return null;
  if (node.kind === "leaf") {
    return node.paneKey === paneKey ? null : node;
  }
  const nextChildren: SplitLayoutNode[] = [];
  const nextSizes: number[] = [];
  const sizes = normalizeSizes(node.sizes, node.children.length);
  let changed = false;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!;
    const updated = removeLeafFromTree(child, paneKey);
    if (updated !== child) changed = true;
    if (updated) {
      nextChildren.push(updated);
      nextSizes.push(sizes[i]!);
    }
  }
  if (!changed) return node;
  if (nextChildren.length === 0) return null;
  if (nextChildren.length === 1) return nextChildren[0]!;
  return normalizeLayoutTree({
    kind: "split",
    direction: node.direction,
    children: nextChildren,
    sizes: normalizeSizes(nextSizes, nextChildren.length),
  });
}

export function swapLeavesInTree(
  node: SplitLayoutNode | null,
  keyA: string,
  keyB: string,
): SplitLayoutNode | null {
  if (!node || keyA === keyB) return node;
  if (node.kind === "leaf") {
    if (node.paneKey === keyA) return { kind: "leaf", paneKey: keyB };
    if (node.paneKey === keyB) return { kind: "leaf", paneKey: keyA };
    return node;
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = swapLeavesInTree(child, keyA, keyB);
    if (next !== child) changed = true;
    return next!;
  });
  return changed ? { ...node, children } : node;
}

export function splitLeafInTree(
  root: SplitLayoutNode | null,
  targetKey: string,
  newKey: string,
  edge: SplitEdge,
): SplitLayoutNode | null {
  if (!newKey) return root;
  if (!root) return { kind: "leaf", paneKey: newKey };
  if (targetKey === newKey) return root;

  const withoutNew = removeLeafFromTree(root, newKey);
  if (!withoutNew) return { kind: "leaf", paneKey: newKey };

  const direction: SplitDirection = edge === "left" || edge === "right" ? "horizontal" : "vertical";
  const insertBefore = edge === "left" || edge === "top";
  const newLeaf: SplitLayoutLeaf = { kind: "leaf", paneKey: newKey };

  let inserted = false;

  function insert(node: SplitLayoutNode): SplitLayoutNode {
    if (node.kind === "leaf") {
      if (node.paneKey !== targetKey) return node;
      inserted = true;
      return {
        kind: "split",
        direction,
        children: insertBefore ? [newLeaf, node] : [node, newLeaf],
        sizes: [0.5, 0.5],
      };
    }

    // If the target leaf is a direct child of a branch with the same direction,
    // insert directly as a sibling (VS Code N-way split behavior).
    if (node.direction === direction) {
      const targetIndex = node.children.findIndex(
        (child) => child.kind === "leaf" && child.paneKey === targetKey,
      );
      if (targetIndex !== -1) {
        inserted = true;
        const sizes = normalizeSizes(node.sizes, node.children.length);
        const half = sizes[targetIndex]! / 2;
        const nextChildren = [...node.children];
        const nextSizes = [...sizes];
        const insertAt = insertBefore ? targetIndex : targetIndex + 1;
        nextChildren.splice(insertAt, 0, newLeaf);
        nextSizes.splice(targetIndex, 1, half, half);
        return {
          kind: "split",
          direction: node.direction,
          children: nextChildren,
          sizes: normalizeSizes(nextSizes, nextChildren.length),
        };
      }
    }

    let changed = false;
    const nextChildren = node.children.map((child) => {
      if (inserted) return child;
      const updated = insert(child);
      if (updated !== child) changed = true;
      return updated;
    });
    return changed ? { ...node, children: nextChildren } : node;
  }

  const next = insert(withoutNew);
  if (!inserted) {
    // Fallback: split at root if targetKey wasn't found.
    return normalizeLayoutTree({
      kind: "split",
      direction,
      children: insertBefore ? [newLeaf, withoutNew] : [withoutNew, newLeaf],
      sizes: [0.5, 0.5],
    });
  }
  return normalizeLayoutTree(next);
}

export function resizeSplitBoundary(
  root: SplitLayoutNode | null,
  splitPath: string,
  boundaryIndex: number,
  newPosition: number,
): SplitLayoutNode | null {
  if (!root || !Number.isFinite(newPosition)) return root;
  const segments = splitPath ? splitPath.split(".").map(Number) : [];

  function update(node: SplitLayoutNode, depth: number): SplitLayoutNode {
    if (node.kind !== "split") return node;
    if (depth === segments.length) {
      const count = node.children.length;
      if (boundaryIndex < 0 || boundaryIndex >= count - 1) return node;
      const sizes = normalizeSizes(node.sizes, count);
      let prefixBefore = 0;
      for (let i = 0; i < boundaryIndex; i++) {
        prefixBefore += sizes[i]!;
      }
      const pairTotal = sizes[boundaryIndex]! + sizes[boundaryIndex + 1]!;
      const minChild = Math.min(MIN_SPLIT_CHILD_SIZE, pairTotal / 2);
      const clampedLeft = Math.max(
        minChild,
        Math.min(pairTotal - minChild, newPosition - prefixBefore),
      );
      const nextSizes = [...sizes];
      nextSizes[boundaryIndex] = clampedLeft;
      nextSizes[boundaryIndex + 1] = pairTotal - clampedLeft;
      return {
        ...node,
        sizes: normalizeSizes(nextSizes, count),
      };
    }

    const childIdx = segments[depth];
    if (childIdx === undefined || childIdx < 0 || childIdx >= node.children.length) {
      return node;
    }
    const target = node.children[childIdx]!;
    const updated = update(target, depth + 1);
    if (updated === target) return node;
    const nextChildren = [...node.children];
    nextChildren[childIdx] = updated;
    return { ...node, children: nextChildren };
  }

  return update(root, 0);
}

export function reconcileLayoutTree(
  tree: SplitLayoutNode | null,
  paneGroups: readonly PaneKeyGroup[],
  activePaneKey?: string,
): SplitLayoutNode | null {
  if (paneGroups.length === 0) return null;
  if (!tree) {
    return buildDefaultLayout(paneGroups.map((group) => group.paneKey));
  }

  // Map every tab key to its owning pane's active paneKey.
  const tabKeyToPaneKey = new Map<string, string>();
  for (const group of paneGroups) {
    tabKeyToPaneKey.set(group.paneKey, group.paneKey);
    for (const tabKey of group.tabKeys) {
      tabKeyToPaneKey.set(tabKey, group.paneKey);
    }
  }

  const matchedPaneKeys = new Set<string>();

  function pruneAndRemap(node: SplitLayoutNode): SplitLayoutNode | null {
    if (node.kind === "leaf") {
      const resolved = tabKeyToPaneKey.get(node.paneKey);
      if (!resolved || matchedPaneKeys.has(resolved)) return null;
      matchedPaneKeys.add(resolved);
      return resolved === node.paneKey ? node : { kind: "leaf", paneKey: resolved };
    }
    const nextChildren: SplitLayoutNode[] = [];
    const nextSizes: number[] = [];
    const sizes = normalizeSizes(node.sizes, node.children.length);
    for (let i = 0; i < node.children.length; i++) {
      const mapped = pruneAndRemap(node.children[i]!);
      if (mapped) {
        nextChildren.push(mapped);
        nextSizes.push(sizes[i]!);
      }
    }
    if (nextChildren.length === 0) return null;
    if (nextChildren.length === 1) return nextChildren[0]!;
    return {
      kind: "split",
      direction: node.direction,
      children: nextChildren,
      sizes: normalizeSizes(nextSizes, nextChildren.length),
    };
  }

  let current = normalizeLayoutTree(pruneAndRemap(tree));
  const missing = paneGroups.filter((group) => !matchedPaneKeys.has(group.paneKey));

  for (const group of missing) {
    if (!current) {
      current = { kind: "leaf", paneKey: group.paneKey };
      continue;
    }
    const leaves = collectLeafKeys(current);
    const anchor =
      activePaneKey && leaves.includes(activePaneKey) ? activePaneKey : leaves[leaves.length - 1]!;
    current = splitLeafInTree(current, anchor, group.paneKey, "right");
  }

  return normalizeLayoutTree(current);
}

export function computeLayoutRects(root: SplitLayoutNode | null): ComputedSplitLayout {
  const paneRects = new Map<string, NormalizedRect>();
  const dividers: SplitDividerDescriptor[] = [];

  function walk(node: SplitLayoutNode, rect: NormalizedRect, splitPath: string) {
    if (node.kind === "leaf") {
      paneRects.set(node.paneKey, rect);
      return;
    }

    const sizes = normalizeSizes(node.sizes, node.children.length);
    const horizontal = node.direction === "horizontal";
    let cursor = 0;

    for (let i = 0; i < node.children.length; i++) {
      const size = sizes[i]!;
      const childRect: NormalizedRect = horizontal
        ? {
            left: rect.left + rect.width * cursor,
            top: rect.top,
            width: rect.width * size,
            height: rect.height,
          }
        : {
            left: rect.left,
            top: rect.top + rect.height * cursor,
            width: rect.width,
            height: rect.height * size,
          };

      const childPath = splitPath ? `${splitPath}.${i}` : String(i);
      walk(node.children[i]!, childRect, childPath);

      if (i < node.children.length - 1) {
        const pairTotal = size + sizes[i + 1]!;
        const minChild = Math.min(MIN_SPLIT_CHILD_SIZE, pairTotal / 2);
        const position = cursor + size;
        dividers.push({
          id: `${splitPath || "root"}:${i}`,
          splitPath,
          boundaryIndex: i,
          orientation: horizontal ? "vertical" : "horizontal",
          branchRect: rect,
          position,
          minPosition: cursor + minChild,
          maxPosition: cursor + pairTotal - minChild,
          defaultPosition: cursor + pairTotal / 2,
        });
      }

      cursor += size;
    }
  }

  if (root) {
    walk(root, { left: 0, top: 0, width: 1, height: 1 }, "");
  }

  return { paneRects, dividers };
}

export function decodeSplitLayoutTree(value: unknown, depth = 0): SplitLayoutNode | null {
  if (depth > 32 || typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (obj.kind === "leaf") {
    return typeof obj.paneKey === "string" && obj.paneKey.length > 0
      ? { kind: "leaf", paneKey: obj.paneKey }
      : null;
  }
  if (obj.kind === "split") {
    if (obj.direction !== "horizontal" && obj.direction !== "vertical") return null;
    if (!Array.isArray(obj.children) || obj.children.length === 0) return null;
    const children: SplitLayoutNode[] = [];
    const sizes: number[] = [];
    const rawSizes = Array.isArray(obj.sizes) ? obj.sizes : [];
    for (let i = 0; i < obj.children.length; i++) {
      const child = decodeSplitLayoutTree(obj.children[i], depth + 1);
      if (!child) continue;
      children.push(child);
      const rawSize = rawSizes[i];
      sizes.push(
        typeof rawSize === "number" && Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 1,
      );
    }
    if (children.length === 0) return null;
    return normalizeLayoutTree({
      kind: "split",
      direction: obj.direction,
      children,
      sizes: normalizeSizes(sizes, children.length),
    });
  }
  return null;
}
