import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

interface PaneSplitterProps {
  label: string;
  width: number;
  min: number;
  max: number;
  defaultValue: number;
  /** true 表示被调整的面板在把手右侧：向右拖动应缩小它。 */
  invert?: boolean;
  onChange: (width: number) => void;
}

/** 左右拖拽分隔条；键盘方向键微调，双击恢复默认宽度。 */
export function PaneSplitter({
  label,
  width,
  min,
  max,
  defaultValue,
  invert = false,
  onChange,
}: PaneSplitterProps) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) {
      return;
    }
    const delta = event.clientX - state.startX;
    onChange(clamp(state.startWidth + (invert ? -delta : delta)));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) {
      return;
    }
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const step = (event.shiftKey ? 40 : 12) * (event.key === "ArrowRight" ? 1 : -1);
    onChange(clamp(width + (invert ? -step : step)));
  };

  return (
    <div
      className={dragging ? "pane-splitter dragging" : "pane-splitter"}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(clamp(defaultValue))}
    />
  );
}
