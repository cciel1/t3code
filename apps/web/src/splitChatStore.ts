import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useComposerDraftStore } from "./composerDraftStore";
import { isAuxiliaryChatWindow } from "./lib/chatWindow";
import { resolveStorage } from "./lib/storage";
import type { ThreadRouteTarget } from "./threadRoutes";

export const MAX_SPLIT_CHATS = 6;

interface SplitChatPersisted {
  readonly horizontalRatio: number;
  readonly verticalRatio: number;
  readonly topRowRatio: number;
  readonly bottomRowRatio: number;
  readonly rightColumnRatio: number;
  readonly resizeLayout: "rows" | "columns";
}

export function threadTargetKey(target: ThreadRouteTarget | null | undefined): string {
  if (!target) return "";
  if (target.kind === "server") return scopedThreadKey(target.threadRef);
  // A promoted draft pane shows its server thread, so it dedupes as that thread.
  const promoted = useComposerDraftStore.getState().getPromotedDraftRedirect(target.draftId);
  return promoted ? scopedThreadKey(promoted) : `draft:${target.draftId}`;
}

export type SplitChatTabGroups = readonly (readonly ThreadRouteTarget[])[];

export function tabsForPane(groups: SplitChatTabGroups, target: ThreadRouteTarget) {
  const key = threadTargetKey(target);
  return groups.find((tabs) => tabs.some((tab) => threadTargetKey(tab) === key)) ?? [target];
}

interface SplitChatState {
  readonly tabGroups: SplitChatTabGroups;
  readonly secondaryPanes: readonly ThreadRouteTarget[];
  readonly activePaneIndex: number;

  readonly horizontalRatio: number;
  readonly verticalRatio: number;
  readonly topRowRatio: number;
  readonly bottomRowRatio: number;
  readonly rightColumnRatio: number;
  readonly resizeLayout: "rows" | "columns";

  // Returns true when the caller can skip navigation because the pane already displays the target.
  readonly openInTab: (target: ThreadRouteTarget, primary: ThreadRouteTarget | null) => boolean;
  readonly openToSide: (target: ThreadRouteTarget, primary?: ThreadRouteTarget | null) => boolean;
  readonly replaceSecondaryPanes: (
    panes: readonly ThreadRouteTarget[],
    activeIndex: number,
    tabGroups?: SplitChatTabGroups,
  ) => void;
  readonly setActivePane: (index: number) => void;
  readonly setHorizontalRatio: (ratio: number) => void;
  readonly setVerticalRatio: (ratio: number) => void;
  readonly setTopRowRatio: (ratio: number) => void;
  readonly setBottomRowRatio: (ratio: number) => void;
  readonly setRightColumnRatio: (ratio: number) => void;
  readonly setResizeLayout: (layout: "rows" | "columns") => void;
}

const DEFAULT_RATIO = 0.5;
const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

function clampRatio(val: number): number {
  if (!Number.isFinite(val)) return DEFAULT_RATIO;
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, val));
}

export const useSplitChatStore = create<SplitChatState>()(
  persist(
    (set, get) => ({
      secondaryPanes: [],
      tabGroups: [],
      activePaneIndex: 0,
      horizontalRatio: DEFAULT_RATIO,
      verticalRatio: DEFAULT_RATIO,
      topRowRatio: DEFAULT_RATIO,
      bottomRowRatio: DEFAULT_RATIO,
      rightColumnRatio: DEFAULT_RATIO,
      resizeLayout: "rows",

      openInTab: (target, primary) => {
        const state = get();
        if (!primary || (!state.secondaryPanes.length && !state.tabGroups.length)) return false;
        const key = threadTargetKey(target);
        const primaryTabs = tabsForPane(state.tabGroups, primary);
        if (!state.secondaryPanes.length && primaryTabs.length === 1) return false;
        const panes = [primary, ...state.secondaryPanes];
        const existing = panes.findIndex((pane) =>
          tabsForPane(state.tabGroups, pane).some((tab) => threadTargetKey(tab) === key),
        );
        const index = existing < 0 ? Math.min(state.activePaneIndex, panes.length - 1) : existing;
        const pane = panes[index]!;
        let tabGroups = state.tabGroups;
        if (existing < 0) {
          const tabs = tabsForPane(tabGroups, pane);
          const previousGroup = tabGroups.find((group) =>
            group.some((tab) => threadTargetKey(tab) === key),
          );
          const previousTabs = previousGroup?.filter((tab) => threadTargetKey(tab) !== key) ?? [];
          tabGroups = [
            ...tabGroups.filter((group) => group !== tabs && group !== previousGroup),
            [...tabs, target],
            ...(previousTabs.length > 1 ? [previousTabs] : []),
          ];
        }
        if (index === 0) {
          set({ activePaneIndex: index, tabGroups });
          return key === threadTargetKey(primary);
        }
        const secondaryPanes = [...state.secondaryPanes];
        if (threadTargetKey(secondaryPanes[index - 1]) !== key) {
          secondaryPanes[index - 1] = target;
        }
        set({ secondaryPanes, activePaneIndex: index, tabGroups });
        return true;
      },

      openToSide: (target, primary) => {
        const state = get();
        const targetKey = threadTargetKey(target);
        if (!targetKey) return false;
        if (
          primary &&
          tabsForPane(state.tabGroups, primary).some((tab) => threadTargetKey(tab) === targetKey)
        ) {
          set({ activePaneIndex: 0 });
          return true;
        }

        const existingIndex = state.secondaryPanes.findIndex((pane) =>
          tabsForPane(state.tabGroups, pane).some((tab) => threadTargetKey(tab) === targetKey),
        );
        if (existingIndex !== -1) {
          const panes = [...state.secondaryPanes];
          if (threadTargetKey(panes[existingIndex]) !== targetKey) panes[existingIndex] = target;
          set({ secondaryPanes: panes, activePaneIndex: existingIndex + 1 });
          return true;
        }

        if (state.secondaryPanes.length >= MAX_SPLIT_CHATS - 1) {
          return false;
        }

        const newPanes = [...state.secondaryPanes, target];
        set({
          secondaryPanes: newPanes,
          activePaneIndex: newPanes.length,
        });
        return true;
      },

      replaceSecondaryPanes: (secondaryPanes, activePaneIndex, tabGroups = get().tabGroups) => {
        set({
          secondaryPanes: secondaryPanes.slice(0, MAX_SPLIT_CHATS - 1),
          activePaneIndex,
          tabGroups,
        });
      },

      setActivePane: (index: number) => {
        if (get().activePaneIndex !== index) set({ activePaneIndex: index });
      },

      setHorizontalRatio: (ratio: number) => {
        set({ horizontalRatio: clampRatio(ratio) });
      },

      setVerticalRatio: (ratio: number) => {
        set({ verticalRatio: clampRatio(ratio) });
      },

      setTopRowRatio: (ratio: number) => {
        set({ topRowRatio: clampRatio(ratio) });
      },

      setBottomRowRatio: (ratio: number) => {
        set({ bottomRowRatio: clampRatio(ratio) });
      },

      setRightColumnRatio: (ratio) => set({ rightColumnRatio: clampRatio(ratio) }),
      setResizeLayout: (resizeLayout) => set({ resizeLayout }),
    }),
    {
      name: "t3code:split-chat:v1",
      storage: createJSONStorage(() =>
        resolveStorage(
          typeof window !== "undefined" && !isAuxiliaryChatWindow()
            ? window.localStorage
            : undefined,
        ),
      ),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SplitChatPersisted>;
        return {
          ...current,
          horizontalRatio: clampRatio(saved.horizontalRatio ?? DEFAULT_RATIO),
          verticalRatio: clampRatio(saved.verticalRatio ?? DEFAULT_RATIO),
          topRowRatio: clampRatio(saved.topRowRatio ?? DEFAULT_RATIO),
          bottomRowRatio: clampRatio(saved.bottomRowRatio ?? DEFAULT_RATIO),
          rightColumnRatio: clampRatio(saved.rightColumnRatio ?? DEFAULT_RATIO),
          resizeLayout: saved.resizeLayout === "columns" ? "columns" : "rows",
        };
      },
      partialize: (state): SplitChatPersisted => ({
        horizontalRatio: state.horizontalRatio,
        verticalRatio: state.verticalRatio,
        topRowRatio: state.topRowRatio,
        bottomRowRatio: state.bottomRowRatio,
        rightColumnRatio: state.rightColumnRatio,
        resizeLayout: state.resizeLayout,
      }),
    },
  ),
);
