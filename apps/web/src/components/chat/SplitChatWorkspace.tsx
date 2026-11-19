import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { Columns2, Maximize2, Minimize2, Rows2, X } from "lucide-react";
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
import { usePanelAnimationSettings } from "../../panelAnimations";
import { cn } from "../../lib/utils";
import {
  MAX_SPLIT_CHATS,
  tabsForPane,
  threadTargetKey,
  useSplitChatStore,
  type SplitChatTabGroups,
} from "../../splitChatStore";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../../threadRoutes";
import { ThreadRouteView } from "../ThreadRouteView";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
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
}

// Stays the draft's key after promotion so the pane keeps its ChatView mounted.
function paneKey(target: ThreadRouteTarget | undefined): string {
  if (!target) return "";
  return target.kind === "server" ? scopedThreadKey(target.threadRef) : `draft:${target.draftId}`;
}

type DropZone =
  | { index: number; mode: "swap" | "insert" | "blocked" }
  | { index: number; mode: "tab"; tabIndex: number };

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

export const SplitChatWorkspace = memo(function SplitChatWorkspace({
  primaryTarget,
  modalOpen,
}: SplitChatWorkspaceProps) {
  const navigate = useNavigate();
  const workspaceId = useId();
  const composerHandle = useComposerHandleContext();
  const animations = usePanelAnimationSettings();
  const store = useSplitChatStore();
  const {
    secondaryPanes,
    tabGroups,
    activePaneIndex,
    horizontalRatio,
    verticalRatio,
    topRowRatio,
    bottomRowRatio,
    rightColumnRatio,
    resizeLayout,
  } = store;
  const [maximizedPaneIndex, setMaximizedPaneIndex] = useState<number | null>(null);
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
  const columns = count === 4 && resizeLayout === "columns";
  const x = "var(--split-x)";
  const y = "var(--split-y)";
  const topX = "var(--split-top-x)";
  const bottomX = "var(--split-bottom-x)";
  const rightY = "var(--split-right-y)";
  const remaining = (value: string) => `calc(100% - ${value})`;
  const layoutBounds = (size: number): CSSProperties[] =>
    size >= 5
      ? Array.from({ length: size }, (_, index) => {
          const topRow = index < 3;
          const column = topRow ? index : index - 3;
          const width = 100 / (topRow ? 3 : size - 3);
          return {
            left: `${column * width}%`,
            top: topRow ? 0 : y,
            width: `${width}%`,
            height: topRow ? y : remaining(y),
          };
        })
      : size === 1
        ? [{ left: 0, top: 0, width: "100%", height: "100%" }]
        : size === 2
          ? [
              { left: 0, top: 0, width: x, height: "100%" },
              { left: x, top: 0, width: remaining(x), height: "100%" },
            ]
          : size === 4 && resizeLayout === "columns"
            ? [
                { left: 0, top: 0, width: x, height: y },
                { left: x, top: 0, width: remaining(x), height: rightY },
                { left: 0, top: y, width: x, height: remaining(y) },
                { left: x, top: rightY, width: remaining(x), height: remaining(rightY) },
              ]
            : [
                { left: 0, top: 0, width: topX, height: y },
                { left: topX, top: 0, width: remaining(topX), height: y },
                { left: 0, top: y, width: size === 3 ? "100%" : bottomX, height: remaining(y) },
                { left: bottomX, top: y, width: remaining(bottomX), height: remaining(y) },
              ];

  const bounds = layoutBounds(count);

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
  ) => {
    const nextPrimary = next[0];
    if (!nextPrimary) return false;
    if (threadTargetKey(nextPrimary) !== threadTargetKey(effectivePrimary))
      navigatePrimary(nextPrimary);
    if (focus) focusTargetRef.current = focus;
    store.replaceSecondaryPanes(next.slice(1), active, groups);
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
    if (remainingTabs.length) {
      const next = [...current];
      const selected =
        threadTargetKey(pane) === key
          ? remainingTabs[Math.min(tabIndex, remainingTabs.length - 1)]!
          : pane;
      next[index] = selected;
      commitPanes(
        next,
        replaceGroups(groups, [tabs], [remainingTabs]),
        latest.activePaneIndex,
        focusTab ? { key: paneKey(selected), tab: true } : undefined,
      );
      return;
    }
    if (current.length < 2) return;
    setMaximizedPaneIndex((value) =>
      value === null || value === index ? null : value > index ? value - 1 : value,
    );
    const next = current.filter((_, paneIndex) => paneIndex !== index);
    const active =
      latest.activePaneIndex > index
        ? latest.activePaneIndex - 1
        : Math.min(latest.activePaneIndex, next.length - 1);
    commitPanes(
      next,
      groups,
      active,
      latest.activePaneIndex === index ? { key: paneKey(next[active]) } : undefined,
    );
  };

  const selectTab = (index: number, target: ThreadRouteTarget) => {
    const next = [...panes];
    next[index] = target;
    commitPanes(next, tabGroups, index, { key: paneKey(target), tab: true });
  };

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
    let index = Number(element.dataset.splitPaneIndex);
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
        const box = tab.getBoundingClientRect();
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
    if (sourceTabs.length === 1) return source === index ? null : { index, mode: "swap" };
    if (count >= MAX_SPLIT_CHATS) return { index, mode: "blocked" };
    if (sourceTabs.length > 1) {
      const pane = element.getBoundingClientRect();
      const splitAfter = point.x > pane.left + pane.width / 2;
      return { index: index + Number(splitAfter), mode: "insert" };
    }
    if (count === 1) index = point.x < rect.left + rect.width / 2 ? 0 : 1;
    if (count === 2 && point.y > rect.top + rect.height * 0.75) index = 2;
    if (count === 3 && index === 2 && point.x > rect.left + rect.width * bottomRowRatio) index = 3;
    return { index, mode: "insert" };
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

    if (zone.mode === "swap") {
      const destination = next[zone.index];
      if (!sourcePane || !destination) return false;
      next[source] = destination;
      next[zone.index] = sourcePane;
    } else if (zone.mode === "tab") {
      const destination = next[zone.index];
      if (!destination) return false;
      const destinationTabs = tabsForPane(groups, destination);
      const merged = source === zone.index ? [...remainingTabs] : [...destinationTabs];
      const at =
        source === zone.index && sourceIndex < zone.tabIndex ? zone.tabIndex - 1 : zone.tabIndex;
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
          next.splice(source, 1);
          if (source < zone.index) destinationIndex--;
          setMaximizedPaneIndex((value) => (value === null ? null : destinationIndex));
        }
      }
    } else {
      if (next.length >= MAX_SPLIT_CHATS) return false;
      if (sourcePane && remainingTabs.length) {
        if (threadTargetKey(sourcePane) === key) {
          next[source] = remainingTabs[Math.min(sourceIndex, remainingTabs.length - 1)]!;
        }
        groups = replaceGroups(groups, [sourceTabs], [remainingTabs]);
      } else if (!sourcePane) {
        // A sidebar drag can reopen a tab from a group whose pane isn't currently visible.
        const previousGroup = tabsForPane(groups, target);
        groups = replaceGroups(
          groups,
          [previousGroup],
          [previousGroup.filter((tab) => threadTargetKey(tab) !== key)],
        );
      }
      next.splice(zone.index, 0, target);
    }
    if (zone.mode === "tab" && !sourcePane) {
      const previousGroup = tabsForPane(tabGroups, target);
      groups = replaceGroups(
        groups,
        [previousGroup],
        [previousGroup.filter((tab) => threadTargetKey(tab) !== key)],
      );
    }
    setDropZone(null);
    return commitPanes(next, groups, destinationIndex, {
      key: paneKey(target),
      tab: zone.mode !== "swap",
    });
  };

  const showDrop = useStableCallback(
    (point: { x: number; y: number } | null, targets: readonly ThreadRouteTarget[]) => {
      const next = point
        ? resolveDrop(point, sourceRef.current ?? targets[0] ?? null, targets.length > 1)
        : null;
      setDropZone((previous) =>
        previous?.index === next?.index &&
        previous?.mode === next?.mode &&
        (previous?.mode !== "tab" || (next?.mode === "tab" && previous.tabIndex === next.tabIndex))
          ? previous
          : next,
      );
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
    const activeIndex = panes.findIndex(
      (pane) => threadTargetKey(pane) === threadTargetKey(activeTarget),
    );
    store.replaceSecondaryPanes(
      effectivePrimary ? panes.slice(1) : panes,
      Math.max(0, activeIndex),
    );
  }, [panes, allPanes, activePaneIndex, effectivePrimary, store]);
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
  const divider = (
    property: string,
    orientation: "vertical" | "horizontal",
    ratio: number,
    onResize: (value: number) => void,
    style: CSSProperties,
  ) => (
    <SplitResizeDivider
      key={property}
      containerRef={containerRef}
      property={property}
      orientation={orientation}
      ratio={ratio}
      onResize={onResize}
      style={style}
    />
  );

  return (
    <SidebarInset
      className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh"
      inert={modalOpen}
    >
      <div
        ref={containerRef}
        data-split-workspace
        data-split-layout={columns ? "columns" : "rows"}
        className={cn("relative flex-1 min-h-0 min-w-0 overflow-hidden", count > 1 && "m-1")}
        style={
          {
            "--split-x": `${horizontalRatio * 100}%`,
            "--split-y": `${verticalRatio * 100}%`,
            "--split-top-x": `${topRowRatio * 100}%`,
            "--split-bottom-x": `${bottomRowRatio * 100}%`,
            "--split-right-y": `${rightColumnRatio * 100}%`,
          } as CSSProperties
        }
      >
        {panes.map((target, index) => {
          const tabs = tabsForPane(tabGroups, target);
          const activeTabKey = threadTargetKey(target);
          // A secondary pane keeps its DOM and focus when a different tab in it is selected.
          const paneIdentity = tabs.map(paneKey).sort()[0];
          const panelId = `${workspaceId}-pane-${index}`;
          const tabId = (tabIndex: number) => `${panelId}-tab-${tabIndex}`;
          const selectedTabIndex = tabs.findIndex((tab) => threadTargetKey(tab) === activeTabKey);
          const dragCallbacks = (dragTarget: ThreadRouteTarget) => ({
            onMove: (point: { x: number; y: number }, title: string) => {
              sourceRef.current = dragTarget;
              moveThreadContextDrag(point, { title, count: 1, pane: true });
            },
            onDrop: (point: { x: number; y: number }) => {
              sourceRef.current = dragTarget;
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
                  : bounds[index]),
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
                  className={cn(
                    "relative z-10 flex h-7 shrink-0 items-center border-b border-border bg-muted/20 [-webkit-app-region:no-drag]",
                    dropZone?.mode === "tab" &&
                      dropZone.index === index &&
                      "bg-primary/15 ring-1 ring-inset ring-primary/50",
                  )}
                >
                  <div
                    role="tablist"
                    aria-label={`Chats in pane ${index + 1}`}
                    className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden px-0.5 [scrollbar-width:none]"
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
                            onClose:
                              tabs.length > 1 ? () => close(threadTargetKey(tab), true) : undefined,
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
                            className="mx-0.5 h-5 w-0.5 shrink-0 bg-foreground/45"
                          />
                        ) : null}
                      </Fragment>
                    ))}
                  </div>
                  {tabs.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Close active chat tab"
                      onClick={() => close(activeTabKey, true)}
                    >
                      <X />
                    </Button>
                  ) : null}
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
                        {count === 4 ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={
                                    columns
                                      ? "Resize rows independently"
                                      : "Resize columns independently"
                                  }
                                  onClick={() =>
                                    store.setResizeLayout(columns ? "rows" : "columns")
                                  }
                                >
                                  {columns ? <Rows2 /> : <Columns2 />}
                                </Button>
                              }
                            />
                            <TooltipPopup>
                              {columns
                                ? "Resize rows independently"
                                : "Resize columns independently"}
                            </TooltipPopup>
                          </Tooltip>
                        ) : null}
                        {count > 1 ? (
                          <>
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
                                {maximized === index
                                  ? "Restore split layout"
                                  : "Maximize this chat"}
                              </TooltipPopup>
                            </Tooltip>
                            {tabs.length === 1 ? (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Close chat pane"
                                onClick={() => close(activeTabKey)}
                              >
                                <X />
                              </Button>
                            ) : null}
                          </>
                        ) : null}
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
        {maximized !== null || count < 2 ? null : count === 2 ? (
          divider("--split-x", "vertical", horizontalRatio, store.setHorizontalRatio, {
            left: x,
            top: 0,
            height: "100%",
          })
        ) : columns ? (
          <>
            {divider("--split-x", "vertical", horizontalRatio, store.setHorizontalRatio, {
              left: x,
              top: 0,
              height: "100%",
            })}
            {divider("--split-y", "horizontal", verticalRatio, store.setVerticalRatio, {
              left: 0,
              top: y,
              width: x,
            })}
            {divider("--split-right-y", "horizontal", rightColumnRatio, store.setRightColumnRatio, {
              left: x,
              top: rightY,
              width: remaining(x),
            })}
          </>
        ) : (
          <>
            {divider("--split-y", "horizontal", verticalRatio, store.setVerticalRatio, {
              left: 0,
              top: y,
              width: "100%",
            })}
            {count < 5
              ? divider("--split-top-x", "vertical", topRowRatio, store.setTopRowRatio, {
                  left: topX,
                  top: 0,
                  height: y,
                })
              : null}
            {count === 4
              ? divider("--split-bottom-x", "vertical", bottomRowRatio, store.setBottomRowRatio, {
                  left: bottomX,
                  top: y,
                  height: remaining(y),
                })
              : null}
          </>
        )}
        {dropZone && dropZone.mode !== "tab" ? (
          <div
            key={`${dropZone.mode}:${dropZone.index}`}
            aria-hidden="true"
            data-split-drop-preview
            className="pointer-events-none absolute z-40 flex items-center justify-center rounded-lg border-2 border-primary/50 bg-primary/10 p-4"
            style={{
              ...(dropZone.mode === "blocked"
                ? { inset: 4 }
                : (dropZone.mode === "swap" ? bounds : layoutBounds(count + 1))[dropZone.index]),
              animationDuration: animations.active
                ? `${Math.min(animations.durationMs, 120)}ms`
                : "0ms",
            }}
          >
            <span className="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm">
              {dropZone.mode === "blocked"
                ? `Open up to ${MAX_SPLIT_CHATS} panes. Drag one chat at a time.`
                : dropZone.mode === "swap"
                  ? "Swap chats"
                  : "Open chat here"}
            </span>
          </div>
        ) : null}
      </div>
    </SidebarInset>
  );
});
