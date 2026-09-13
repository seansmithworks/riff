"use client";

// Element ink scopes for the streamed wireframe canvas
// (docs/plans/riff-real-stream.html, Step 5). Frame bodies render each
// element in an InkScope keyed by a hash of its content, so an element that
// is already on the canvas keeps its node and never re-inks. A scope that
// mounts while its screen is live hands its Sketch strokes to the active
// draw treatment (src/lib/draw-treatment.ts); anywhere else it is inert.

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { Element } from "@/lib/artifact";
import type { CanvasSlot } from "@/lib/canvas-slots";
import {
  INK_COLORS,
  treatmentFor,
  type ElementInk,
  type ScreenInk,
} from "@/lib/draw-treatment";
import { markFirstInk } from "@/lib/sketch-job";
import { hashSeed, SketchInkContext } from "./Sketch";

type LiveInk = { ink: ScreenInk; onInk: () => void };

const LiveInkContext = createContext<LiveInk | null>(null);

// Key-order-insensitive like sameJson, so deep-equal content shares a key.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentKey(value: unknown): string {
  return hashSeed(canonicalJson(value)).toString(36);
}

/** Content keys for sibling elements; repeats get an occurrence suffix. */
export function elementKeys(elements: Element[]): string[] {
  const seen = new Map<string, number>();
  return elements.map((element) => {
    const key = contentKey(element);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return `${key}.${n}`;
  });
}

const inkVar = (color: string) =>
  ({ "--color-wireframe-ink": color }) as CSSProperties;

/** Element bodies always draw in ink. */
export const BODY_INK = inkVar(INK_COLORS.ink);

/** A frame is pencil until its screen lands. */
export function frameInk(slot: CanvasSlot): CSSProperties {
  return inkVar(
    slot.state === "outline" || slot.state === "inking"
      ? INK_COLORS.pencil
      : INK_COLORS.ink,
  );
}

/** Sits over a stale body: it will change but hasn't re-landed yet. */
export function StaleWash() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 bg-white/60"
    />
  );
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** One ink queue per screen; its element scopes ink only while it's live. */
export function ScreenInkProvider({
  slot,
  jobId,
  reducedMotion,
  children,
}: {
  slot: CanvasSlot;
  jobId: number | null;
  reducedMotion: boolean;
  children: ReactNode;
}) {
  const treatment = treatmentFor(reducedMotion);
  const ink = useMemo(() => treatment.screen(slot.id), [treatment, slot.id]);
  const liveJob = slot.live ? jobId : null;
  const value = useMemo<LiveInk | null>(
    () =>
      liveJob === null ? null : { ink, onInk: () => markFirstInk(liveJob) },
    [ink, liveJob],
  );
  return (
    <LiveInkContext.Provider value={value}>{children}</LiveInkContext.Provider>
  );
}

export function InkScope({
  inkKey,
  children,
}: {
  inkKey: string;
  children: ReactNode;
}) {
  // Read once: a scope's content never changes (it's keyed by content), so
  // whether it inks is settled when it mounts.
  const [live] = useState(useContext(LiveInkContext));
  const scopeRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ElementInk | null>(null);
  const [onStroke] = useState(() =>
    live ? (path: SVGPathElement) => handleRef.current?.stroke({ path }) : null,
  );

  useLayoutEffect(() => {
    // The scope is display: contents, so the element's own root stays the
    // body's flex item (unchanged layout); that root is what animates.
    const root = scopeRef.current?.firstElementChild;
    if (!live || !(root instanceof HTMLElement)) return;
    let started = false;
    const handle = live.ink.element({
      root,
      started: () => {
        if (started) return;
        started = true;
        live.onInk();
      },
    });
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.cancel();
    };
  }, [live]);

  return (
    <div ref={scopeRef} data-ink-key={inkKey} className="contents">
      <SketchInkContext.Provider value={onStroke}>
        {children}
      </SketchInkContext.Provider>
    </div>
  );
}
