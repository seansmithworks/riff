"use client";

import { useEffect, useRef, useState } from "react";
import { roughLine, roughRoundedRect, roughEllipse } from "drawably";

// One-line flips for the hand-drawn look. See CreativeConvos/ORCHESTRATOR.md
// "fidelity line" — surface stays honest, structure stays real.
export const SKETCH_ROUGHNESS = 1.2;
export const SKETCH_STROKE_WIDTH = 1.5;
export const SKETCH_HAND_FONT = true;

// Deterministic 32-bit string hash (djb2 variant) — content-derived seed so
// an untouched element keeps its exact stroke across an evolve; only edited
// elements redraw. Never seed from array index.
function hashSeed(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

interface SketchProps {
  // "line" draws one horizontal rule at mid-height (dividers, borders).
  // "cross" draws the two corner-to-corner diagonals (image placeholder).
  kind: "rect" | "line" | "ellipse" | "cross";
  radius?: number;
  seedKey: string;
  className?: string;
}

// Renders an aria-hidden absolutely-positioned SVG sibling that fills its
// parent and draws a rough-sketch stroke over it. Client-only (no hydration
// mismatch) — sizes itself via ResizeObserver and redraws on resize.
export function Sketch({ kind, radius = 0, seedKey, className }: SketchProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const seed = hashSeed(seedKey);
  const roughOptions = {
    seed,
    roughness: SKETCH_ROUGHNESS,
    boil: 0,
  };

  let path = "";
  if (size && size.width > 0 && size.height > 0) {
    const { width, height } = size;
    if (kind === "rect") {
      path = roughRoundedRect(
        0.75,
        0.75,
        Math.max(width - 1.5, 0),
        Math.max(height - 1.5, 0),
        radius,
        roughOptions,
      );
    } else if (kind === "ellipse") {
      path = roughEllipse(
        width / 2,
        height / 2,
        width / 2 - 0.75,
        height / 2 - 0.75,
        roughOptions,
      );
    } else if (kind === "cross") {
      path =
        roughLine(0, 0, width, height, roughOptions) +
        roughLine(width, 0, 0, height, { ...roughOptions, seed: seed + 1 });
    } else {
      path = roughLine(0, height / 2, width, height / 2, roughOptions);
    }
  }

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 ${className ?? ""}`}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        {path ? (
          <path
            d={path}
            fill="none"
            stroke="var(--color-wireframe-ink)"
            strokeWidth={SKETCH_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
    </div>
  );
}
