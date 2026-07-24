"use client";

// Ghost/skeleton states shown while an artifact is generating ("thinking").
// Kept visually in the same family as the real wireframe kit (white paper
// frames, zinc-200 placeholder fill) so the transition into real content
// feels like a reveal, not a swap. `motion-safe:` gates the pulse so
// prefers-reduced-motion users get a static (still legible) placeholder.

const FRAME_WIDTH = 340;
const FRAME_HEIGHT = 640;

function GhostBar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-md bg-[#e4e4e7] motion-safe:animate-pulse ${className}`}
    />
  );
}

function GhostPhoneFrame() {
  return (
    <div className="flex shrink-0 flex-col items-center gap-3">
      <div className="h-3 w-16 rounded-full bg-zinc-300 motion-safe:animate-pulse" />
      <div
        className="flex flex-col gap-3 overflow-hidden rounded-[28px] border border-zinc-300 bg-white p-4 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)]"
        style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT }}
      >
        <GhostBar className="h-8 w-full" />
        <GhostBar className="h-36 w-full" />
        <GhostBar className="h-4 w-3/4" />
        <GhostBar className="h-4 w-1/2" />
        <GhostBar className="h-20 w-full" />
        <GhostBar className="mt-auto h-10 w-full !rounded-full" />
      </div>
    </div>
  );
}

// Shown for the first generation, before any artifact exists — we don't yet
// know if a wireframe or flow is coming, so this defaults to the wireframe
// ghost frames (the common case for this app).
export function WireframeSkeleton() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 overflow-hidden px-8">
      <div className="flex items-center gap-24">
        <GhostPhoneFrame />
        <GhostPhoneFrame />
        <GhostPhoneFrame />
      </div>
      <p className="text-sm text-zinc-500">Sketching&hellip;</p>
    </div>
  );
}

// Overlaid on top of an existing artifact during a subsequent generation —
// the artifact underneath stays fully visible; this is just a non-blocking
// signal that new work is in progress.
export function GeneratingIndicator() {
  return (
    <div className="pointer-events-none absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-zinc-200 bg-white/90 px-4 py-1.5 shadow-lg backdrop-blur-sm">
      <span className="flex items-center gap-2 text-xs font-medium text-zinc-600">
        <span className="h-1.5 w-1.5 rounded-full bg-[#3FBA6A] motion-safe:animate-pulse" />
        Sketching&hellip;
      </span>
    </div>
  );
}
