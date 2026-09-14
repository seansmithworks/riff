"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const VIEWPORT_MARGIN = 8;

// Shared in-app tooltip: replaces native `title` (which a Chromium-based
// non-stock browser can place relative to the viewport instead of the
// trigger — see ORCHESTRATOR.md gotchas). Renders positioned relative to its
// trigger via `position: absolute` on a `relative` wrapper, so it's always
// beside the button regardless of browser shell. `side` picks which edge of
// the trigger it opens toward — "top" for the bottom-anchored voice bar,
// "bottom" for the top-anchored header.
export function Tooltip({
  label,
  side,
  children,
}: {
  label: string;
  side: "top" | "bottom";
  children: React.ReactElement<{
    "aria-describedby"?: string;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const showTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipId = useId();

  // Pure CSS centering (`left-1/2 -translate-x-1/2`) can push the tooltip
  // past the viewport edge for triggers near the left/right edge (e.g. the
  // header pill). Once open, measure and add a corrective horizontal shift
  // on top of the centering transform so the tooltip always stays within an
  // 8px margin, on either edge.
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const tooltipRect = tooltipRef.current?.getBoundingClientRect();
    if (!wrapperRect || !tooltipRect) return;

    const center = wrapperRect.left + wrapperRect.width / 2;
    const left = center - tooltipRect.width / 2;
    const right = center + tooltipRect.width / 2;
    const viewportWidth = window.innerWidth;

    let correction = 0;
    if (left < VIEWPORT_MARGIN) {
      correction = VIEWPORT_MARGIN - left;
    } else if (right > viewportWidth - VIEWPORT_MARGIN) {
      correction = viewportWidth - VIEWPORT_MARGIN - right;
    }
    setShift(correction);
  }, [open, label]);

  function clearShowTimeout() {
    if (showTimeout.current) {
      clearTimeout(showTimeout.current);
      showTimeout.current = null;
    }
  }

  function showDelayed() {
    clearShowTimeout();
    showTimeout.current = setTimeout(() => setOpen(true), 300);
  }

  function showNow() {
    clearShowTimeout();
    setOpen(true);
  }

  function hide() {
    clearShowTimeout();
    setOpen(false);
  }

  const trigger = isValidElement(children)
    ? cloneElement(children, {
        "aria-describedby": tooltipId,
        onPointerEnter: (e: React.PointerEvent) => {
          if (e.pointerType === "touch") return;
          showDelayed();
        },
        onPointerLeave: hide,
        onFocus: showNow,
        onBlur: hide,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Escape") hide();
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    : children;

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      {trigger}
      <div
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
        className={`pointer-events-none absolute left-1/2 z-30 w-max rounded-lg border border-zinc-200 bg-white/95 px-2 py-1 text-[13px]/[16px] text-zinc-700 shadow-lg backdrop-blur-sm transition-opacity duration-150 ease-out motion-reduce:transition-none ${
          side === "top" ? "bottom-full mb-2" : "top-full mt-2"
        } ${open ? "opacity-100" : "opacity-0"}`}
      >
        {label}
      </div>
    </div>
  );
}
