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
} from "@/lib/artifact";
import type { StreamEvent } from "@/lib/artifact-stream";
import { Sketch } from "@/components/Sketch";
import { WireframeElement } from "@/components/WireframeElement";

// R2 run closest to the R2 medians (head 951, first element 1198, s1 3200):
// R2-5 is head 854, first element 1118, s1 3200.
const FIXTURE = "R2-5";
const BRIEF =
  "A mobile app for booking a dog walker. Browse walkers nearby, view a walker profile, and confirm a booking.";

// DESIGN.md tokens. Pencil is `textTertiary` (zinc-400), one step darker
// than `wireframeBorder` (zinc-300), which read as barely visible at head.
const PENCIL = "#a1a1aa";
const INK = "#3f3f46"; // wireframeInk
const WET = "#18181b"; // wireframeTextPrimary

// Column 0 (Current): today's per-element ink, unchanged.
const STROKE_MS = 280;
const STAGGER_MS = 35;
const BATCH_CAP_MS = 1200;

// Columns 1-3: one pen per screen.
// Strawman: at 1200 px/s the first three R2-5 elements (~1600px of stroke
// and text) finish just before the list arrives, so the pen never idles
// behind the stream until the list lands.
const DEFAULT_PEN_PX_S = 1200;
const PEN_MIN_PX_S = 300;
const PEN_MAX_PX_S = 3000;
const PENCIL_MS = 150;
const RECOLOR_MS = 200;
// Lag = now minus the arrival of what the pen is drawing. Past 800ms the pen
// sets a deadline 300ms out and speeds up to clear its whole queue by then,
// so lag peaks near 1.1s whatever lands.
const LAG_LIMIT_MS = 800;
const CATCHUP_WINDOW_MS = 300;
// A stroke whose path never renders (zero-size box) is skipped after this.
const STALL_MS = 1000;
// Wet ink: Sean's lab Ink & Wash wetBloom. The trail behind the head is
// three bands (px from the head) that thin and lighten back to ink weight.
const WET_BLOOM = 0.28;
const WET_BANDS = [0, 14, 34, 64];
const WET_WIDTH = [1 + 4 * WET_BLOOM, 1 + 2.4 * WET_BLOOM, 1 + 1.1 * WET_BLOOM];
const WET_OPACITY = [0.95, 0.65, 0.35];
const MIN_WIPE_PX = 24;
const MIN_BLUR_PX = 280;

// Phone frame geometry mirrors PhoneFrameNode in WireframeCanvas.tsx.
const FRAME_WIDTH = 340;
const FRAME_HEIGHT = 640;
const LABEL_ROW = 28;
const SHADOW_ROOM = 28;
const MAX_SCALE = 1.2;

const SVG_NS = "http://www.w3.org/2000/svg";

type Treatment = "current" | "pen" | "pencil" | "wet";
const TREATMENTS: Treatment[] = ["current", "pen", "pencil", "wet"];

const COLUMN_COPY: Record<Treatment, { label: string; rule: string }> = {
  current: {
    label: "0 · Current",
    rule: "Each element's strokes draw in 280ms; its text fades in.",
  },
  pen: {
    label: "1 · Pen",
    rule: "One pen, arrival order, constant speed. Nib on the head; text writes on.",
  },
  pencil: {
    label: "2 · Pencil, then ink",
    rule: "A 150ms pencil pass on arrival; the pen inks over it, then writes.",
  },
  wet: {
    label: "3 · Wet ink",
    rule: "Pen motion with a dark, heavy head that settles. Text resolves from blur.",
  },
};

type ServerEvent =
  | { type: "start" }
  | StreamEvent
  | { type: "done"; artifact: Artifact; fallback: boolean }
  | { type: "error"; message: string };

type Arrived<T> = { value: T; t: number };

// All times are stream ms: real ms since the request, as the replay sends it.
type Run = {
  id: number;
  headAt: number | null;
  outline: OutlineEntry[] | null;
  elements: Arrived<WireElement>[][];
  screenClosedAt: (number | null)[];
  doneAt: number | null;
  error: string | null;
};

// The page clock. At 0.5x the stream clock runs at half speed and events
// wait in a buffer until it reaches them; `?at=<ms>` freezes it for stills.
type Clock = { t0: number; speed: number; freezeAt: number | null };

function clockNow(clock: Clock) {
  const t = (performance.now() - clock.t0) * clock.speed;
  return clock.freezeAt === null ? t : Math.min(t, clock.freezeAt);
}

const inkVar = (color: string) =>
  ({ "--color-wireframe-ink": color }) as CSSProperties;

const secs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

function applyEvent(run: Run, event: ServerEvent, at: number): Run {
  switch (event.type) {
    case "head":
      return {
        ...run,
        headAt: at,
        outline: event.outline,
        elements: event.outline.map(() => []),
        screenClosedAt: event.outline.map(() => null),
      };
    case "element": {
      const elements = run.elements.slice();
      elements[event.screenIndex] = [
        ...(elements[event.screenIndex] ?? []),
        { value: event.element, t: at },
      ];
      return { ...run, elements };
    }
    case "screen": {
      const screenClosedAt = run.screenClosedAt.slice();
      screenClosedAt[event.screenIndex] = at;
      return { ...run, screenClosedAt };
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
  const [speed, setSpeed] = useState(1);
  const [penPx, setPenPx] = useState(DEFAULT_PEN_PX_S);
  const penRef = useRef(DEFAULT_PEN_PX_S);
  const freezeRef = useRef<number | null>(null);
  const clockRef = useRef<Clock>({ t0: 0, speed: 1, freezeAt: null });
  const pendingRef = useRef<{ t: number; event: ServerEvent }[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const reduced = useReducedMotion();

  const start = useCallback((nextSpeed: number) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const id = ++runIdRef.current;
    const t0 = performance.now();
    clockRef.current = { t0, speed: nextSpeed, freezeAt: freezeRef.current };
    const pending: { t: number; event: ServerEvent }[] = [];
    pendingRef.current = pending;
    setRun({
      id,
      headAt: null,
      outline: null,
      elements: [],
      screenClosedAt: [],
      doneAt: null,
      error: null,
    });

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
            pending.push({ t: performance.now() - t0, event });
          }
          if (done) break;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        pending.push({
          t: performance.now() - t0,
          event: { type: "error", message },
        });
      }
    })();
  }, []);

  // Releases buffered events once the page clock reaches their stream time.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const pending = pendingRef.current;
      const now = clockNow(clockRef.current);
      let n = 0;
      while (n < pending.length && pending[n].t <= now) n++;
      if (n) {
        const released = pending.splice(0, n);
        const id = runIdRef.current;
        setRun((current) =>
          current && current.id === id
            ? released.reduce(
                (r, { t, event }) => applyEvent(r, event, t),
                current,
              )
            : current,
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    // Capture aids: ?speed=0.5, ?pen=<px/s>, ?at=<ms> (freeze the clock).
    const params = new URLSearchParams(window.location.search);
    const initialSpeed = params.get("speed") === "0.5" ? 0.5 : 1;
    const at = Number(params.get("at"));
    freezeRef.current = params.has("at") && Number.isFinite(at) ? at : null;
    const pen = Number(params.get("pen"));
    if (pen >= PEN_MIN_PX_S && pen <= PEN_MAX_PX_S) {
      penRef.current = pen;
      setPenPx(pen);
    }
    setSpeed(initialSpeed);
    start(initialSpeed);
    return () => controllerRef.current?.abort();
  }, [start]);

  const changeSpeed = (next: number) => {
    setSpeed(next);
    start(next);
  };

  const entry = run?.outline?.[0] ?? null;
  const closedAt = run?.screenClosedAt[0] ?? null;

  return (
    <main
      className="ink-stage flex min-h-screen w-full flex-col bg-[#f4f4f5] px-4 pb-4 text-zinc-900"
      data-t0-epoch={
        run ? performance.timeOrigin + clockRef.current.t0 : undefined
      }
      data-done={run?.doneAt != null ? "" : undefined}
      style={
        {
          "--transition-ms": `${Math.round(400 / speed)}ms`,
        } as CSSProperties
      }
    >
      <style>{`
        .ink-stage [data-frame] path { transition: stroke var(--transition-ms) ease-out; }
        .ink-stage [data-ink-unit="element"] * { transition: background-color var(--transition-ms) ease-out; }
        .ink-stage [data-wash="dry"], .ink-stage [data-wash="dry"] * { background-color: transparent !important; }
      `}</style>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-base font-semibold">Draw treatments</h1>
          <span className="text-xs text-zinc-500">
            Per-element ink, screen 1 of the replayed stream ({FIXTURE}), one
            clock. Only the draw treatment differs.
            {closedAt !== null ? ` Screen 1 closed at ${secs(closedAt)}.` : ""}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-5">
          {run?.error ? (
            <span className="text-xs text-red-700">{run.error}</span>
          ) : null}
          <div
            role="group"
            aria-label="Playback speed"
            className="flex rounded-full bg-zinc-200 p-0.5"
          >
            {[1, 0.5].map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={speed === option}
                onClick={() => changeSpeed(option)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3FBA6A] ${
                  speed === option
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500"
                }`}
              >
                {option === 1 ? "1×" : "0.5×"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-500">
            Pen speed
            <input
              type="range"
              min={PEN_MIN_PX_S}
              max={PEN_MAX_PX_S}
              step={50}
              value={penPx}
              onChange={(e) => {
                const value = Number(e.target.value);
                penRef.current = value;
                setPenPx(value);
              }}
              className="w-36 accent-[#1F7A4D]"
            />
            <span className="w-20 font-mono text-xs tabular-nums text-zinc-900">
              {penPx} px/s
            </span>
          </label>
          {run ? (
            <Elapsed clockRef={clockRef} doneAt={run.doneAt} runId={run.id} />
          ) : null}
          <button
            type="button"
            onClick={() => start(speed)}
            className="rounded-full bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3FBA6A]"
          >
            Replay
          </button>
        </div>
      </header>
      <div className="grid flex-1 grid-cols-2 gap-4 xl:grid-cols-4">
        {run
          ? TREATMENTS.map((treatment) => (
              <Column
                key={`${treatment}-${run.id}-${reduced}`}
                treatment={treatment}
                entry={entry}
                body={run.elements[0] ?? []}
                headAt={run.headAt}
                closedAt={closedAt}
                clockRef={clockRef}
                penRef={penRef}
                reduced={reduced}
              />
            ))
          : null}
      </div>
    </main>
  );
}

function Elapsed({
  clockRef,
  doneAt,
  runId,
}: {
  clockRef: RefObject<Clock>;
  doneAt: number | null;
  runId: number;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const t = clockNow(clockRef.current);
      setNow(doneAt === null ? t : Math.min(t, doneAt));
      if (doneAt === null || t < doneAt) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [clockRef, doneAt, runId]);
  return (
    <span
      className="w-20 text-right font-mono text-2xl font-semibold tabular-nums"
      data-elapsed-ms={Math.round(now)}
    >
      {(now / 1000).toFixed(1)}s
    </span>
  );
}

type Stats = {
  firstInkAt: number | null;
  doneAt: number | null;
  maxLag: number;
};

function Column({
  treatment,
  entry,
  body,
  headAt,
  closedAt,
  clockRef,
  penRef,
  reduced,
}: {
  treatment: Treatment;
  entry: OutlineEntry | null;
  body: Arrived<WireElement>[];
  headAt: number | null;
  closedAt: number | null;
  clockRef: RefObject<Clock>;
  penRef: RefObject<number>;
  reduced: boolean;
}) {
  const [stats, setStats] = useState<Stats>({
    firstInkAt: null,
    doneAt: null,
    maxLag: 0,
  });
  const [engine] = useState(
    () => new InkEngine(treatment, reduced, penRef, setStats),
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(stageRef, FRAME_WIDTH + 8, MAX_SCALE);

  useEffect(() => engine.setClosedAt(closedAt), [engine, closedAt]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      engine.tick(clockNow(clockRef.current));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine, clockRef]);

  const { label, rule } = COLUMN_COPY[treatment];
  const queued = treatment !== "current" && !reduced;
  return (
    <section className="flex min-w-0 flex-col gap-2" data-treatment={treatment}>
      <div className="flex min-h-[52px] flex-col">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="text-xs text-zinc-500">{rule}</span>
      </div>
      <div ref={stageRef} className="w-full">
        <div
          className="mx-auto"
          style={{
            width: FRAME_WIDTH * scale,
            height: (LABEL_ROW + FRAME_HEIGHT + SHADOW_ROOM) * scale,
          }}
        >
          <div
            className="origin-top-left"
            style={{ width: FRAME_WIDTH, transform: `scale(${scale})` }}
          >
            {entry && headAt !== null ? (
              <Phone
                entry={entry}
                body={body}
                headAt={headAt}
                closed={closedAt !== null}
                engine={engine}
              />
            ) : null}
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 font-mono text-xs tabular-nums text-zinc-500">
        <dt>First ink</dt>
        <dd
          className="text-zinc-900"
          data-first-ink-ms={stats.firstInkAt ?? undefined}
        >
          {stats.firstInkAt === null ? "waiting" : secs(stats.firstInkAt)}
        </dd>
        <dt>Drawing done</dt>
        <dd className="text-zinc-900" data-done-ms={stats.doneAt ?? undefined}>
          {stats.doneAt === null
            ? "drawing"
            : `${secs(stats.doneAt)}${
                closedAt !== null
                  ? ` (${stats.doneAt >= closedAt ? "+" : "−"}${secs(
                      Math.abs(stats.doneAt - closedAt),
                    )} vs s1 close)`
                  : ""
              }`}
        </dd>
        <dt>Max lag</dt>
        <dd
          className="text-zinc-900"
          data-max-lag-ms={queued ? Math.round(stats.maxLag) : undefined}
        >
          {queued ? secs(stats.maxLag) : "no pen queue"}
        </dd>
      </dl>
    </section>
  );
}

// Mirrors PhoneFrameNode (WireframeCanvas.tsx), which isn't exported. The
// frame outline is pencil until the screen closes; the body is always ink.
function Phone({
  entry,
  body,
  headAt,
  closed,
  engine,
}: {
  entry: OutlineEntry;
  body: Arrived<WireElement>[];
  headAt: number;
  closed: boolean;
  engine: InkEngine;
}) {
  const phoneRef = useRef<HTMLDivElement>(null);
  const nibRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const phone = phoneRef.current;
    const nib = nibRef.current;
    if (!phone || !nib) return;
    return engine.attach(phone, nib);
  }, [engine]);

  // Every commit: register units that just mounted, before they paint.
  useLayoutEffect(() => engine.scan());

  const tabbar = body.find(({ value }) => value.type === "tabbar");
  const rest = body.filter(({ value }) => value.type !== "tabbar");

  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-xs font-medium tracking-wide text-zinc-500">
        {entry.name}
      </span>
      <div
        ref={phoneRef}
        className="relative flex h-[640px] w-[340px] flex-col overflow-hidden rounded-[28px] border border-transparent bg-white shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)]"
        style={inkVar(closed ? INK : PENCIL)}
      >
        <div
          data-ink-unit="head"
          data-arrived={headAt}
          data-frame
          className="absolute inset-0"
        >
          <Sketch
            kind="rect"
            radius={28}
            strokeWidth={1.5}
            seedKey={`frame:${entry.id}`}
          />
        </div>
        <div data-ink-unit="head" data-arrived={headAt} className="shrink-0">
          <StatusBar />
        </div>
        <div
          className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto py-3"
          style={inkVar(INK)}
        >
          {rest.map(({ value, t }, i) => (
            <div key={i} data-ink-unit="element" data-arrived={t}>
              <WireframeElement element={value} />
            </div>
          ))}
        </div>
        {tabbar ? (
          <div
            data-ink-unit="element"
            data-arrived={tabbar.t}
            className="shrink-0"
            style={inkVar(INK)}
          >
            <WireframeElement element={tabbar.value} />
          </div>
        ) : null}
        <div data-ink-unit="head" data-arrived={headAt} className="shrink-0">
          <HomeIndicator seedKey={entry.id} />
        </div>
        <div
          ref={nibRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 z-10 rounded-full opacity-0"
        />
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

// ---------------------------------------------------------------------------
// Draw engine. Page-local: Sketch.tsx and WireframeElement.tsx are untouched.
//
// Every [data-ink-unit] registers in the layout effect of the commit that
// mounts it. Sketch adds its <path> a frame later; a MutationObserver catches
// it before paint. Everything then runs on the page clock in one rAF tick, so
// 0.5x and ?at= freezes stay exact.
//
// - Head units (frame, status bar, home indicator) in every column, and
//   element units in Current, use today's rule: strokes draw 280ms over
//   pathLength="1", 35ms apart within a commit, the unit fades in.
// - Pen, Pencil and Wet hide Sketch's path and draw clones of its drawably
//   passes (each rough shape is two subpaths) appended to the same <svg>,
//   revealed with stroke-dashoffset. A single pen queue walks elements in
//   arrival order: per group, strokes (top-left first), then its fills wash
//   in, then its text and icons.
// ---------------------------------------------------------------------------

type Pair = {
  a: SVGPathElement;
  b: SVGPathElement | null;
  lenA: number;
  len: number;
};

type SvgRec = {
  svg: SVGSVGElement;
  unit: UnitRec;
  source: SVGPathElement | null;
  cleaned: boolean;
  delay: number;
  pairs: Pair[];
  pencil: SVGPathElement[];
  pencilAt: number | null;
  recolorAt: (number | null)[];
};

type UnitRec = {
  el: HTMLElement;
  kind: "head" | "element";
  arrival: number;
  at: number;
  delay: number;
  end: number;
  svgs: SvgRec[];
};

type MarkStyle = "wipe" | "fade" | "blur";
type MarkGeo = {
  len: number;
  offset: number;
  width: number;
  x: number;
  y: number;
};

type Item =
  | { type: "stroke"; arrival: number; rec: SvgRec; dist: number }
  | { type: "wash"; arrival: number; els: HTMLElement[] }
  | {
      type: "mark";
      arrival: number;
      el: HTMLElement | SVGElement;
      style: MarkStyle;
      color: string;
      dist: number;
      geo: MarkGeo | null;
    };

type WetTrail = {
  pair: Pair;
  bands: SVGPathElement[];
  p: number;
  speed: number;
  finishedAt: number | null;
};

class InkEngine {
  private readonly treatment: Treatment;
  private readonly reduced: boolean;
  private readonly penRef: RefObject<number>;
  private readonly onStats: (stats: Stats) => void;
  private phone: HTMLElement | null = null;
  private nib: HTMLElement | null = null;
  private units = new Map<HTMLElement, UnitRec>();
  private svgs = new Map<SVGSVGElement, SvgRec>();
  private baseline: UnitRec[] = [];
  private fx = new Set<SvgRec>();
  private trails: WetTrail[] = [];
  private queue: Item[] = [];
  private now = 0;
  private last: number | null = null;
  private speedNow = 0;
  private closedAt: number | null = null;
  private elementEnd: number | null = null;
  private stats: Stats = { firstInkAt: null, doneAt: null, maxLag: 0 };
  private reportedLag = 0;

  constructor(
    treatment: Treatment,
    reduced: boolean,
    penRef: RefObject<number>,
    onStats: (stats: Stats) => void,
  ) {
    this.treatment = treatment;
    this.reduced = reduced;
    this.penRef = penRef;
    this.onStats = onStats;
  }

  private get pen() {
    return this.treatment !== "current" && !this.reduced;
  }

  setClosedAt(t: number | null) {
    this.closedAt = t;
  }

  attach(phone: HTMLElement, nib: HTMLElement) {
    this.phone = phone;
    this.nib = nib;
    const size = this.treatment === "wet" ? 5.5 : 4.5;
    Object.assign(nib.style, {
      width: `${size}px`,
      height: `${size}px`,
      background: this.treatment === "wet" ? WET : INK,
      boxShadow:
        this.treatment === "wet" ? "0 0 5px 2px rgba(24, 24, 27, 0.28)" : "",
    });
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          if (record.target instanceof SVGPathElement) {
            this.onPathChanged(record.target);
          }
          continue;
        }
        record.addedNodes.forEach((node) => {
          if (node instanceof SVGPathElement) this.onPath(node);
          else if (node instanceof globalThis.Element) {
            node.querySelectorAll("path").forEach((p) => this.onPath(p));
          }
        });
      }
    });
    observer.observe(phone, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["d"],
    });
    return () => {
      observer.disconnect();
      this.phone = null;
      this.nib = null;
    };
  }

  scan() {
    const phone = this.phone;
    if (!phone) return;
    const fresh = Array.from(
      phone.querySelectorAll<HTMLElement>("[data-ink-unit]"),
    ).filter((el) => !this.units.has(el));
    const batch: UnitRec[] = [];
    for (const el of fresh) {
      const unit: UnitRec = {
        el,
        kind: el.dataset.inkUnit === "head" ? "head" : "element",
        arrival: Number(el.dataset.arrived),
        at: this.now,
        delay: 0,
        end: this.now,
        svgs: [],
      };
      this.units.set(el, unit);
      el.querySelectorAll<SVGSVGElement>("svg:not(.lucide)").forEach((svg) => {
        const rec: SvgRec = {
          svg,
          unit,
          source: null,
          cleaned: false,
          delay: 0,
          pairs: [],
          pencil: [],
          pencilAt: null,
          recolorAt: [],
        };
        unit.svgs.push(rec);
        this.svgs.set(svg, rec);
      });
      if (unit.kind === "element" && this.pen) this.enqueue(unit);
      else batch.push(unit);
    }
    if (batch.length) this.startBaseline(batch);
  }

  tick(now: number) {
    const dt = this.last === null ? 0 : Math.max(0, now - this.last);
    this.last = now;
    this.now = now;
    this.baseline = this.baseline.filter((unit) => !this.renderBaseline(unit));
    for (const rec of this.fx) if (this.renderFx(rec)) this.fx.delete(rec);
    if (this.pen) this.runPen(dt);
    this.trails = this.trails.filter((trail) => !this.renderTrail(trail));
    this.checkDone();
  }

  // --- Current rule (and head units everywhere) ---------------------------

  private startBaseline(batch: UnitRec[]) {
    const slots = batch.reduce((n, u) => n + Math.max(1, u.svgs.length), 0);
    const stagger =
      slots > 1 && !this.reduced
        ? Math.min(STAGGER_MS, (BATCH_CAP_MS - STROKE_MS) / (slots - 1))
        : 0;
    let slot = 0;
    for (const unit of batch) {
      unit.at = this.now;
      unit.delay = slot * stagger;
      if (!unit.svgs.length) slot++;
      for (const rec of unit.svgs) {
        rec.delay = slot * stagger;
        slot++;
      }
      unit.end = this.now + Math.max(0, slot - 1) * stagger + STROKE_MS;
      unit.el.style.opacity = "0";
      this.baseline.push(unit);
      if (unit.kind === "element") {
        this.firstInk(unit.at);
        this.elementEnd = Math.max(this.elementEnd ?? 0, unit.end);
      }
    }
  }

  private renderBaseline(unit: UnitRec) {
    const t = clamp01((this.now - unit.at - unit.delay) / STROKE_MS);
    unit.el.style.opacity = t >= 1 ? "" : String(easeOut(t));
    if (this.reduced) return t >= 1;
    let done = t >= 1;
    for (const rec of unit.svgs) {
      this.renderBaselineSvg(rec);
      if (!rec.cleaned) done = false;
    }
    return done;
  }

  private renderBaselineSvg(rec: SvgRec) {
    const path = rec.source;
    if (!path || rec.cleaned) return;
    const t = clamp01((this.now - rec.unit.at - rec.delay) / STROKE_MS);
    if (t >= 1) {
      path.removeAttribute("pathLength");
      path.style.strokeDasharray = "";
      path.style.strokeDashoffset = "";
      rec.cleaned = true;
      return;
    }
    path.setAttribute("pathLength", "1");
    // Dash 1, gap 2: at offset 1.05 nothing (not even a round cap) shows.
    path.style.strokeDasharray = "1 2";
    path.style.strokeDashoffset = String(1.05 * (1 - standardEase(t)));
  }

  // --- Paths ----------------------------------------------------------------

  private onPath(path: SVGPathElement) {
    if (path.dataset.inkClone !== undefined) return;
    const svg = path.ownerSVGElement;
    if (!svg) return;
    let rec = this.svgs.get(svg);
    if (!rec) {
      this.scan();
      rec = this.svgs.get(svg);
    }
    if (!rec || rec.source === path) return;
    rec.source = path;
    const baselineUnit = rec.unit.kind === "head" || !this.pen;
    if (baselineUnit) {
      if (!this.reduced) this.renderBaselineSvg(rec);
      return;
    }
    path.style.visibility = "hidden";
    this.buildClones(rec, path);
  }

  private onPathChanged(path: SVGPathElement) {
    if (path.dataset.inkClone !== undefined) return;
    const svg = path.ownerSVGElement;
    const rec = svg ? this.svgs.get(svg) : undefined;
    if (!rec || rec.source !== path || !rec.pairs.length) return;
    // Resize: re-trace the clones in place, progress kept.
    const subs = subpaths(path.getAttribute("d") ?? "");
    rec.pairs.forEach((pair, i) => {
      const a =
        this.treatment === "pencil"
          ? (subs[2 * i + 1] ?? subs[2 * i])
          : subs[2 * i];
      const b = subs[2 * i + 1];
      if (a) pair.a.setAttribute("d", a);
      if (pair.b && b) pair.b.setAttribute("d", b);
      pair.lenA = pair.a.getTotalLength();
      pair.len = Math.max(pair.lenA, pair.b ? pair.b.getTotalLength() : 0);
      if (this.treatment === "pencil" && subs[2 * i]) {
        rec.pencil[i]?.setAttribute("d", subs[2 * i]);
      }
    });
  }

  private buildClones(rec: SvgRec, source: SVGPathElement) {
    const subs = subpaths(source.getAttribute("d") ?? "");
    for (let i = 0; i < subs.length; i += 2) {
      const first = subs[i];
      const second = subs[i + 1];
      if (this.treatment === "pencil") {
        // First pass in pencil; the pen inks the second pass over it.
        const pencil = cloneStroke(rec.svg, source, first);
        pencil.style.stroke = PENCIL;
        rec.pencil.push(pencil);
        const ink = cloneStroke(rec.svg, source, second ?? first);
        const lenA = ink.getTotalLength();
        rec.pairs.push({ a: ink, b: null, lenA, len: lenA });
        rec.recolorAt.push(null);
      } else {
        // Both passes draw together, so they read as one stroke.
        const a = cloneStroke(rec.svg, source, first);
        const b = second ? cloneStroke(rec.svg, source, second) : null;
        const lenA = a.getTotalLength();
        const len = Math.max(lenA, b ? b.getTotalLength() : 0);
        rec.pairs.push({ a, b, lenA, len });
      }
    }
    if (this.treatment === "pencil") {
      rec.pencilAt = this.now;
      this.fx.add(rec);
      // The pencil pass is this column's first visible mark.
      this.firstInk(this.now);
    }
  }

  // Pencil passes and pencil-to-ink recolors, on the page clock.
  private renderFx(rec: SvgRec) {
    let busy = false;
    if (rec.pencilAt !== null) {
      const t = clamp01((this.now - rec.pencilAt) / PENCIL_MS);
      for (const path of rec.pencil) setDash(path, easeOut(t));
      if (t < 1) busy = true;
    }
    rec.recolorAt.forEach((at, i) => {
      if (at === null) return;
      const t = clamp01((this.now - at) / RECOLOR_MS);
      rec.pencil[i].style.stroke = mixHex(PENCIL, INK, t);
      if (t < 1) busy = true;
    });
    return !busy;
  }

  // --- Pen queue --------------------------------------------------------------

  private enqueue(unit: UnitRec) {
    const root = unit.el.firstElementChild;
    if (!(root instanceof HTMLElement)) return;
    const children = Array.from(root.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const stroked = children.filter((c) => c.querySelector("svg:not(.lucide)"));
    const groups = stroked.length >= 2 ? children : [root];
    const arrival = unit.arrival;
    // Dry every fill before the first layout read below. A read in between
    // computes the fills' style, and the dry flag then transitions them out
    // instead of starting hidden.
    root.dataset.wash = "dry";
    for (const group of groups) group.dataset.wash = "dry";
    groups.forEach((group, gi) => {
      const strokes = unit.svgs
        .filter((rec) => group.contains(rec.svg))
        .map((rec) => ({ rec, box: rec.svg.getBoundingClientRect() }))
        .sort(
          (x, y) =>
            Math.round(x.box.top / 4) - Math.round(y.box.top / 4) ||
            x.box.left - y.box.left,
        );
      const wash = gi === 0 && group !== root ? [group, root] : [group];
      for (const { rec } of strokes) {
        this.queue.push({ type: "stroke", arrival, rec, dist: 0 });
      }
      this.queue.push({ type: "wash", arrival, els: wash });
      for (const el of collectMarks(group)) {
        const mixed =
          el instanceof HTMLElement && el.querySelector("svg:not(.lucide)");
        const style: MarkStyle = mixed
          ? "fade"
          : this.treatment === "wet"
            ? "blur"
            : "wipe";
        const color = style === "fade" ? getComputedStyle(el).color : "";
        if (style === "wipe") el.style.clipPath = "inset(0 100% 0 0)";
        else if (style === "blur") el.style.opacity = "0";
        else el.style.color = "transparent";
        this.queue.push({
          type: "mark",
          arrival,
          el,
          style,
          color,
          dist: 0,
          geo: null,
        });
      }
    });
  }

  private runPen(dt: number) {
    const now = this.now;
    const penSpeed = this.penRef.current ?? DEFAULT_PEN_PX_S;
    const head = this.queue[0];
    if (this.catchUpUntil !== null && (now >= this.catchUpUntil || !head)) {
      this.catchUpUntil = null;
    }
    if (
      this.catchUpUntil === null &&
      head &&
      this.ready(head) &&
      now - head.arrival > LAG_LIMIT_MS
    ) {
      this.catchUpUntil = now + CATCHUP_WINDOW_MS;
    }
    let speed = penSpeed;
    if (this.catchUpUntil !== null) {
      const remaining = this.queue.reduce(
        (n, item) =>
          n + this.lengthOf(item) - (item.type === "wash" ? 0 : item.dist),
        0,
      );
      speed = Math.max(
        penSpeed,
        (remaining / Math.max(1, this.catchUpUntil - now)) * 1000,
      );
    }
    this.speedNow = speed;
    let budget = dt;
    let active: Item | null = null;
    while (this.queue.length) {
      const item = this.queue[0];
      if (!this.ready(item)) {
        if (
          item.type === "stroke" &&
          !item.rec.pairs.length &&
          now - item.arrival > STALL_MS
        ) {
          this.queue.shift();
          continue;
        }
        break;
      }
      const lag = Math.max(0, now - item.arrival);
      this.stats.maxLag = Math.max(this.stats.maxLag, lag);
      const total = this.lengthOf(item);
      if (total > 0) this.firstInk(now - budget);
      const dist = item.type === "wash" ? 0 : item.dist;
      const needMs = ((total - dist) / speed) * 1000;
      if (needMs <= budget) {
        if (item.type !== "wash") item.dist = total;
        this.render(item);
        this.finish(item);
        this.queue.shift();
        budget -= needMs;
        this.lastFinish = now - budget;
        continue;
      }
      if (item.type !== "wash") item.dist += (speed * budget) / 1000;
      budget = 0;
      this.render(item);
      active = item;
      break;
    }
    this.renderNib(active);
    if (this.stats.maxLag - this.reportedLag >= 25) this.report();
  }

  private lastFinish: number | null = null;
  private catchUpUntil: number | null = null;

  private ready(item: Item) {
    if (item.type !== "stroke") return true;
    const rec = item.rec;
    if (!rec.pairs.length) return false;
    if (this.treatment !== "pencil") return true;
    return rec.pencilAt !== null && this.now >= rec.pencilAt + PENCIL_MS;
  }

  private lengthOf(item: Item) {
    if (item.type === "wash") return 0;
    if (item.type === "stroke") {
      return item.rec.pairs.reduce((n, pair) => n + pair.len, 0);
    }
    item.geo ??= this.measureMark(item.el, item.style);
    return item.geo.len;
  }

  private measureMark(el: HTMLElement | SVGElement, style: MarkStyle): MarkGeo {
    const phone = this.phone!;
    const phoneRect = phone.getBoundingClientRect();
    const scale = phoneRect.width / phone.offsetWidth || 1;
    const elRect = el.getBoundingClientRect();
    let r: DOMRect = elRect;
    if (el instanceof HTMLElement) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rr = range.getBoundingClientRect();
      if (rr.width > 0) r = rr;
    }
    const offset = Math.max(0, (r.left - elRect.left) / scale);
    const width = Math.min(r.width, elRect.right - r.left) / scale;
    return {
      offset,
      width,
      x: (r.left - phoneRect.left) / scale,
      y: (r.top - phoneRect.top + r.height * 0.8) / scale,
      len: Math.max(width, style === "blur" ? MIN_BLUR_PX : MIN_WIPE_PX),
    };
  }

  private render(item: Item) {
    if (item.type === "wash") return;
    if (item.type === "stroke") {
      this.renderStroke(item.rec, item.dist);
      return;
    }
    const geo = item.geo;
    if (!geo) return;
    const p = clamp01(item.dist / geo.len);
    if (item.style === "wipe") {
      const x = geo.offset + p * geo.width;
      item.el.style.clipPath = `inset(-4px calc(100% - ${x.toFixed(1)}px) -4px -4px)`;
    } else if (item.style === "blur") {
      item.el.style.opacity = p <= 0 ? "0" : String(Math.min(1, 0.3 + 0.7 * p));
      item.el.style.filter = `blur(${(4 * (1 - p)).toFixed(2)}px)`;
    } else {
      item.el.style.color = `color-mix(in srgb, ${item.color} ${Math.round(p * 100)}%, transparent)`;
    }
  }

  private renderStroke(rec: SvgRec, dist: number) {
    let start = 0;
    rec.pairs.forEach((pair, i) => {
      const local = Math.min(Math.max(dist - start, 0), pair.len);
      const p = local / pair.len;
      setDash(pair.a, p);
      if (pair.b) setDash(pair.b, p);
      if (this.treatment === "pencil" && p >= 1 && rec.recolorAt[i] === null) {
        rec.recolorAt[i] = this.now;
        this.fx.add(rec);
      }
      if (this.treatment === "wet" && local > 0) this.feedTrail(rec, pair, p);
      start += pair.len;
    });
  }

  private finish(item: Item) {
    if (item.type === "wash") {
      for (const el of item.els) el.removeAttribute("data-wash");
    } else if (item.type === "mark") {
      item.el.style.clipPath = "";
      item.el.style.opacity = "";
      item.el.style.filter = "";
      item.el.style.color = "";
    }
  }

  private renderNib(active: Item | null) {
    const nib = this.nib;
    const phone = this.phone;
    if (!nib || !phone) return;
    let point: { x: number; y: number } | null = null;
    if (active && (this.treatment === "pen" || this.treatment === "wet")) {
      const phoneRect = phone.getBoundingClientRect();
      const scale = phoneRect.width / phone.offsetWidth || 1;
      if (active.type === "stroke") {
        let start = 0;
        for (const pair of active.rec.pairs) {
          const local = active.dist - start;
          if (local < pair.len) {
            if (local > 0) {
              const pt = pair.a.getPointAtLength(
                (local / pair.len) * pair.lenA,
              );
              const box = active.rec.svg.getBoundingClientRect();
              point = {
                x: (box.left - phoneRect.left) / scale + pt.x,
                y: (box.top - phoneRect.top) / scale + pt.y,
              };
            }
            break;
          }
          start += pair.len;
        }
      } else if (
        active.type === "mark" &&
        active.style === "wipe" &&
        active.geo
      ) {
        const p = clamp01(active.dist / active.geo.len);
        point = { x: active.geo.x + p * active.geo.width, y: active.geo.y };
      }
    }
    if (!point) {
      nib.style.opacity = "0";
      return;
    }
    const r = nib.offsetWidth / 2;
    nib.style.opacity = this.treatment === "wet" ? "1" : "0.9";
    nib.style.transform = `translate(${(point.x - r).toFixed(1)}px, ${(point.y - r).toFixed(1)}px)`;
  }

  // --- Wet trail ------------------------------------------------------------

  private feedTrail(rec: SvgRec, pair: Pair, p: number) {
    let trail = this.trails.find((t) => t.pair === pair);
    if (!trail) {
      const width = Number(pair.a.getAttribute("stroke-width") ?? 1.25);
      const d = pair.a.getAttribute("d") ?? "";
      const bands = WET_WIDTH.map((mul, i) => {
        const band = cloneStroke(rec.svg, pair.a, d);
        band.style.stroke = WET;
        band.style.strokeWidth = String(width * mul);
        band.style.strokeOpacity = String(WET_OPACITY[i]);
        return band;
      });
      trail = { pair, bands, p: 0, speed: this.speedNow, finishedAt: null };
      this.trails.push(trail);
    }
    if (trail.finishedAt !== null) return;
    trail.p = p;
    trail.speed = this.speedNow;
    if (p >= 1) trail.finishedAt = this.now;
  }

  // After the stroke ends the trail keeps sliding off its end, so the head
  // weight settles to ink instead of stopping dark.
  private renderTrail(trail: WetTrail) {
    const len = trail.pair.lenA;
    const head =
      trail.finishedAt === null
        ? trail.p * len
        : len + (trail.speed * (this.now - trail.finishedAt)) / 1000;
    if (head - WET_BANDS[WET_BANDS.length - 1] >= len) {
      for (const band of trail.bands) band.remove();
      return true;
    }
    trail.bands.forEach((band, i) => {
      const s = clamp(head - WET_BANDS[i + 1], 0, len);
      const e = clamp(head - WET_BANDS[i], 0, len);
      if (e - s <= 0.5) {
        band.style.visibility = "hidden";
        return;
      }
      band.style.visibility = "";
      band.style.strokeDasharray = `${(e - s) / len} 2`;
      band.style.strokeDashoffset = String(-s / len);
    });
    return false;
  }

  // --- Stats ------------------------------------------------------------------

  private firstInk(at: number) {
    if (this.stats.firstInkAt !== null) return;
    this.stats.firstInkAt = at;
    this.report();
  }

  private checkDone() {
    if (this.stats.doneAt !== null || this.closedAt === null) return;
    if (this.now < this.closedAt) return;
    let doneAt: number | null = null;
    if (this.pen) {
      if (!this.queue.length && this.lastFinish !== null)
        doneAt = this.lastFinish;
    } else if (
      this.elementEnd !== null &&
      !this.baseline.some((u) => u.kind === "element")
    ) {
      doneAt = this.elementEnd;
    }
    if (doneAt === null) return;
    this.stats.doneAt = doneAt;
    this.report();
    console.info(
      `[ink-options] ${this.treatment}: first ink ${secs(this.stats.firstInkAt ?? 0)}, drawing done ${secs(doneAt)}, s1 closed ${secs(this.closedAt)}, max lag ${this.pen ? `${Math.round(this.stats.maxLag)}ms` : "n/a"}, pen ${this.penRef.current}px/s`,
    );
  }

  private report() {
    this.reportedLag = this.stats.maxLag;
    this.onStats({ ...this.stats });
  }
}

function cloneStroke(svg: SVGSVGElement, source: SVGPathElement, d: string) {
  const path = document.createElementNS(SVG_NS, "path");
  path.dataset.inkClone = "";
  for (const name of [
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
  ]) {
    const value = source.getAttribute(name);
    if (value !== null) path.setAttribute(name, value);
  }
  path.setAttribute("d", d);
  path.setAttribute("pathLength", "1");
  path.style.strokeDasharray = "1 2";
  path.style.strokeDashoffset = "1.05";
  svg.appendChild(path);
  return path;
}

function subpaths(d: string) {
  return d
    .split(/(?=M)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Text leaves (elements with their own text) and lucide icons, DOM order.
function collectMarks(
  el: globalThis.Element,
  out: (HTMLElement | SVGElement)[] = [],
) {
  if (el instanceof SVGElement) {
    if (el.classList.contains("lucide")) out.push(el);
    return out;
  }
  const hasText = Array.from(el.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
  );
  if (hasText && el instanceof HTMLElement) {
    out.push(el);
    return out;
  }
  for (const child of Array.from(el.children)) collectMarks(child, out);
  return out;
}

function setDash(path: SVGPathElement, p: number) {
  path.style.strokeDashoffset = p <= 0 ? "1.05" : String(1 - p);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function clamp01(v: number) {
  return clamp(v, 0, 1);
}

function mixHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) =>
    Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-5) break;
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= err / slope;
    }
    return sampleY(clamp01(t));
  };
}

const standardEase = cubicBezier(0.4, 0, 0.2, 1);
const easeOut = cubicBezier(0, 0, 0.58, 1);

function useFitScale(
  ref: RefObject<HTMLDivElement | null>,
  width: number,
  max: number,
) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(max, entry.contentRect.width / width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, width, max]);
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
