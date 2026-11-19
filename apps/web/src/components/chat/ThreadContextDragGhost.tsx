import { ExternalLinkIcon, MessagesSquareIcon } from "lucide-react";
import { createPortal } from "react-dom";

import { cn } from "../../lib/utils";
import { useThreadContextDragGhost } from "./threadContextDrag";

export function ThreadContextDragGhost() {
  const ghost = useThreadContextDragGhost();
  if (ghost === null) return null;
  const x = ghost.detach
    ? Math.max(12, Math.min(window.innerWidth - 240, ghost.x + 12))
    : ghost.x + 12;
  const y = ghost.detach
    ? Math.max(12, Math.min(window.innerHeight - 48, ghost.y + 12))
    : ghost.y + 12;
  return createPortal(
    <div
      aria-hidden="true"
      data-thread-drag-detach={ghost.detach ? "true" : undefined}
      className={cn(
        "pointer-events-none fixed left-0 top-0 z-[100] flex max-w-72 items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg",
        ghost.detach && "border-primary/60 ring-1 ring-primary/40",
      )}
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      {ghost.detach ? (
        <ExternalLinkIcon className="size-4 shrink-0 text-primary" />
      ) : (
        <MessagesSquareIcon className="size-4 shrink-0 text-secondary-label" />
      )}
      <span className="truncate">{ghost.title}</span>
      {ghost.detach ? (
        <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-xs text-primary">
          New window
        </span>
      ) : ghost.count > 1 ? (
        <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs text-secondary-label">
          +{ghost.count - 1}
        </span>
      ) : null}
    </div>,
    document.body,
  );
}
