import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { GripVertical, MessageSquare, X } from "lucide-react";
import { useRef } from "react";

import { cn } from "../../lib/utils";
import { providersIgnoringCheckedAtAtom } from "../../state/server";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { useStableCallback } from "../../hooks/useStableCallback";
import { Button } from "../ui/button";
import { useQuietThreadShell } from "../../state/entities";
import type { ThreadRouteTarget } from "../../threadRoutes";

function ChatTabProvider({
  environmentId,
  instanceId,
}: {
  environmentId: EnvironmentId;
  instanceId: ProviderInstanceId;
}) {
  const providers = useAtomValue(providersIgnoringCheckedAtAtom(environmentId));
  const provider = providers.find((entry) => entry.instanceId === instanceId);
  return provider ? (
    <ProviderInstanceIcon
      driverKind={provider.driver}
      displayName={provider.displayName ?? provider.driver}
      size="compact"
      iconClassName="size-3.5"
    />
  ) : (
    <MessageSquare className="size-3.5 shrink-0" />
  );
}

export function SplitChatDragHandle({
  target,
  onMove,
  onDrop,
  onEnd,
  onMoveByKeyboard,
  tab,
}: {
  readonly target: ThreadRouteTarget;
  readonly onMove: (point: { x: number; y: number }, title: string) => void;
  readonly onDrop: (point: { x: number; y: number }) => void;
  readonly onEnd: () => void;
  readonly onMoveByKeyboard: (direction: number) => void;
  readonly tab?: {
    readonly key: string;
    readonly selected: boolean;
    readonly onSelect: () => void;
    readonly onClose?: (() => void) | undefined;
    readonly id: string;
    readonly panelId: string;
  };
}) {
  const thread = useQuietThreadShell(target.kind === "server" ? target.threadRef : null);
  const title = thread?.title || "New thread";
  const dragged = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const move = useStableCallback(onMove);
  const drop = useStableCallback(onDrop);
  const end = useStableCallback(onEnd);
  const handleRef = useStableCallback((node: HTMLButtonElement | null) => {
    if (node) return () => cleanupRef.current?.();
  });

  const handle = (
    <Button
      ref={handleRef}
      variant="ghost"
      size={tab ? "xs" : "icon-xs"}
      role={tab ? "tab" : undefined}
      id={tab?.id}
      aria-controls={tab?.panelId}
      data-split-chat-tab={tab?.key}
      aria-selected={tab?.selected}
      tabIndex={tab ? (tab.selected ? 0 : -1) : undefined}
      aria-label={tab ? title : "Drag chat to rearrange"}
      title={tab ? title : "Drag chat to rearrange. Use the arrow keys to move it."}
      className={
        tab
          ? "h-full min-w-0 flex-1 cursor-grab [-webkit-app-region:no-drag]"
          : "[-webkit-app-region:no-drag]"
      }
      onClick={(event) => {
        if (tab && (!dragged.current || event.detail === 0)) {
          event.currentTarget.focus({ preventScroll: true });
          tab.onSelect();
        }
        dragged.current = false;
      }}
      onKeyDown={(event) => {
        if (tab && event.key === "Delete" && tab.onClose) {
          event.preventDefault();
          event.stopPropagation();
          tab.onClose();
          return;
        }
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        onMoveByKeyboard(event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || cleanupRef.current) return;
        dragged.current = false;
        if (!tab) event.preventDefault();
        event.stopPropagation();
        const origin = { x: event.clientX, y: event.clientY };
        const pointerId = event.pointerId;
        const handle = event.currentTarget;
        let point = origin;
        let started = false;
        let frame: number | null = null;
        handle.setPointerCapture(pointerId);
        const flush = () => {
          frame = null;
          move(point, title);
        };
        const cleanup = () => {
          cleanupRef.current = null;
          if (frame !== null) cancelAnimationFrame(frame);
          window.removeEventListener("pointermove", pointerMove);
          window.removeEventListener("pointerup", pointerUp);
          window.removeEventListener("pointercancel", cancel);
          window.removeEventListener("blur", cancel);
          window.removeEventListener("keydown", keyDown, true);
          handle.removeEventListener("lostpointercapture", cancel);
          if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
          document.body.style.removeProperty("cursor");
          document.body.style.removeProperty("user-select");
          end();
        };
        const pointerMove = (next: PointerEvent) => {
          if (next.pointerId !== pointerId) return;
          point = { x: next.clientX, y: next.clientY };
          if (!started && Math.hypot(point.x - origin.x, point.y - origin.y) < 6) return;
          started = true;
          dragged.current = true;
          document.body.style.cursor = "grabbing";
          document.body.style.userSelect = "none";
          if (frame === null) frame = requestAnimationFrame(flush);
        };
        const pointerUp = (next: PointerEvent) => {
          if (next.pointerId !== pointerId) return;
          try {
            if (started) drop({ x: next.clientX, y: next.clientY });
          } catch (error) {
            cleanup();
            throw error;
          }
          cleanup();
        };
        const cancel = () => cleanup();
        const keyDown = (next: KeyboardEvent) => {
          if (next.key !== "Escape") return;
          next.preventDefault();
          next.stopPropagation();
          cleanup();
        };
        cleanupRef.current = cleanup;
        window.addEventListener("pointermove", pointerMove);
        window.addEventListener("pointerup", pointerUp);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("blur", cancel);
        window.addEventListener("keydown", keyDown, true);
        handle.addEventListener("lostpointercapture", cancel);
      }}
    >
      {tab ? (
        <>
          <span aria-hidden="true" className="inline-flex shrink-0 items-center">
            {thread ? (
              <ChatTabProvider
                environmentId={thread.environmentId}
                instanceId={thread.providerInstanceId}
              />
            ) : (
              <MessageSquare className="size-3.5 shrink-0" />
            )}
          </span>
          <span className="truncate">{title}</span>
        </>
      ) : (
        <GripVertical />
      )}
    </Button>
  );

  if (!tab) return handle;
  return (
    <div
      role="presentation"
      className={cn(
        "flex h-6 max-w-56 shrink-0 items-center rounded-sm [-webkit-app-region:no-drag]",
        tab.selected ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
      )}
    >
      {handle}
      {tab.onClose ? (
        <button
          type="button"
          aria-label={`Close chat tab ${title}`}
          tabIndex={-1}
          className="mr-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-hidden [-webkit-app-region:no-drag] hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={tab.onClose}
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
