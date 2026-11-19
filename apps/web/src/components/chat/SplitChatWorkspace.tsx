import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  Fragment,
  memo,
  type CSSProperties,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useId,
} from "react";

import "./SplitChatWorkspace.css";

import { ComposerHandleContext, useComposerHandleContext } from "../../composerHandleContext";
import { isElectron } from "../../env";
import { usePanelAnimationSettings } from "../../panelAnimations";
import { cn } from "../../lib/utils";
import {
  computeLayoutRects,
  reconcileLayoutTree,
  removeLeafFromTree,
  resizeSplitBoundary,
  splitLeafInTree,
  swapLeavesInTree,
  type NormalizedRect,
  type SplitEdge,
  type SplitLayoutNode,
} from "../../splitChatLayout";
import {
  MAX_SPLIT_CHATS,
  tabsForPane,
  threadTargetKey,
  useSplitChatStore,
  type SplitChatTabGroups,
} from "../../splitChatStore";
import { writeSplitWorkspace } from "../../splitChatWorkspaceStorage";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../../threadRoutes";
import { ThreadRouteView } from "../ThreadRouteView";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SplitChatPaneActiveContext, SplitChatPaneControlsContext } from "./splitChatPaneContext";
import { SplitResizeDivider } from "./SplitResizeDivider";
import { SplitChatDragHandle } from "./SplitChatDragHandle";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  registerThreadWorkspaceDrop,
  moveThreadContextDrag,
  endThreadContextDrag,
} from "./threadContextDrag";

interface SplitChatWorkspaceProps {
  readonly primaryTarget: ThreadRouteTarget | null;
  readonly modalOpen: boolean;
  readonly initialMaximizedPane?: number | null;
  readonly onLayoutReady?: () => void;
}

// Stays the draft's key after promotion so the pane keeps its ChatView mounted.
function paneKey(target: ThreadRouteTarget | undefined): string {
  if (!target) return "";
  return target.kind === "server" ? scopedThreadKey(target.threadRef) : `draft:${target.draftId}`;
}

type DropZone =
  | { index: number; mode: "swap" }
  | { index: number; mode: "center-tab" }
  | { index: number; mode: "blocked" }
  | { index: number; mode: "split"; edge: SplitEdge }
  | { index: number; mode: "tab"; tabIndex: number };

const EDGE_SPLIT_THRESHOLD = 0.28;

function replaceGroups(
  groups: SplitChatTabGroups,
  affected: SplitChatTabGroups,
  replacements: SplitChatTabGroups,
): SplitChatTabGroups {
  return [
    ...groups.filter((group) => !affected.includes(group)),
    ...replacements.filter((tabs) => tabs.length > 1),
  ];
}

function distinctPanes(all: readonly ThreadRouteTarget[], groups: SplitChatTabGroups) {
  return all.filter((pane, index) => {
    const tabs = tabsForPane(groups, pane);
    return !all
      .slice(0, index)
      .some((other) => tabs.some((tab) => threadTargetKey(tab) === threadTargetKey(other)));
  });
}

const DETACH_WINDOW_MARGIN_PX = 16;

function isOutsideWindow(point: { x: number; y: number }): boolean {
  return (
    point.x < -DETACH_WINDOW_MARGIN_PX ||
    point.x > window.innerWidth + DETACH_WINDOW_MARGIN_PX ||
    point.y < -DETACH_WINDOW_MARGIN_PX ||
    point.y > window.innerHeight + DETACH_WINDOW_MARGIN_PX
  );
}

function rectToCss(rect: NormalizedRect): CSSProperties {
  return {
    left: `${rect.left * 100}%`,
    top: `${rect.top * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}

function splitPreviewRect(rect: NormalizedRect, edge: SplitEdge): NormalizedRect {
  switch (edge) {
    case "left":
      return { left: rect.left, top: rect.top, width: rect.width / 2, height: rect.height };
    case "right":
      return {
        left: rect.left + rect.width / 2,
        top: rect.top,
        width: rect.width / 2,
        height: rect.height,
      };
    case "top":
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height / 2 };
    case "bottom":
      return {
        left: rect.left,
        top: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height / 2,
      };
  }
}

function splitEdgeLabel(edge: SplitEdge): string {
  switch (edge) {
    case "left":
      return "Split left";
    case "right":
      return "Split right";
    case "top":
      return "Split top";
    case "bottom":
      return "Split bottom";
  }
}

function toPaneKeyGroups(panes: readonly ThreadRouteTarget[], groups: SplitChatTabGroups) {
  return panes.map((pane) => ({
    paneKey: threadTargetKey(pane),
    tabKeys: tabsForPane(groups, pane).map(threadTargetKey),
  }));
}

export const SplitChatWorkspace = memo(function SplitChatWorkspace({
  primaryTarget,
  modalOpen,
  initialMaximizedPane = null,
  onLayoutReady,
}: SplitChatWorkspaceProps) {
  const navigate = useNavigate();
  const router = useRouter();
  const workspaceId = useId();
  const composerHandle = useComposerHandleContext();
  const animations = usePanelAnimationSettings();
  const store = useSplitChatStore();
  const { secondaryPanes, tabGroups, activePaneIndex, layoutTree } = store;
  const [maximizedPaneIndex, setMaximizedPaneIndex] = useState<number | null>(initialMaximizedPane);
  const [dragLayoutPreview, setDragLayoutPreview] = useState<SplitLayoutNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<ThreadRouteTarget | null>(null);
  const focusTargetRef = useRef<{ key: string; tab?: boolean } | null>(null);
  const [pendingPrimary, setPendingPrimary] = useState<{
    previousKey: string;
    target: ThreadRouteTarget;
  } | null>(null);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const primaryKey = threadTargetKey(primaryTarget);
  const effectivePrimary =
    pendingPrimary && primaryKey === pendingPrimary.previousKey
      ? pendingPrimary.target
      : primaryTarget;
  if (pendingPrimary && primaryKey !== pendingPrimary.previousKey) setPendingPrimary(null);

  const allPanes = effectivePrimary ? [effectivePrimary, ...secondaryPanes] : [...secondaryPanes];
  const panes = distinctPanes(allPanes, tabGroups);
  const count = panes.length;
  if (count < 2 && maximizedPaneIndex !== null) setMaximizedPaneIndex(null);
  const maximized =
    count > 1 && maximizedPaneIndex !== null && maximizedPaneIndex < count
      ? maximizedPaneIndex
      : null;
  const activeIndex = Math.min(activePaneIndex, count - 1);
  if (maximized !== null && maximized !== activeIndex) setMaximizedPaneIndex(null);

  const paneKeyGroups = toPaneKeyGroups(panes, tabGroups);
  const activePaneKey = panes[activeIndex] ? threadTargetKey(panes[activeIndex]) : undefined;
  const reconciledLayout = reconcileLayoutTree(layoutTree, paneKeyGroups, activePaneKey);
  const activeLayout = dragLayoutPreview ?? reconciledLayout;
  const computedLayout = computeLayoutRects(activeLayout);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the latest visible workspace so quit does not need a final async write
  useEffect(() => {
    const primary = panes[0];
    if (!primary) return;
    writeSplitWorkspace({
      primary,
      secondary: panes.slice(1),
      groups: tabGroups.filter((group) =>
        panes.some((pane) => tabsForPane(tabGroups, pane) === group),
      ),
      activeIndex: Math.max(0, activeIndex),
      maximizedIndex: maximized,
      layoutTree: reconciledLayout,
    });
  }, [panes, tabGroups, activeIndex, maximized, reconciledLayout]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- consumes the startup maximize setting once
  useEffect(() => {
    if (initialMaximizedPane !== null) onLayoutReady?.();
  }, [initialMaximizedPane, onLayoutReady]);

  const navigatePrimary = (target: ThreadRouteTarget) => {
    setPendingPrimary({ previousKey: primaryKey, target });
    if (target.kind === "server") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(target.threadRef),
        replace: true,
      });
    } else {
      void navigate({ to: "/draft/$draftId", params: { draftId: target.draftId }, replace: true });
    }
  };
  const commitPanes = (
    next: readonly ThreadRouteTarget[],
    groups: SplitChatTabGroups,
    active: number,
    focus?: { key: string; tab?: boolean },
    nextLayoutTree?: SplitLayoutNode | null,
  ) => {
    const nextPrimary = next[0];
    if (!nextPrimary) return false;
    if (threadTargetKey(nextPrimary) !== threadTargetKey(effectivePrimary))
      navigatePrimary(nextPrimary);
    if (focus) focusTargetRef.current = focus;
    const resolvedTree = reconcileLayoutTree(
      nextLayoutTree !== undefined ? nextLayoutTree : reconciledLayout,
      toPaneKeyGroups(next, groups),
      next[active] ? threadTargetKey(next[active]) : undefined,
    );
    setDragLayoutPreview(null);
    store.replaceSecondaryPanes(next.slice(1), active, groups, resolvedTree);
    return true;
  };

  // Reads the live store so several unavailable panes closing together don't restore each other.
  const close = (key: string, focusTab = false) => {
    const latest = useSplitChatStore.getState();
    const groups = latest.tabGroups;
    const current = distinctPanes(
      effectivePrimary ? [effectivePrimary, ...latest.secondaryPanes] : latest.secondaryPanes,
      groups,
    );
    const index = current.findIndex((pane) =>
      tabsForPane(groups, pane).some((tab) => threadTargetKey(tab) === key),
    );
    const pane = current[index];
    if (!pane) return;
    const tabs = tabsForPane(groups, pane);
    const tabIndex = tabs.findIndex((tab) => threadTargetKey(tab) === key);
    const remainingTabs = tabs.filter((_, i) => i !== tabIndex);
    const currentTree = reconcileLayoutTree(
      latest.layoutTree,
      toPaneKeyGroups(current, groups),
      current[latest.activePaneIndex]
        ? threadTargetKey(current[latest.activePaneIndex])
        : undefined,
    );
    if (remainingTabs.length) {
      const next = [...current];
      const selected =
        threadTargetKey(pane) === key
          ? remainingTabs[Math.min(tabIndex, remainingTabs.length - 1)]!
          : pane;
      next[index] = selected;
      const nextGroups = replaceGroups(groups, [tabs], [remainingTabs]);
      commitPanes(
        next,
        nextGroups,
        latest.activePaneIndex,
        focusTab ? { key: paneKey(selected), tab: true } : undefined,
        currentTree,
      );
      return;
    }
    if (current.length < 2) {
      if (focusTab) {
        writeSplitWorkspace(null);
        void navigate({ to: "/" });
      }
      return;
    }
    setMaximizedPaneIndex((value) =>
      value === null || value === index ? null : value > index ? value - 1 : value,
    );
    const next = current.filter((_, paneIndex) => paneIndex !== index);
    const active =
      latest.activePaneIndex > index
        ? latest.activePaneIndex - 1
        : Math.min(latest.activePaneIndex, next.length - 1);
    const nextTree = removeLeafFromTree(currentTree, threadTargetKey(pane));
    commitPanes(
      next,
      groups,
      active,
      latest.activePaneIndex === index ? { key: paneKey(next[active]) } : undefined,
      nextTree,
    );
  };

  const selectTab = (index: number, target: ThreadRouteTarget) => {
    const next = [...panes];
    next[index] = target;
    commitPanes(next, tabGroups, index, { key: paneKey(target), tab: true }, reconciledLayout);
  };

  const detachToNewWindow = useStableCallback(async (target: ThreadRouteTarget) => {
    if (target.kind !== "server") return;
    const { href, pathname } = router.buildLocation({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(target.threadRef),
    });
    const url = new URL(href, window.location.href);
    let opened = false;
    if (window.desktopBridge?.openThreadWindow) {
      opened = await window.desktopBridge.openThreadWindow(pathname).catch(() => false);
      if (!opened) {
        toastManager.add({ type: "error", title: "Could not open thread window" });
      }
    } else {
      url.searchParams.set("threadWindow", "1");
      opened =
        window.open(url.href, "_blank", "popup,noopener,noreferrer,width=1000,height=780") !== null;
    }
    if (!opened) return;
    const key = threadTargetKey(target);
    const latest = useSplitChatStore.getState();
    const current = distinctPanes(
      effectivePrimary ? [effectivePrimary, ...latest.secondaryPanes] : latest.secondaryPanes,
      latest.tabGroups,
    );
    const pane = current.find((entry) =>
      tabsForPane(latest.tabGroups, entry).some((tab) => threadTargetKey(tab) === key),
    );
    const tabCount = pane ? tabsForPane(latest.tabGroups, pane).length : 0;
    if (current.length > 1 || tabCount > 1) {
      close(key);
    }
  });

  const resolveDrop = (
    point: { x: number; y: number },
    target: ThreadRouteTarget | null,
    multiple = false,
  ): DropZone | null => {
    const container = containerRef.current;
    if (!container || modalOpen) return null;
    const rect = container.getBoundingClientRect();
    if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom)
      return null;
    const paneElements = Array.from(
      container.querySelectorAll<HTMLElement>("[data-split-pane-index]:not([hidden])"),
    );
    const element = paneElements.find((pane) => {
      const box = pane.getBoundingClientRect();
      return (
        point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom
      );
    });
    if (!element) return null;
    const index = Number(element.dataset.splitPaneIndex);
    if (multiple) return { index, mode: "blocked" };
    const key = threadTargetKey(target);
    const source = panes.findIndex((pane) =>
      tabsForPane(tabGroups, pane).some((tab) => threadTargetKey(tab) === key),
    );
    const sourcePane = panes[source];
    const sourceTabs = sourcePane ? tabsForPane(tabGroups, sourcePane) : [];
    const strip = element.querySelector<HTMLElement>("[data-split-tab-strip]");
    const header = strip?.getBoundingClientRect();
    if (header && point.y <= header.bottom) {
      const buttons = Array.from(strip!.querySelectorAll<HTMLElement>("[data-split-chat-tab]"));
      const before = buttons.findIndex((tab) => {
        const box = (tab.parentElement ?? tab).getBoundingClientRect();
        return point.x < box.left + box.width / 2;
      });
      const tabIndex = before < 0 ? buttons.length : before;
      if (source === index) {
        const from = sourceTabs.findIndex((tab) => threadTargetKey(tab) === key);
        if (tabIndex === from || tabIndex === from + 1) return null;
      }
      return { index, mode: "tab", tabIndex };
    }
    if (maximized !== null) return null;

    const box = element.getBoundingClientRect();
    const bodyTop = header ? header.bottom : box.top;
    const bodyHeight = Math.max(1, box.bottom - bodyTop);
    const rx = Math.max(0, Math.min(1, (point.x - box.left) / Math.max(1, box.width)));
    const ry = Math.max(0, Math.min(1, (point.y - bodyTop) / bodyHeight));

    const edgeDistances: readonly { edge: SplitEdge; dist: number }[] = [
      { edge: "left", dist: rx },
      { edge: "right", dist: 1 - rx },
      { edge: "top", dist: ry },
      { edge: "bottom", dist: 1 - ry },
    ];
    let closest = edgeDistances[0]!;
    for (const candidate of edgeDistances) {
      if (candidate.dist < closest.dist) closest = candidate;
    }

    if (closest.dist <= EDGE_SPLIT_THRESHOLD) {
      // Cannot split a single-tab pane with itself.
      if (source === index && sourceTabs.length === 1) return null;
      const addsNewPane = !sourcePane || sourceTabs.length > 1;
      if (addsNewPane && count >= MAX_SPLIT_CHATS) return { index, mode: "blocked" };
      return { index, mode: "split", edge: closest.edge };
    }

    // Center drop: swap single-tab panes or merge into the target pane as a tab.
    if (source === index) return null;
    if (sourcePane && sourceTabs.length === 1) return { index, mode: "swap" };
    return { index, mode: "center-tab" };
  };

  const place = (target: ThreadRouteTarget, zone: DropZone) => {
    if (zone.mode === "blocked") return false;
    const key = threadTargetKey(target);
    const next = [...panes];
    const source = next.findIndex((pane) =>
      tabsForPane(tabGroups, pane).some((tab) => threadTargetKey(tab) === key),
    );
    const sourcePane = next[source];
    const sourceTabs = sourcePane ? tabsForPane(tabGroups, sourcePane) : [];
    const sourceIndex = sourceTabs.findIndex((tab) => threadTargetKey(tab) === key);
    const remainingTabs = sourceTabs.filter((_, i) => i !== sourceIndex);
    let groups = tabGroups;
    let destinationIndex = zone.index;
    let nextTree: SplitLayoutNode | null = reconciledLayout;

    if (zone.mode === "swap") {
      const destination = next[zone.index];
      if (!sourcePane || !destination) return false;
      next[source] = destination;
      next[zone.index] = sourcePane;
      nextTree = swapLeavesInTree(
        reconciledLayout,
        threadTargetKey(sourcePane),
        threadTargetKey(destination),
      );
    } else if (zone.mode === "tab" || zone.mode === "center-tab") {
      const destination = next[zone.index];
      if (!destination) return false;
      const destinationTabs = tabsForPane(groups, destination);
      const merged = source === zone.index ? [...remainingTabs] : [...destinationTabs];
      const requestedTabIndex = zone.mode === "tab" ? zone.tabIndex : merged.length;
      const at =
        source === zone.index && sourceIndex < requestedTabIndex
          ? requestedTabIndex - 1
          : requestedTabIndex;
      merged.splice(at, 0, target);
      next[zone.index] = target;
      groups = replaceGroups(
        groups,
        [sourceTabs, destinationTabs],
        source === zone.index ? [merged] : [merged, remainingTabs],
      );
      if (sourcePane && source !== zone.index) {
        if (remainingTabs.length) {
          if (threadTargetKey(sourcePane) === key) {
            next[source] = remainingTabs[Math.min(sourceIndex, remainingTabs.length - 1)]!;
          }
        } else {
          nextTree = removeLeafFromTree(reconciledLayout, threadTargetKey(sourcePane));
          next.splice(source, 1);
          if (source < zone.index) destinationIndex--;
          setMaximizedPaneIndex((value) => (value === null ? null : destinationIndex));
        }
      }
      if (!sourcePane) {
        const previousGroup = tabsForPane(tabGroups, target);
        groups = replaceGroups(
          groups,
          [previousGroup],
          [previousGroup.filter((tab) => threadTargetKey(tab) !== key)],
        );
      }
    } else {
      // VS Code-style edge split (left / right / top / bottom)
      const destination = next[zone.index];
      if (!destination) return false;
      const movingWholePane = Boolean(sourcePane && remainingTabs.length === 0);

      if (movingWholePane && sourcePane) {
        const sourceKey = threadTargetKey(sourcePane);
        const destKey = threadTargetKey(destination);
        nextTree = splitLeafInTree(reconciledLayout, destKey, sourceKey, zone.edge);
        destinationIndex = source;
      } else {
        if (next.length >= MAX_SPLIT_CHATS) return false;
        let destKey = threadTargetKey(destination);
        if (sourcePane && remainingTabs.length) {
          if (threadTargetKey(sourcePane) === key) {
            const replacement = remainingTabs[Math.min(sourceIndex, remainingTabs.length - 1)]!;
            next[source] = replacement;
            if (source === zone.index) {
              destKey = threadTargetKey(replacement);
            }
          }
          groups = replaceGroups(groups, [sourceTabs], [remainingTabs]);
          nextTree = reconcileLayoutTree(reconciledLayout, toPaneKeyGroups(next, groups), destKey);
        } else if (!sourcePane) {
          // A sidebar drag can reopen a tab from a group whose pane isn't currently visible.
          const previousGroup = tabsForPane(groups, target);
          groups = replaceGroups(
            groups,
            [previousGroup],
            [previousGroup.filter((tab) => threadTargetKey(tab) !== key)],
          );
        }
        next.push(target);
        destinationIndex = next.length - 1;
        nextTree = splitLeafInTree(nextTree, destKey, key, zone.edge);
      }
    }

    setDropZone(null);
    return commitPanes(
      next,
      groups,
      destinationIndex,
      {
        key: paneKey(target),
        tab: zone.mode !== "swap",
      },
      nextTree,
    );
  };

  const showDrop = useStableCallback(
    (point: { x: number; y: number } | null, targets: readonly ThreadRouteTarget[]) => {
      const next = point
        ? resolveDrop(point, sourceRef.current ?? targets[0] ?? null, targets.length > 1)
        : null;
      setDropZone((previous) => {
        if (previous === next) return previous;
        if (!previous || !next) return next;
        if (previous.index !== next.index || previous.mode !== next.mode) return next;
        if (previous.mode === "tab" && next.mode === "tab" && previous.tabIndex === next.tabIndex) {
          return previous;
        }
        if (previous.mode === "split" && next.mode === "split" && previous.edge === next.edge) {
          return previous;
        }
        if (previous.mode !== "tab" && previous.mode !== "split") {
          return previous;
        }
        return next;
      });
    },
  );
  const dropThread = useStableCallback(
    (point: { x: number; y: number }, targets: readonly ThreadRouteTarget[]) => {
      const target = sourceRef.current ?? targets[0];
      if (!target) return false;
      const zone = resolveDrop(point, target, targets.length > 1);
      return zone ? place(target, zone) : false;
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the workspace with the sidebar's pointer drag dispatcher
  useEffect(
    () =>
      registerThreadWorkspaceDrop({
        move: (point, threads) =>
          showDrop(
            point,
            threads.map((threadRef) => ({ kind: "server", threadRef })),
          ),
        drop: (point, threads) =>
          dropThread(
            point,
            threads.map((threadRef) => ({ kind: "server", threadRef })),
          ),
      }),
    [showDrop, dropThread],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reconciles split membership when the URL opens an existing secondary thread
  useEffect(() => {
    if (panes.length === allPanes.length) return;
    const activeTarget = allPanes[activePaneIndex];
    const nextActiveIndex = panes.findIndex(
      (pane) => threadTargetKey(pane) === threadTargetKey(activeTarget),
    );
    store.replaceSecondaryPanes(
      effectivePrimary ? panes.slice(1) : panes,
      Math.max(0, nextActiveIndex),
      tabGroups,
      reconciledLayout,
    );
  }, [panes, allPanes, activePaneIndex, effectivePrimary, tabGroups, reconciledLayout, store]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores DOM focus after a pane is closed or moved
  useLayoutEffect(() => {
    const key = focusTargetRef.current;
    if (!key) return;
    const pane = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>("[data-split-pane-key]") ?? [],
    ).find((element) => element.dataset.splitPaneKey === key.key);
    if (!pane) return;
    focusTargetRef.current = null;
    const handle = pane.querySelector<HTMLElement>(
      key.tab
        ? '[data-split-chat-tab][aria-selected="true"]'
        : '[aria-label="Drag chat to rearrange"]',
    );
    if (key.tab) handle?.scrollIntoView({ block: "nearest", inline: "nearest" });
    (handle ?? pane).focus({ preventScroll: true });
  });

  if (count === 0) return null;

  const dropPreviewStyle: CSSProperties | null = (() => {
    if (!dropZone || dropZone.mode === "tab") return null;
    if (dropZone.mode === "blocked") return { inset: 4 };
    const hoveredPane = panes[dropZone.index];
    const hoveredRect = hoveredPane
      ? computedLayout.paneRects.get(threadTargetKey(hoveredPane))
      : undefined;
    if (!hoveredRect) return null;
    if (dropZone.mode === "split") {
      return rectToCss(splitPreviewRect(hoveredRect, dropZone.edge));
    }
    return rectToCss(hoveredRect);
  })();

  const dropPreviewLabel = (() => {
    if (!dropZone || dropZone.mode === "tab") return null;
    if (dropZone.mode === "blocked") {
      return `Open up to ${MAX_SPLIT_CHATS} panes. Drag one chat at a time.`;
    }
    if (dropZone.mode === "swap") return "Swap chats";
    if (dropZone.mode === "center-tab") return "Add as tab";
    return splitEdgeLabel(dropZone.edge);
  })();

  return (
    <SidebarInset
      className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh"
      inert={modalOpen}
    >
      <div
        ref={containerRef}
        data-split-workspace
        className={cn("relative flex-1 min-h-0 min-w-0 overflow-hidden", count > 1 && "m-1")}
      >
        {panes.map((target, index) => {
          const tabs = tabsForPane(tabGroups, target);
          const activeTabKey = threadTargetKey(target);
          const paneRect = computedLayout.paneRects.get(activeTabKey) ?? {
            left: 0,
            top: 0,
            width: 1,
            height: 1,
          };
          // A secondary pane keeps its DOM and focus when a different tab in it is selected.
          const paneIdentity = tabs.map(paneKey).sort()[0];
          const panelId = `${workspaceId}-pane-${index}`;
          const tabId = (tabIndex: number) => `${panelId}-tab-${tabIndex}`;
          const selectedTabIndex = tabs.findIndex((tab) => threadTargetKey(tab) === activeTabKey);
          const dragCallbacks = (dragTarget: ThreadRouteTarget) => ({
            onMove: (point: { x: number; y: number }, title: string) => {
              sourceRef.current = dragTarget;
              const detach = dragTarget.kind === "server" && isOutsideWindow(point);
              moveThreadContextDrag(point, { title, count: 1, pane: true, detach });
            },
            onDrop: (point: { x: number; y: number }) => {
              sourceRef.current = dragTarget;
              if (dragTarget.kind === "server" && isOutsideWindow(point)) {
                void detachToNewWindow(dragTarget);
                return;
              }
              dropThread(point, [dragTarget]);
            },
            onEnd: () => {
              sourceRef.current = null;
              endThreadContextDrag();
            },
          });
          return (
            <div
              // The primary pane keeps one key so draft promotion keeps its ChatView mounted.
              key={index === 0 ? "primary" : paneIdentity}
              data-split-pane-index={index}
              data-split-pane-key={paneKey(target)}
              tabIndex={-1}
              hidden={maximized !== null && maximized !== index}
              style={{
                ...(maximized === index
                  ? { left: 0, top: 0, width: "100%", height: "100%" }
                  : rectToCss(paneRect)),
                animationDuration: animations.active
                  ? `${Math.min(animations.durationMs, 160)}ms`
                  : "0ms",
              }}
              className={cn("absolute min-h-0 min-w-0", count > 1 && "p-1")}
              onPointerDown={() => store.setActivePane(index)}
              onFocusCapture={() => store.setActivePane(index)}
            >
              <div
                className={cn(
                  "relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background",
                  count > 1 &&
                    "rounded-lg border transition-colors duration-150 motion-reduce:transition-none",
                  count > 1 && (activePaneIndex === index ? "border-primary/40" : "border-border"),
                )}
              >
                <div
                  data-split-tab-strip
                  onPointerDown={(event) => event.stopPropagation()}
                  className={cn(
                    "relative z-10 flex h-7 shrink-0 items-center border-b border-border bg-muted/20",
                    isElectron && "drag-region",
                    dropZone?.mode === "tab" &&
                      dropZone.index === index &&
                      "bg-primary/15 ring-1 ring-inset ring-primary/50",
                  )}
                >
                  <div
                    role="tablist"
                    aria-label={`Chats in pane ${index + 1}`}
                    className="flex h-full max-w-full min-w-0 shrink items-center gap-0.5 overflow-x-auto overflow-y-hidden px-0.5 [scrollbar-width:none]"
                  >
                    {tabs.map((tab, tabIndex) => (
                      <Fragment key={paneKey(tab)}>
                        <SplitChatDragHandle
                          target={tab}
                          {...dragCallbacks(tab)}
                          tab={{
                            key: paneKey(tab),
                            id: tabId(tabIndex),
                            panelId,
                            selected: threadTargetKey(tab) === activeTabKey,
                            onSelect: () => selectTab(index, tab),
                            onClose: () => close(threadTargetKey(tab), true),
                          }}
                          onMoveByKeyboard={(direction) =>
                            selectTab(
                              index,
                              tabs[(tabIndex + direction + tabs.length) % tabs.length]!,
                            )
                          }
                        />
                        {tabIndex < tabs.length - 1 ? (
                          <span
                            aria-hidden="true"
                            data-split-chat-tab-divider
                            className="mx-0.5 h-5 w-0.5 shrink-0 bg-foreground/45 [-webkit-app-region:no-drag]"
                          />
                        ) : null}
                      </Fragment>
                    ))}
                  </div>
                  <div
                    aria-hidden="true"
                    data-split-tab-strip-spacer
                    className={cn("h-full min-w-4 flex-1", isElectron && "drag-region")}
                  />
                </div>
                <SplitChatPaneControlsContext
                  value={
                    count > 1 ? (
                      <div
                        className="relative z-10 flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {maximized === null ? (
                          <SplitChatDragHandle
                            target={target}
                            {...dragCallbacks(target)}
                            onMoveByKeyboard={(direction) => {
                              const destination = (index + direction + count) % count;
                              if (destination !== index)
                                place(target, { index: destination, mode: "swap" });
                            }}
                          />
                        ) : null}
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={
                                  maximized === index
                                    ? "Restore split layout"
                                    : "Maximize chat pane"
                                }
                                onClick={() => {
                                  store.setActivePane(index);
                                  setMaximizedPaneIndex(maximized === index ? null : index);
                                }}
                              >
                                {maximized === index ? <Minimize2 /> : <Maximize2 />}
                              </Button>
                            }
                          />
                          <TooltipPopup>
                            {maximized === index ? "Restore split layout" : "Maximize this chat"}
                          </TooltipPopup>
                        </Tooltip>
                      </div>
                    ) : null
                  }
                >
                  <SplitChatPaneActiveContext value={index === activeIndex}>
                    {/* The app-wide composer handle belongs to the active pane only. */}
                    <ComposerHandleContext value={index === activeIndex ? composerHandle : null}>
                      <div
                        role="tabpanel"
                        id={panelId}
                        aria-labelledby={tabId(selectedTabIndex)}
                        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                      >
                        <ThreadRouteView
                          target={target}
                          asPane
                          ownsRoute={index === 0}
                          background={modalOpen}
                          onTargetUnavailable={
                            count > 1 || tabs.length > 1 ? () => close(activeTabKey) : undefined
                          }
                        />
                      </div>
                    </ComposerHandleContext>
                  </SplitChatPaneActiveContext>
                </SplitChatPaneControlsContext>
              </div>
            </div>
          );
        })}
        {maximized !== null || count < 2
          ? null
          : computedLayout.dividers.map((descriptor) => {
              const vertical = descriptor.orientation === "vertical";
              const style: CSSProperties = vertical
                ? {
                    left: `${(descriptor.branchRect.left + descriptor.branchRect.width * descriptor.position) * 100}%`,
                    top: `${descriptor.branchRect.top * 100}%`,
                    height: `${descriptor.branchRect.height * 100}%`,
                  }
                : {
                    left: `${descriptor.branchRect.left * 100}%`,
                    top: `${(descriptor.branchRect.top + descriptor.branchRect.height * descriptor.position) * 100}%`,
                    width: `${descriptor.branchRect.width * 100}%`,
                  };
              return (
                <SplitResizeDivider
                  key={descriptor.id}
                  containerRef={containerRef}
                  orientation={descriptor.orientation}
                  branchRect={descriptor.branchRect}
                  position={descriptor.position}
                  minPosition={descriptor.minPosition}
                  maxPosition={descriptor.maxPosition}
                  defaultPosition={descriptor.defaultPosition}
                  style={style}
                  onPreview={(nextPosition) => {
                    setDragLayoutPreview(
                      resizeSplitBoundary(
                        reconciledLayout,
                        descriptor.splitPath,
                        descriptor.boundaryIndex,
                        nextPosition,
                      ),
                    );
                  }}
                  onCommit={(nextPosition) => {
                    const updated = resizeSplitBoundary(
                      reconciledLayout,
                      descriptor.splitPath,
                      descriptor.boundaryIndex,
                      nextPosition,
                    );
                    setDragLayoutPreview(null);
                    store.setLayoutTree(updated);
                  }}
                  onCancel={() => {
                    setDragLayoutPreview(null);
                  }}
                />
              );
            })}
        {dropZone && dropPreviewStyle && dropPreviewLabel ? (
          <div
            key={`${dropZone.mode}:${dropZone.index}:${dropZone.mode === "split" ? dropZone.edge : ""}`}
            aria-hidden="true"
            data-split-drop-preview
            className="pointer-events-none absolute z-40 flex items-center justify-center rounded-lg border-2 border-primary/50 bg-primary/10 p-4"
            style={{
              ...dropPreviewStyle,
              animationDuration: animations.active
                ? `${Math.min(animations.durationMs, 120)}ms`
                : "0ms",
            }}
          >
            <span className="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm">
              {dropPreviewLabel}
            </span>
          </div>
        ) : null}
      </div>
    </SidebarInset>
  );
});
