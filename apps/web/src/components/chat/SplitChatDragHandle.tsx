import { GripVertical } from "lucide-react";
import { useRef } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { Button } from "../ui/button";
import { useQuietThreadShell } from "../../state/entities";
import type { ThreadRouteTarget } from "../../threadRoutes";

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

  return (
    <Button
      ref={handleRef}
      variant={tab?.selected ? "secondary" : "ghost"}
      size={tab ? "xs" : "icon-xs"}
      role={tab ? "tab" : undefined}
      id={tab?.id}
      aria-controls={tab?.panelId}
      data-split-chat-tab={tab?.key}
      aria-selected={tab?.selected}
      tabIndex={tab ? (tab.selected ? 0 : -1) : undefined}
      aria-label={tab ? title : "Drag chat to rearrange"}
      title={tab ? title : "Drag chat to rearrange. Use the arrow keys to move it."}
      className={tab ? "h-6 max-w-48 shrink-0 cursor-grab" : undefined}
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
      {tab ? <span className="truncate">{title}</span> : <GripVertical />}
    </Button>
  );
}
