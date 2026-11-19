import { memo, type CSSProperties, useRef } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { useResizeDrag } from "../../hooks/useResizeDrag";
import { cn } from "../../lib/utils";
import type { NormalizedRect } from "../../splitChatLayout";

const FULL_BRANCH_RECT: NormalizedRect = { left: 0, top: 0, width: 1, height: 1 };

interface SplitResizeDividerProps {
  readonly orientation: "vertical" | "horizontal";
  readonly containerRef: React.RefObject<HTMLElement | null>;
  readonly property?: string;
  readonly branchRect?: NormalizedRect;
  readonly ratio?: number;
  readonly position?: number;
  readonly minPosition?: number;
  readonly maxPosition?: number;
  readonly defaultPosition?: number;
  readonly onResize?: (position: number) => void;
  readonly onPreview?: (position: number) => void;
  readonly onCommit?: (position: number) => void;
  readonly onCancel?: () => void;
  readonly style: CSSProperties;
}

export const SplitResizeDivider = memo(function SplitResizeDivider({
  orientation,
  containerRef,
  property,
  branchRect = FULL_BRANCH_RECT,
  ratio,
  position,
  minPosition,
  maxPosition,
  defaultPosition = 0.5,
  onResize,
  onPreview,
  onCommit,
  onCancel,
  style,
}: SplitResizeDividerProps) {
  const vertical = orientation === "vertical";
  const currentPosition = position ?? ratio ?? 0.5;
  const handleRef = useRef<HTMLDivElement | null>(null);

  const commit = (value: number) => {
    onCommit?.(value);
    onResize?.(value);
  };

  const readBranchSize = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return vertical ? rect.width * branchRect.width : rect.height * branchRect.height;
  };

  const readBounds = () => {
    const size = readBranchSize();
    const fallbackMin =
      size > 0 ? Math.min(0.4, Math.max(0.15, (vertical ? 240 : 140) / size)) : 0.15;
    const rawMin = minPosition ?? fallbackMin;
    const rawMax = maxPosition ?? 1 - fallbackMin;
    return {
      min: Math.min(rawMin, rawMax),
      max: Math.max(rawMin, rawMax),
    };
  };

  const drag = useResizeDrag<HTMLDivElement>(() => {
    const container = containerRef.current;
    if (!container) return null;
    const size = readBranchSize();
    if (size <= 0) return null;
    const start = currentPosition;
    const bounds = readBounds();
    container.setAttribute("data-split-resizing", "");
    return {
      axis: vertical ? "x" : "y",
      width: start * size,
      edge: "right",
      bounds: { min: bounds.min * size, max: bounds.max * size },
      resize(value) {
        const nextPos = value / size;
        if (property) container.style.setProperty(property, `${nextPos * 100}%`);
        onPreview?.(nextPos);
        handleRef.current?.setAttribute("aria-valuenow", String(Math.round(nextPos * 100)));
        return value;
      },
      finish(value, moved) {
        if (moved) {
          commit(value / size);
          return;
        }
        if (property) container.style.setProperty(property, `${start * 100}%`);
        onCancel?.();
        handleRef.current?.setAttribute("aria-valuenow", String(Math.round(start * 100)));
      },
      cleanup(committed) {
        container.removeAttribute("data-split-resizing");
        if (!committed) {
          if (property) container.style.setProperty(property, `${start * 100}%`);
          onCancel?.();
        }
      },
    };
  });

  const attach = useStableCallback((node: HTMLDivElement | null) => {
    handleRef.current = node;
    return drag.ref(node);
  });

  return (
    <div
      ref={attach}
      role="separator"
      aria-orientation={orientation}
      aria-label={vertical ? "Resize chat columns" : "Resize chat rows"}
      aria-valuemin={Math.round((minPosition ?? 0.15) * 100)}
      aria-valuemax={Math.round((maxPosition ?? 0.85) * 100)}
      aria-valuenow={Math.round(currentPosition * 100)}
      tabIndex={0}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      onLostPointerCapture={drag.onLostPointerCapture}
      onDoubleClick={() => commit(defaultPosition)}
      onKeyDown={(event) => {
        const previous = vertical ? "ArrowLeft" : "ArrowUp";
        const next = vertical ? "ArrowRight" : "ArrowDown";
        if (![previous, next, "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = readBounds();
        const value =
          event.key === "Home"
            ? bounds.min
            : event.key === "End"
              ? bounds.max
              : currentPosition + (event.key === previous ? -0.02 : 0.02);
        commit(Math.max(bounds.min, Math.min(bounds.max, value)));
      }}
      style={style}
      className={cn(
        "group absolute z-30 touch-none select-none outline-none [-webkit-app-region:no-drag]",
        vertical
          ? "w-2 -translate-x-1/2 cursor-col-resize"
          : "h-2 -translate-y-1/2 cursor-row-resize",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute rounded-full bg-transparent transition-colors duration-150 group-hover:bg-primary/50 group-focus-visible:bg-primary/70 group-active:bg-primary/70 motion-reduce:transition-none",
          vertical
            ? "inset-y-1 left-1/2 w-0.5 -translate-x-1/2"
            : "inset-x-1 top-1/2 h-0.5 -translate-y-1/2",
        )}
      />
    </div>
  );
});
