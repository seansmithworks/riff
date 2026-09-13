"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { BatteryFull, SignalHigh, Wifi } from "lucide-react";
import type {
  Artifact,
  Element as WireElement,
  OutlineEntry,
  Screen,
} from "@/lib/artifact";
import type { StreamEvent } from "@/lib/artifact-stream";
import { Sketch } from "@/components/Sketch";
import { WireframeElement } from "@/components/WireframeElement";

// R2 run closest to the R2 medians (head 951, first element 1198, s1 3200):
// R2-5 is head 854, first element 1118, s1 3200.
const FIXTURE = "R2-5";
const BRIEF =
  "A mobile app for booking a dog walker. Browse walkers nearby, view a walker profile, and confirm a booking.";

// DESIGN.md: pencil = wireframeBorder, ink = wireframeInk.
const PENCIL = "#d4d4d8";
const INK = "#3f3f46";
const STROKE_MS = 280;
const STAGGER_MS = 35;
const BATCH_CAP_MS = 1200;

// Phone frame geometry mirrors PhoneFrameNode in WireframeCanvas.tsx.
const FRAME_WIDTH = 340;
const FRAME_GAP = 24;
const STAGE_WIDTH = FRAME_WIDTH * 3 + FRAME_GAP * 2;
// Label row (28) + frame (640) + room for the frame's drop shadow (48).
const STAGE_HEIGHT = 28 + 640 + 48;

type Mode = "screen" | "element";

type ServerEvent =
  | { type: "start" }
  | StreamEvent
  | { type: "done"; artifact: Artifact; fallback: boolean }
  | { type: "error"; message: string };

type Run = {
  id: number;
  t0: number;
  t0Epoch: number;
  outline: OutlineEntry[] | null;
  elements: WireElement[][];
  screens: (Screen | null)[];
  doneAt: number | null;
  error: string | null;
};

const inkVar = (color: string) =>
  ({ "--color-wireframe-ink": color }) as CSSProperties;

function applyEvent(run: Run, event: ServerEvent, at: number): Run {
  switch (event.type) {
    case "head":
      return {
        ...run,
        outline: event.outline,
        elements: event.outline.map(() => []),
        screens: event.outline.map(() => null),
      };
    case "element": {
      const elements = run.elements.slice();
      elements[event.screenIndex] = [
        ...(elements[event.screenIndex] ?? []),
        event.element,
      ];
      return { ...run, elements };
    }
    case "screen": {
      const screens = run.screens.slice();
      screens[event.screenIndex] = event.screen;
      return { ...run, screens };
    }
    case "done":
      return { ...run, doneAt: at };
    case "error":
      return { ...run, doneAt: at, error: event.message };
    default:
      return run;
  }
}

export function InkOptions() {
  const [run, setRun] = useState<Run | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const reduced = useReducedMotion();

  const start = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const id = ++runIdRef.current;
    const t0 = performance.now();
    setRun({
      id,
      t0,
      t0Epoch: performance.timeOrigin + t0,
      outline: null,
      elements: [],
      screens: [],
      doneAt: null,
      error: null,
    });
    const update = (fn: (current: Run) => Run) =>
      setRun((current) =>
        current && current.id === id ? fn(current) : current,
      );

    void (async () => {
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson",
          },
          body: JSON.stringify({ brief: BRIEF, replay: FIXTURE }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`replay request failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            const event = JSON.parse(line) as ServerEvent;
            const at = performance.now() - t0;
            update((current) => applyEvent(current, event, at));
          }
          if (done) break;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        const at = performance.now() - t0;
        update((current) => ({ ...current, doneAt: at, error: message }));
      }
    })();
  }, []);

  useEffect(() => {
    start();
    return () => controllerRef.current?.abort();
  }, [start]);

  return (
    <main
      className="flex min-h-screen w-full flex-col bg-[#f4f4f5] px-8 pb-8 text-zinc-900"
      data-t0-epoch={run?.t0Epoch}
      data-done={run?.doneAt != null ? "" : undefined}
    >
      <style>{`.ink-stage path { transition: stroke 400ms ease-out; }`}</style>
      <header className="flex items-center gap-6 py-4">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-base font-semibold">Ink options</h1>
          <span className="text-xs text-zinc-500">
            Same replayed stream ({FIXTURE}), same clock. Only the ink rule
            differs.
          </span>
        </div>
        <div className="ml-auto flex items-center gap-4">
          {run?.error ? (
            <span className="text-xs text-red-700">{run.error}</span>
          ) : null}
          {run ? <Elapsed t0={run.t0} doneAt={run.doneAt} /> : null}
          <button
            type="button"
            onClick={start}
            className="rounded-full bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3FBA6A]"
          >
            Replay
          </button>
        </div>
      </header>
      <div className="grid flex-1 grid-cols-2 gap-8">
        {run ? (
          <>
            <Column
              key={`a-${run.id}`}
              mode="screen"
              run={run}
              reduced={reduced}
            />
            <Column
              key={`b-${run.id}`}
              mode="element"
              run={run}
              reduced={reduced}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}

function Elapsed({ t0, doneAt }: { t0: number; doneAt: number | null }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (doneAt != null) return;
    let frame = 0;
    const tick = () => {
      setNow(performance.now() - t0);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [t0, doneAt]);
  const ms = doneAt ?? now;
  return (
    <span
      className="w-20 text-right font-mono text-2xl font-semibold tabular-nums"
      data-elapsed-ms={Math.round(ms)}
    >
      {(ms / 1000).toFixed(1)}s
    </span>
  );
}

const COLUMN_COPY: Record<Mode, { label: string; rule: string }> = {
  screen: {
    label: "A · Per screen",
    rule: "A screen's whole body inks when that screen's JSON closes.",
  },
  element: {
    label: "B · Per element",
    rule: "Each element inks the moment it closes.",
  },
};

function Column({
  mode,
  run,
  reduced,
}: {
  mode: Mode;
  run: Run;
  reduced: boolean;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(stageRef, STAGE_WIDTH);
  const [firstInk, setFirstInk] = useState<number | null>(null);

  const bodies = (run.outline ?? []).map((_, i) =>
    mode === "screen"
      ? (run.screens[i]?.elements ?? [])
      : (run.elements[i] ?? []),
  );
  const inked = bodies.some((body) => body.length > 0);

  // Stamped at the commit that first mounts ink in this column.
  useLayoutEffect(() => {
    if (inked && firstInk === null) setFirstInk(performance.now() - run.t0);
  }, [inked, firstInk, run.t0]);

  const { label, rule } = COLUMN_COPY[mode];
  return (
    <section className="flex min-w-0 flex-col gap-3" data-mode={mode}>
      <div className="flex flex-col">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="text-xs text-zinc-500">{rule}</span>
      </div>
      <div
        ref={stageRef}
        className="ink-stage w-full"
        style={{ height: STAGE_HEIGHT * scale }}
      >
        <div
          className="flex origin-top-left"
          style={{
            width: STAGE_WIDTH,
            gap: FRAME_GAP,
            transform: `scale(${scale})`,
          }}
        >
          {(run.outline ?? []).map((entry, i) => (
            <Phone
              key={entry.id}
              entry={entry}
              body={bodies[i]}
              closed={run.screens[i] != null}
              reduced={reduced}
            />
          ))}
        </div>
      </div>
      <span
        className="font-mono text-xs tabular-nums text-zinc-500"
        data-first-ink-ms={firstInk ?? undefined}
      >
        {firstInk === null
          ? "First ink: waiting"
          : `First ink at ${(firstInk / 1000).toFixed(2)}s`}
      </span>
    </section>
  );
}

// Mirrors PhoneFrameNode (WireframeCanvas.tsx), which isn't exported. The
// frame outline is pencil until the screen closes; the body is always ink.
function Phone({
  entry,
  body,
  closed,
  reduced,
}: {
  entry: OutlineEntry;
  body: WireElement[];
  closed: boolean;
  reduced: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useInkIn(ref, reduced);
  const tabbar = body.find((element) => element.type === "tabbar");
  const rest = body.filter((element) => element.type !== "tabbar");

  return (
    <div ref={ref} className="flex shrink-0 flex-col items-center gap-3">
      <span className="text-xs font-medium tracking-wide text-zinc-500">
        {entry.name}
      </span>
      <div
        className="relative flex h-[640px] w-[340px] flex-col overflow-hidden rounded-[28px] border border-transparent bg-white shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)]"
        style={inkVar(closed ? INK : PENCIL)}
      >
        <div data-ink-unit className="absolute inset-0">
          <Sketch
            kind="rect"
            radius={28}
            strokeWidth={1.5}
            seedKey={`frame:${entry.id}`}
          />
        </div>
        <div data-ink-unit className="shrink-0">
          <StatusBar />
        </div>
        <div
          className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto py-3"
          style={inkVar(INK)}
        >
          {rest.map((element, i) => (
            <div key={i} data-ink-unit>
              <WireframeElement element={element} />
            </div>
          ))}
        </div>
        {tabbar ? (
          <div data-ink-unit className="shrink-0" style={inkVar(INK)}>
            <WireframeElement element={tabbar} />
          </div>
        ) : null}
        <div data-ink-unit className="shrink-0">
          <HomeIndicator seedKey={entry.id} />
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="flex shrink-0 items-center justify-between px-3 pb-1 pt-2">
      <span className="text-[13px]/[16px] font-semibold text-zinc-900">
        9:41
      </span>
      <div className="flex items-center gap-1.5 text-zinc-500">
        <SignalHigh className="h-3.5 w-3.5" strokeWidth={1.75} />
        <Wifi className="h-3.5 w-3.5" strokeWidth={1.75} />
        <BatteryFull className="h-4 w-4" strokeWidth={1.75} />
      </div>
    </div>
  );
}

function HomeIndicator({ seedKey }: { seedKey: string }) {
  return (
    <div className="flex shrink-0 items-center justify-center py-2">
      <div className="relative h-[5px] w-[134px]">
        <Sketch kind="line" seedKey={`home-indicator:${seedKey}`} />
      </div>
    </div>
  );
}

// Draw-in without touching Sketch.tsx. Every [data-ink-unit] mounted in the
// same commit is one batch: its sketch strokes draw in DOM order, 35ms apart
// (compressed so the batch fits 1.2s), and each unit's content fades in with
// its first stroke. Per-screen ink mounts a whole body in one commit, per-
// element ink mounts one element per commit, so the same code gives both.
// Sketch adds its <path> a frame after mount (ResizeObserver), so a
// MutationObserver catches it and animates stroke-dashoffset over
// pathLength="1". Reduced motion fades each batch instead.
function useInkIn(ref: RefObject<HTMLDivElement | null>, reduced: boolean) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || reduced) return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof SVGPathElement) drawIn(node);
          else if (node instanceof globalThis.Element) {
            node.querySelectorAll("path").forEach(drawIn);
          }
        });
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref, reduced]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const units = Array.from(
      root.querySelectorAll<HTMLElement>(
        "[data-ink-unit]:not([data-ink-batched])",
      ),
    );
    if (!units.length) return;

    if (reduced) {
      for (const unit of units) {
        unit.dataset.inkBatched = "";
        unit.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: STROKE_MS,
          easing: "ease-out",
          fill: "backwards",
        });
      }
      return;
    }

    const now = performance.now();
    const batch = units.map((unit) => ({
      unit,
      // Sketch's own SVGs only; lucide icons fade with their unit.
      svgs: Array.from(
        unit.querySelectorAll<SVGSVGElement>("svg:not(.lucide)"),
      ),
    }));
    const slots = batch.reduce((n, b) => n + Math.max(1, b.svgs.length), 0);
    const stagger =
      slots > 1
        ? Math.min(STAGGER_MS, (BATCH_CAP_MS - STROKE_MS) / (slots - 1))
        : 0;

    let slot = 0;
    for (const { unit, svgs } of batch) {
      unit.dataset.inkBatched = "";
      unit.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: STROKE_MS,
        delay: slot * stagger,
        easing: "ease-out",
        fill: "backwards",
      });
      if (!svgs.length) {
        slot++;
        continue;
      }
      for (const svg of svgs) {
        svg.dataset.inkAt = String(now);
        svg.dataset.inkDelay = String(slot * stagger);
        slot++;
        svg.querySelectorAll("path").forEach(drawIn);
      }
    }
  });
}

function drawIn(path: SVGPathElement) {
  const svg = path.ownerSVGElement;
  if (
    !svg ||
    svg.dataset.inkAt === undefined ||
    path.dataset.inkDrawn !== undefined
  ) {
    return;
  }
  path.dataset.inkDrawn = "";
  const delay =
    Number(svg.dataset.inkDelay) -
    (performance.now() - Number(svg.dataset.inkAt));
  path.setAttribute("pathLength", "1");
  // Dash 1, gap 2: at offset 1.05 nothing (not even a round cap) shows.
  path.style.strokeDasharray = "1 2";
  const animation = path.animate(
    [{ strokeDashoffset: 1.05 }, { strokeDashoffset: 0 }],
    {
      duration: STROKE_MS,
      delay,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "backwards",
    },
  );
  animation.onfinish = () => {
    path.removeAttribute("pathLength");
    path.style.strokeDasharray = "";
  };
}

function useFitScale(ref: RefObject<HTMLDivElement | null>, width: number) {
  const [scale, setScale] = useState(0.7);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(1, entry.contentRect.width / width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, width]);
  return scale;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
