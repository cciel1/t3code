import {
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";

import { useLayoutEffect, useState } from "react";

import { readSplitWorkspace } from "../splitChatWorkspaceStorage";
import { threadTargetKey, useSplitChatStore } from "../splitChatStore";
import { SplitChatWorkspace } from "../components/chat/SplitChatWorkspace";
import { isAppModalPage } from "../components/sidebar/mainAppLocation";
import { SidebarInset } from "../components/ui/sidebar";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import { retainThreadFindForRoute } from "../components/chat/threadFindStore";
import { ThreadLinkPrompt } from "../components/promptLinks/ThreadLinkPrompt";
import { useShownThreadRouteTarget } from "../hooks/useShownThreadRouteTarget";

function ChatRouteLayout() {
  // Render both routes here so draft promotion keeps the same ChatView mounted.
  const { shownTarget, modalOpen } = useShownThreadRouteTarget();
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const [restore, setRestore] = useState(() => {
    const saved = readSplitWorkspace();
    if (
      !saved ||
      modalOpen ||
      (shownTarget
        ? threadTargetKey(shownTarget) !== threadTargetKey(saved.primary)
        : pathname !== "/")
    )
      return null;
    return saved;
  });
  const [maximized, setMaximized] = useState(restore?.maximizedIndex ?? null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hydrates the saved layout before mounting its panes
  useLayoutEffect(() => {
    if (!restore) return;
    useSplitChatStore
      .getState()
      .replaceSecondaryPanes(restore.secondary, restore.activeIndex, restore.groups);
    if (shownTarget) {
      setRestore(null);
      return;
    }
    const target = restore.primary;
    const open =
      target.kind === "server"
        ? navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(target.threadRef),
            replace: true,
          })
        : navigate({ to: "/draft/$draftId", params: { draftId: target.draftId }, replace: true });
    void open.catch(() => setRestore(null));
  }, [navigate, restore, shownTarget]);
  if (restore) return <SidebarInset className="h-dvh" />;
  return (
    <>
      {shownTarget?.kind === "server" && !modalOpen ? (
        <ThreadLinkPrompt threadRef={shownTarget.threadRef} />
      ) : null}
      {shownTarget ? (
        <SplitChatWorkspace
          primaryTarget={shownTarget}
          modalOpen={modalOpen}
          initialMaximizedPane={maximized}
          onLayoutReady={() => setMaximized(null)}
        />
      ) : modalOpen ? (
        <SidebarInset className="h-dvh" />
      ) : (
        <Outlet />
      )}
      {modalOpen ? <Outlet /> : null}
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    return { appModalPage: isAppModalPage(location.pathname) };
  },
  component: ChatRouteLayout,
  // Every match carries the whole location's params, so this layout sees the thread route's too.
  onEnter: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onStay: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onLeave: () => retainThreadFindForRoute({ modalPage: false, threadRef: null }),
});

function retainThreadFindForRouteMatch(
  modalPage: boolean,
  params: Partial<Record<"environmentId" | "threadId", string>>,
) {
  const target = resolveThreadRouteTarget(params);
  retainThreadFindForRoute({
    modalPage,
    threadRef: target?.kind === "server" ? target.threadRef : null,
  });
}
