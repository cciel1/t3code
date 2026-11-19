import { memo, type CSSProperties, useRef } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { useResizeDrag } from "../../hooks/useResizeDrag";
import { cn } from "../../lib/utils";

interface SplitResizeDividerProps {
  readonly orientation: "vertical" | "horizontal";
  readonly containerRef: React.RefObject<HTMLElement | null>;
  readonly property: string;
  readonly ratio: number;
  readonly onResize: (ratio: number) => void;
  readonly style: CSSProperties;
  readonly minRatio?: number;
  readonly maxRatio?: number;
  readonly defaultRatio?: number;
}

export const SplitResizeDivider = memo(function SplitResizeDivider({
  orientation,
  containerRef,
  property,
  ratio,
  onResize,
  style,
  minRatio,
  maxRatio,
  defaultRatio = 0.5,
}: SplitResizeDividerProps) {
  const vertical = orientation === "vertical";
  const handleRef = useRef<HTMLDivElement | null>(null);
  const readBounds = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    const size = (vertical ? rect?.width : rect?.height) ?? 0;
    const baseMin = size > 0 ? Math.min(0.4, Math.max(0.15, (vertical ? 240 : 140) / size)) : 0.15;
    const min = minRatio !== undefined ? Math.max(0.1, minRatio) : baseMin;
    const max = maxRatio !== undefined ? Math.min(0.9, maxRatio) : 1 - baseMin;
    return min <= max ? { min, max } : { min: ratio, max: ratio };
  };
  const drag = useResizeDrag<HTMLDivElement>(() => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const size = vertical ? rect.width : rect.height;
    if (size <= 0) return null;
    const start = ratio;
    container.setAttribute("data-split-resizing", "");
    return {
      axis: vertical ? "x" : "y",
      width: start * size,
      edge: "right",
      bounds: { min: readBounds().min * size, max: readBounds().max * size },
      resize(value) {
        container.style.setProperty(property, `${(value / size) * 100}%`);
        handleRef.current?.setAttribute("aria-valuenow", String(Math.round((value / size) * 100)));
        return value;
      },
      finish(value, moved) {
        if (moved) {
          onResize(value / size);
          return;
        }
        container.style.setProperty(property, `${start * 100}%`);
        handleRef.current?.setAttribute("aria-valuenow", String(Math.round(start * 100)));
      },
      cleanup(committed) {
        container.removeAttribute("data-split-resizing");
        if (!committed) container.style.setProperty(property, `${start * 100}%`);
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
      aria-valuemin={Math.round((minRatio ?? 0.15) * 100)}
      aria-valuemax={Math.round((maxRatio ?? 0.85) * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      onLostPointerCapture={drag.onLostPointerCapture}
      onDoubleClick={() => onResize(defaultRatio)}
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
              : ratio + (event.key === previous ? -0.02 : 0.02);
        onResize(Math.max(bounds.min, Math.min(bounds.max, value)));
      }}
      style={style}
      className={cn(
        "group absolute z-30 touch-none select-none outline-none",
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
            ? "inset-y-1 left-1/2 w-px -translate-x-1/2"
            : "inset-x-1 top-1/2 h-px -translate-y-1/2",
        )}
      />
    </div>
  );
});
