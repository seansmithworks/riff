"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { roughLine, roughRoundedRect, roughEllipse } from "drawably";

// One-line flips for the hand-drawn look. See CreativeConvos/ORCHESTRATOR.md
// "fidelity line" — surface stays honest, structure stays real.
export const SKETCH_ROUGHNESS = 0.6;
export const SKETCH_STROKE_WIDTH = 1.25;
export const SKETCH_HAND_FONT = true;

// Rules (dividers/borders) use a lower roughness than rects/ellipses —
// a hairline needs a lighter hand than a box outline to read as one stroke.
const SKETCH_LINE_ROUGHNESS = 0.55;

// drawably's roughLine/roughRoundedRect/roughEllipse all emit a doubled
// stroke (two overlapping passes) by design — right for a box outline, too
// heavy for a 1px rule. Keep only the first pass for rules.
function firstStroke(doubledPath: string): string {
  const secondMoveIndex = doubledPath.indexOf("M", 1);
  return secondMoveIndex === -1
    ? doubledPath
    : doubledPath.slice(0, secondMoveIndex);
}

// Deterministic 32-bit string hash (djb2 variant) — content-derived seed so
// an untouched element keeps its exact stroke across an evolve; only edited
// elements redraw. Never seed from array index.
export function hashSeed(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * Set by a live ink scope (InkScope.tsx), which draws the stroke in. Outside
 * one it's null and the stroke renders static.
 */
export const SketchInkContext = createContext<
  ((svg: SVGSVGElement, path: SVGPathElement) => void) | null
>(null);

interface SketchProps {
  // "line" draws one horizontal rule at mid-height (dividers, borders).
  // "cross" draws the two corner-to-corner diagonals (image placeholder).
  kind: "rect" | "line" | "ellipse" | "cross";
  radius?: number;
  seedKey: string;
  className?: string;
  // Overrides the kind-based default (1 for lines, SKETCH_STROKE_WIDTH
  // otherwise) — used for the device frame's heavier outline.
  strokeWidth?: number;
}

// Renders an aria-hidden absolutely-positioned SVG sibling that fills its
// parent and draws a rough-sketch stroke over it. Client-only (no hydration
// mismatch) — sizes itself via ResizeObserver and redraws on resize.
export function Sketch({
  kind,
  radius = 0,
  seedKey,
  className,
  strokeWidth,
}: SketchProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const handedOver = useRef(false);
  const onStroke = useContext(SketchInkContext);
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
      path = firstStroke(
        roughLine(0, height / 2, width, height / 2, {
          ...roughOptions,
          roughness: SKETCH_LINE_ROUGHNESS,
        }),
      );
    }
  }

  // Only the first non-empty path per mount is handed over (before paint, so
  // it never flashes fully drawn); a resize just reshapes it.
  useLayoutEffect(() => {
    if (!path || handedOver.current) return;
    handedOver.current = true;
    if (onStroke && svgRef.current && pathRef.current) {
      onStroke(svgRef.current, pathRef.current);
    }
  }, [path, onStroke]);

  const resolvedStrokeWidth =
    strokeWidth ?? (kind === "line" ? 1 : SKETCH_STROKE_WIDTH);

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 ${className ?? ""}`}
    >
      <svg
        ref={svgRef}
        data-sketch=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        {path ? (
          <path
            ref={pathRef}
            d={path}
            fill="none"
            stroke="var(--color-wireframe-ink)"
            strokeWidth={resolvedStrokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
    </div>
  );
}
