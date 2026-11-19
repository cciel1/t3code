import { describe, expect, it, beforeEach } from "vite-plus/test";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { type DraftId, useComposerDraftStore } from "./composerDraftStore";
import { useSplitChatStore } from "./splitChatStore";
import type { ThreadRouteTarget } from "./threadRoutes";

describe("splitChatStore", () => {
  const thread2: ThreadRouteTarget = {
    kind: "server",
    threadRef: scopeThreadRef("env-1" as EnvironmentId, "thread-2" as ThreadId),
  };
  const thread3: ThreadRouteTarget = {
    kind: "server",
    threadRef: scopeThreadRef("env-1" as EnvironmentId, "thread-3" as ThreadId),
  };
  const thread4: ThreadRouteTarget = {
    kind: "server",
    threadRef: scopeThreadRef("env-1" as EnvironmentId, "thread-4" as ThreadId),
  };
  const thread5: ThreadRouteTarget = {
    kind: "server",
    threadRef: scopeThreadRef("env-1" as EnvironmentId, "thread-5" as ThreadId),
  };

  beforeEach(() => {
    useSplitChatStore.setState(useSplitChatStore.getInitialState(), true);
  });

  it("starts with empty secondary panes and default ratios", () => {
    const state = useSplitChatStore.getState();
    expect(state.secondaryPanes).toHaveLength(0);
    expect(state.activePaneIndex).toBe(0);
    expect(state.horizontalRatio).toBe(0.5);
    expect(state.verticalRatio).toBe(0.5);
    expect(state.topRowRatio).toBe(0.5);
  });

  it("opens a secondary pane to the side and sets active index", () => {
    const success = useSplitChatStore.getState().openToSide(thread2);
    expect(success).toBe(true);

    const state = useSplitChatStore.getState();
    expect(state.secondaryPanes).toHaveLength(1);
    expect(state.secondaryPanes[0]).toEqual(thread2);
    expect(state.activePaneIndex).toBe(1);
  });

  it("focuses an existing pane instead of duplicating it", () => {
    useSplitChatStore.getState().openToSide(thread2);
    useSplitChatStore.getState().openToSide(thread3);
    expect(useSplitChatStore.getState().secondaryPanes).toHaveLength(2);

    const success = useSplitChatStore.getState().openToSide(thread2);
    expect(success).toBe(true);
    expect(useSplitChatStore.getState().secondaryPanes).toHaveLength(2);
    expect(useSplitChatStore.getState().activePaneIndex).toBe(1);

    expect(useSplitChatStore.getState().openToSide(thread3, thread3)).toBe(true);
    expect(useSplitChatStore.getState().secondaryPanes).toHaveLength(2);
    expect(useSplitChatStore.getState().activePaneIndex).toBe(0);

    useComposerDraftStore.setState({ promotedDraftRedirects: { "draft-4": thread4.threadRef } });
    useSplitChatStore.getState().openToSide({ kind: "draft", draftId: "draft-4" as DraftId });
    expect(useSplitChatStore.getState().openToSide(thread4)).toBe(true);
    expect(useSplitChatStore.getState().secondaryPanes).toHaveLength(3);
    expect(useSplitChatStore.getState().activePaneIndex).toBe(3);
  });

  it("opens six chats including the primary and rejects a seventh", () => {
    const store = useSplitChatStore.getState();
    const additionalThread = (number: number): ThreadRouteTarget => ({
      kind: "server",
      threadRef: scopeThreadRef("env-1" as EnvironmentId, `thread-${number}` as ThreadId),
    });
    for (const thread of [thread2, thread3, thread4, thread5, additionalThread(6)]) {
      expect(store.openToSide(thread)).toBe(true);
    }
    expect(store.openToSide(additionalThread(7))).toBe(false);
    expect(useSplitChatStore.getState().secondaryPanes).toHaveLength(5);
  });

  it("opens a new chat in the focused pane and reuses its existing tabs", () => {
    const store = useSplitChatStore.getState();
    expect(store.openInTab(thread3, thread2)).toBe(false);
    expect(store.openToSide(thread3, thread2)).toBe(true);
    expect(store.openInTab(thread4, thread2)).toBe(true);
    expect(useSplitChatStore.getState()).toMatchObject({
      secondaryPanes: [thread4],
      activePaneIndex: 1,
      tabGroups: [[thread3, thread4]],
    });
    expect(store.openInTab(thread3, thread2)).toBe(true);
    expect(useSplitChatStore.getState().secondaryPanes).toEqual([thread3]);
    expect(store.openToSide(thread4, thread2)).toBe(true);
    expect(useSplitChatStore.getState().secondaryPanes).toEqual([thread4]);
  });

  it("keeps the primary tab group when the caller navigates to a new draft", () => {
    const store = useSplitChatStore.getState();
    const draft: ThreadRouteTarget = { kind: "draft", draftId: "new-draft" as DraftId };
    store.openToSide(thread3, thread2);
    store.setActivePane(0);
    expect(store.openInTab(draft, thread2)).toBe(false);
    expect(useSplitChatStore.getState()).toMatchObject({
      secondaryPanes: [thread3],
      activePaneIndex: 0,
      tabGroups: [[thread2, draft]],
    });
    expect(store.openInTab(thread2, draft)).toBe(false);
    expect(useSplitChatStore.getState().tabGroups).toEqual([[thread2, draft]]);
  });

  it("resizes each row and column independently", () => {
    const store = useSplitChatStore.getState();
    store.setTopRowRatio(0.3);
    store.setBottomRowRatio(0.7);
    store.setVerticalRatio(0.4);
    store.setRightColumnRatio(0.65);
    expect(useSplitChatStore.getState()).toMatchObject({
      topRowRatio: 0.3,
      bottomRowRatio: 0.7,
      verticalRatio: 0.4,
      rightColumnRatio: 0.65,
    });
  });

  it("clamps resize ratios between 0.15 and 0.85", () => {
    useSplitChatStore.getState().setHorizontalRatio(0.05);
    expect(useSplitChatStore.getState().horizontalRatio).toBe(0.15);

    useSplitChatStore.getState().setHorizontalRatio(0.95);
    expect(useSplitChatStore.getState().horizontalRatio).toBe(0.85);

    useSplitChatStore.getState().setHorizontalRatio(0.6);
    expect(useSplitChatStore.getState().horizontalRatio).toBe(0.6);
  });
  it("restores resize preferences without reopening panes from an earlier launch", () => {
    const merge = useSplitChatStore.persist.getOptions().merge!;
    const restored = merge(
      {
        secondaryPanes: [thread2, thread3],
        activePaneIndex: 2,
        horizontalRatio: 0.6,
        verticalRatio: Number.NaN,
        topRowRatio: 2,
        resizeLayout: "columns",
      },
      useSplitChatStore.getInitialState(),
    );
    expect(restored.secondaryPanes).toEqual([]);
    expect(restored.activePaneIndex).toBe(0);
    expect(restored.horizontalRatio).toBe(0.6);
    expect(restored.verticalRatio).toBe(0.5);
    expect(restored.topRowRatio).toBe(0.85);
    expect(restored.resizeLayout).toBe("columns");
  });

  it("clamps and persists three-column split ratios for 5- and 6-pane layouts", () => {
    const store = useSplitChatStore.getState();
    store.setTopRowTripleRatios([0.25, 0.7]);
    store.setBottomRowTripleRatios([0.05, 0.99]);
    expect(useSplitChatStore.getState().topRowTripleRatios).toEqual([0.25, 0.7]);
    expect(useSplitChatStore.getState().bottomRowTripleRatios).toEqual([0.15, 0.85]);

    store.setTopRowTripleRatios([0.6, 0.65]);
    expect(useSplitChatStore.getState().topRowTripleRatios).toEqual([0.6, 0.75]);

    const merge = useSplitChatStore.persist.getOptions().merge!;
    const restored = merge(
      {
        topRowTripleRatios: [0.3, 0.68],
        bottomRowTripleRatios: [0.2, 0.22],
      },
      useSplitChatStore.getInitialState(),
    );
    expect(restored.topRowTripleRatios).toEqual([0.3, 0.68]);
    expect(restored.bottomRowTripleRatios).toEqual([0.2, 0.35]);
  });
});
