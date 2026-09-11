"use client";

import { useEffect, useId, useRef, useState } from "react";

const STACK = [
  { name: "ElevenLabs Conversational AI", role: "Voice agent" },
  { name: "Fireworks AI (GLM-5.2)", role: "Wireframe generation" },
  { name: "CopilotKit", role: "Text chat rail" },
  { name: "React Flow (xyflow)", role: "Canvas + flow layout" },
  { name: "drawably", role: "Sketch-style rendering" },
  { name: "Daytona", role: "Live sandbox handoff" },
  { name: "Next.js on Vercel", role: "App + hosting" },
];

// Always-visible attribution footnote. Positioned to clear React Flow's
// zoom controls (bottom-left), the mic overlay (bottom-center), and the
// chat button (bottom-right). Hover/focus/tap reveals the tech stack in a
// popover anchored above the trigger.
export function HackathonFootnote() {
  const [open, setOpen] = useState(false);
  const closeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverId = useId();

  function show() {
    if (closeTimeout.current) clearTimeout(closeTimeout.current);
    setOpen(true);
  }

  function hide() {
    setOpen(false);
  }

  function hideDelayed() {
    closeTimeout.current = setTimeout(() => setOpen(false), 100);
  }

  useEffect(() => {
    return () => {
      if (closeTimeout.current) clearTimeout(closeTimeout.current);
    };
  }, []);

  // Touch has no hover/focus-visible equivalent, so it drives its own
  // toggle here. Mouse and keyboard are handled entirely by
  // hover/focus/blur below — deliberately no onClick, since a real click
  // or Enter/Space always fires focus (and, for mouse, mouseenter) first;
  // an onClick toggle on top of that would immediately cancel the open it
  // just caused.
  function handlePointerDown(e: React.PointerEvent) {
    if (e.pointerType === "touch") {
      setOpen((prev) => !prev);
    }
  }

  return (
    <div
      className="fixed bottom-4 left-16 z-20"
      onMouseEnter={show}
      onMouseLeave={hideDelayed}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={popoverId}
        onFocus={show}
        onBlur={hide}
        onPointerDown={handlePointerDown}
        onKeyDown={(e) => {
          if (e.key === "Escape") hide();
        }}
        className="max-w-[220px] cursor-help select-none text-left text-[11px]/[14px] text-[#71717a] underline decoration-dotted underline-offset-2 hover:text-zinc-600 sm:max-w-none sm:whitespace-nowrap"
      >
        Built in a 3-hour hackathon, plus some minor updates.
      </button>

      <div
        id={popoverId}
        role="tooltip"
        onMouseEnter={show}
        onMouseLeave={hideDelayed}
        className={`absolute bottom-full left-0 mb-2 w-[min(400px,calc(100vw-5rem))] origin-bottom-left rounded-lg border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${
          open
            ? "pointer-events-auto scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        <p className="mb-2 text-[11px]/[14px] font-medium tracking-wide text-zinc-400 uppercase">
          Built with
        </p>
        <ul className="space-y-1.5">
          {STACK.map((item) => (
            <li
              key={item.name}
              className="flex items-baseline justify-between gap-3 text-[13px]/[16px]"
            >
              <span className="text-zinc-900">{item.name}</span>
              <span className="shrink-0 text-zinc-500">{item.role}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
