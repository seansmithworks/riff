// How a streamed element's ink animates onto the wireframe canvas
// (docs/plans/riff-real-stream.html, Step 5). The canvas decides what inks
// and when: one element scope mounts per `element` event, and content that
// is already on the canvas never mounts again. A treatment decides only how
// the element draws. Swap ACTIVE_TREATMENT to try another.
//
// Contract, per screen node:
//   treatment.screen(id)          once, when the screen node mounts
//   screen.element(el)            each live element scope, in event order,
//                                 before it paints
//   handle.stroke(stroke)         each Sketch stroke, the first time it has
//                                 geometry (a frame after mount, before
//                                 paint; never again on resize)
//   handle.cancel()               the scope unmounted: stop, and put back
//                                 everything the treatment changed
// The treatment calls el.started() when the element first starts to show
// (its first mark draws, or it has no stroke and its fills or text appear);
// that is the `sketch:first-ink` mark. Repeat calls are ignored.

/**
 * Sketch stroke colors, from DESIGN.md tokens. Pencil is textTertiary
 * (zinc-400): wireframeBorder (zinc-300) read as barely visible on white.
 * Ink is wireframeInk (zinc-700).
 */
export const INK_COLORS = {
  pencil: "#a1a1aa",
  ink: "#3f3f46",
} as const;

export type InkStroke = {
  path: SVGPathElement;
};

export type InkElement = {
  /** The element's own root node: its strokes, text, icons and fills. */
  root: HTMLElement;
  /** Call once, when the element's first mark starts drawing. */
  started(): void;
};

export interface ElementInk {
  stroke(stroke: InkStroke): void;
  cancel(): void;
}

export interface ScreenInk {
  element(element: InkElement): ElementInk;
}

export interface DrawTreatment {
  readonly name: string;
  screen(screenId: string): ScreenInk;
}

const FADE_MS = 280;

function fadeIn(root: HTMLElement): Animation {
  return root.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: FADE_MS,
    easing: "ease-out",
    fill: "backwards",
  });
}

/** prefers-reduced-motion: each element crossfades in, strokes and all. */
export const crossfadeTreatment: DrawTreatment = {
  name: "crossfade",
  screen: () => ({
    element(el) {
      const animation = fadeIn(el.root);
      el.started();
      return { stroke() {}, cancel: () => animation.cancel() };
    },
  }),
};

// ---------------------------------------------------------------------------
// Pen (Sean 2026-09-13, from /dev/ink-options @ 2fa3100). One pen per screen
// walks its elements in arrival order at a constant speed, so a longer
// stroke takes longer. Per element group: its strokes (top-left first), then
// its fills wash in, then its text writes on left to right and its icons
// wipe in. A small nib rides the head.
//
// Sketch's path is drawably's doubled stroke (two overlapping passes per
// shape). The pen hides it and draws one clone per pass, both passes
// together so they read as one stroke. When the stroke is done the clones
// go and Sketch's own path shows again, so later resizes stay Sketch's.
// ---------------------------------------------------------------------------

/** Pen speed, px of stroke or text per second (Sean 2026-09-13). */
const PEN_PX_PER_S = 1200;
/**
 * Catch-up: once the pen is drawing something that arrived more than
 * PEN_CATCHUP_LAG_MS ago, it speeds up to clear its whole queue within
 * PEN_CATCHUP_WINDOW_MS, but never past PEN_MAX_SPEEDUP times PEN_PX_PER_S.
 */
const PEN_CATCHUP_LAG_MS = 800;
const PEN_CATCHUP_WINDOW_MS = 300;
const PEN_MAX_SPEEDUP = 20;
/** A stroke whose path never renders (zero-size box) is skipped after this. */
const STROKE_STALL_MS = 1000;
/** Short text still takes this many px of pen travel to write. */
const MIN_WRITE_PX = 24;
/** The fill wash; matches [data-ink-wash="wet"] in globals.css. */
const WASH_MS = 400;
const NIB_PX = 4.5;

const SVG_NS = "http://www.w3.org/2000/svg";

type Pass = {
  a: SVGPathElement;
  b: SVGPathElement | null;
  lenA: number;
  len: number;
};

type PenStroke = {
  svg: SVGSVGElement;
  source: SVGPathElement | null;
  /** The Sketch `d` the clones trace. */
  d: string;
  passes: Pass[];
  /** Drawn, skipped or cancelled: Sketch's own path shows. */
  settled: boolean;
};

type MarkGeo = {
  len: number;
  offset: number;
  width: number;
  x: number;
  y: number;
};

type Mark = {
  el: HTMLElement | SVGElement;
  /** Text sharing a box with a stroke fades to this color; null wipes. */
  color: string | null;
  geo: MarkGeo | null;
};

type PenElement = {
  ink: InkElement;
  frame: HTMLElement;
  arrival: number;
  strokes: PenStroke[];
  marks: Mark[];
  wash: HTMLElement[];
  timers: number[];
};

type Item = { owner: PenElement; dist: number } & (
  | { type: "stroke"; stroke: PenStroke }
  | { type: "wash"; els: HTMLElement[] }
  | { type: "mark"; mark: Mark }
);

class PenScreen implements ScreenInk {
  private readonly screenId: string;
  private queue: Item[] = [];
  private frame = 0;
  private last = 0;
  private catchUpUntil: number | null = null;
  private nib: HTMLDivElement | null = null;
  private maxLag = 0;
  private peakSpeedup = 1;

  constructor(screenId: string) {
    this.screenId = screenId;
  }

  element(ink: InkElement): ElementInk {
    const owner: PenElement = {
      ink,
      frame: ink.root.closest<HTMLElement>("[data-screen-frame]") ?? ink.root,
      arrival: performance.now(),
      strokes: [],
      marks: [],
      wash: [],
      timers: [],
    };
    this.queue.push(...plan(owner));
    if (!this.frame) {
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }
    return {
      stroke: ({ path }) => {
        const stroke = owner.strokes.find(
          (s) => s.svg === path.ownerSVGElement,
        );
        if (!stroke || stroke.settled || stroke.source) return;
        stroke.source = path;
        path.style.visibility = "hidden";
        trace(stroke);
      },
      cancel: () => this.cancel(owner),
    };
  }

  private tick = (now: number) => {
    // dt is deliberately unclamped. After a hidden tab (no frames), the first
    // frame's budget covers the whole gap, so everything that arrived
    // meanwhile finishes at once. Nobody watched that time; replaying it
    // would put the drawing further behind the stream. Strokes that only get
    // geometry on that first visible frame (no resize events while hidden)
    // finish through catch-up instead.
    const dt = Math.max(0, now - this.last);
    this.last = now;
    this.draw(now, dt);
    if (this.queue.length) {
      this.frame = requestAnimationFrame(this.tick);
    } else {
      this.frame = 0;
      this.idle();
    }
  };

  private draw(now: number, dt: number) {
    const head = this.queue[0];
    if (this.catchUpUntil !== null && (now >= this.catchUpUntil || !head)) {
      this.catchUpUntil = null;
    }
    if (
      this.catchUpUntil === null &&
      head &&
      ready(head) &&
      now - head.owner.arrival > PEN_CATCHUP_LAG_MS
    ) {
      this.catchUpUntil = now + PEN_CATCHUP_WINDOW_MS;
    }
    let speed = PEN_PX_PER_S;
    if (this.catchUpUntil !== null) {
      const remaining = this.queue.reduce(
        (n, item) => n + lengthOf(item) - item.dist,
        0,
      );
      speed = clamp(
        (remaining / Math.max(1, this.catchUpUntil - now)) * 1000,
        PEN_PX_PER_S,
        PEN_PX_PER_S * PEN_MAX_SPEEDUP,
      );
    }
    this.peakSpeedup = Math.max(this.peakSpeedup, speed / PEN_PX_PER_S);

    let budget = dt;
    let active: Item | null = null;
    while (this.queue.length) {
      const item = this.queue[0];
      if (!ready(item)) {
        if (now - item.owner.arrival > STROKE_STALL_MS) {
          settle(item);
          this.queue.shift();
          continue;
        }
        break;
      }
      this.maxLag = Math.max(this.maxLag, now - item.owner.arrival);
      // The pen has reached this element, so it starts to show: its first
      // stroke draws or, with no drawable stroke, its fills wash or its
      // text writes.
      item.owner.ink.started();
      const total = lengthOf(item);
      const needMs = ((total - item.dist) / speed) * 1000;
      if (needMs <= budget) {
        item.dist = total;
        settle(item);
        this.queue.shift();
        budget -= needMs;
        continue;
      }
      item.dist += (speed * budget) / 1000;
      render(item);
      active = item;
      break;
    }
    this.moveNib(active);
  }

  private moveNib(active: Item | null) {
    const point = active && nibPoint(active);
    if (!point) {
      this.nib?.remove();
      return;
    }
    const nib = (this.nib ??= createNib());
    if (nib.parentElement !== point.frame) point.frame.appendChild(nib);
    nib.style.transform = `translate(${(point.x - NIB_PX / 2).toFixed(1)}px, ${(point.y - NIB_PX / 2).toFixed(1)}px)`;
  }

  private cancel(owner: PenElement) {
    this.queue = this.queue.filter((item) => item.owner !== owner);
    owner.timers.forEach(clearTimeout);
    for (const stroke of owner.strokes) {
      stroke.settled = true;
      restoreStroke(stroke);
    }
    for (const el of owner.wash) delete el.dataset.inkWash;
    for (const mark of owner.marks) clearMark(mark);
    if (!this.queue.length && this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.idle();
    }
  }

  private idle() {
    this.nib?.remove();
    this.catchUpUntil = null;
    if (process.env.NODE_ENV !== "production" && this.maxLag > 0) {
      recordPen({
        screen: this.screenId,
        maxLag: Math.round(this.maxLag),
        peakSpeedup: Math.round(this.peakSpeedup * 10) / 10,
      });
    }
    this.maxLag = 0;
    this.peakSpeedup = 1;
  }
}

/** One pen per screen, 1200 px/s, with catch-up. */
export const penTreatment: DrawTreatment = {
  name: "pen",
  screen: (screenId) => new PenScreen(screenId),
};

// Queues an element's marks and hides them until the pen reaches them.
function plan(owner: PenElement): Item[] {
  const root = owner.ink.root;
  const children = Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  const stroked = children.filter((child) =>
    child.querySelector("svg[data-sketch]"),
  );
  const groups = stroked.length >= 2 ? children : [root];
  owner.wash = groups[0] === root ? [root] : [root, ...groups];
  for (const el of owner.wash) el.dataset.inkWash = "dry";

  const items: Item[] = [];
  groups.forEach((group, i) => {
    const svgs = Array.from(
      group.querySelectorAll<SVGSVGElement>("svg[data-sketch]"),
    )
      .map((svg) => ({ svg, box: svg.getBoundingClientRect() }))
      .sort(
        (x, y) =>
          Math.round(x.box.top / 4) - Math.round(y.box.top / 4) ||
          x.box.left - y.box.left,
      );
    for (const { svg } of svgs) {
      const stroke: PenStroke = {
        svg,
        source: null,
        d: "",
        passes: [],
        settled: false,
      };
      owner.strokes.push(stroke);
      items.push({ type: "stroke", owner, stroke, dist: 0 });
    }
    items.push({
      type: "wash",
      owner,
      els: i === 0 && group !== root ? [group, root] : [group],
      dist: 0,
    });
    for (const el of collectMarks(group)) {
      const boxed =
        el instanceof HTMLElement && el.querySelector("svg[data-sketch]");
      const mark: Mark = {
        el,
        color: boxed ? getComputedStyle(el).color : null,
        geo: null,
      };
      if (mark.color === null) el.style.clipPath = "inset(0 100% 0 0)";
      else el.style.color = "transparent";
      owner.marks.push(mark);
      items.push({ type: "mark", owner, mark, dist: 0 });
    }
  });
  return items;
}

function ready(item: Item) {
  return item.type !== "stroke" || item.stroke.passes.length > 0;
}

function lengthOf(item: Item) {
  switch (item.type) {
    case "wash":
      return 0;
    case "stroke":
      return item.stroke.passes.reduce((n, pass) => n + pass.len, 0);
    case "mark":
      return (item.mark.geo ??= measure(item.mark.el, item.owner.frame)).len;
  }
}

function render(item: Item) {
  if (item.type === "stroke") {
    const { stroke } = item;
    // A resize mid-stroke re-traces the clones; progress is kept.
    if (stroke.source && stroke.source.getAttribute("d") !== stroke.d) {
      trace(stroke);
    }
    let start = 0;
    for (const pass of stroke.passes) {
      const p = pass.len ? clamp((item.dist - start) / pass.len, 0, 1) : 1;
      setDash(pass.a, p);
      if (pass.b) setDash(pass.b, p);
      start += pass.len;
    }
  } else if (item.type === "mark" && item.mark.geo) {
    const { el, color, geo } = item.mark;
    const p = clamp(item.dist / geo.len, 0, 1);
    if (color === null) {
      const x = geo.offset + p * geo.width;
      el.style.clipPath = `inset(-4px calc(100% - ${x.toFixed(1)}px) -4px -4px)`;
    } else {
      el.style.color = `color-mix(in srgb, ${color} ${Math.round(p * 100)}%, transparent)`;
    }
  }
}

function settle(item: Item) {
  if (item.type === "stroke") {
    item.stroke.settled = true;
    restoreStroke(item.stroke);
  } else if (item.type === "wash") {
    const { els } = item;
    for (const el of els) el.dataset.inkWash = "wet";
    item.owner.timers.push(
      window.setTimeout(() => {
        for (const el of els) {
          if (el.dataset.inkWash === "wet") delete el.dataset.inkWash;
        }
      }, WASH_MS),
    );
  } else {
    clearMark(item.mark);
  }
}

function trace(stroke: PenStroke) {
  const source = stroke.source;
  if (!source) return;
  for (const pass of stroke.passes) removePass(pass);
  stroke.d = source.getAttribute("d") ?? "";
  const subs = stroke.d
    .split(/(?=M)/)
    .map((s) => s.trim())
    .filter(Boolean);
  stroke.passes = [];
  for (let i = 0; i < subs.length; i += 2) {
    const a = clonePass(stroke.svg, source, subs[i]);
    const b = subs[i + 1] ? clonePass(stroke.svg, source, subs[i + 1]) : null;
    const lenA = a.getTotalLength();
    stroke.passes.push({
      a,
      b,
      lenA,
      len: Math.max(lenA, b ? b.getTotalLength() : 0),
    });
  }
}

function restoreStroke(stroke: PenStroke) {
  for (const pass of stroke.passes) removePass(pass);
  stroke.passes = [];
  if (stroke.source) stroke.source.style.visibility = "";
}

function removePass(pass: Pass) {
  pass.a.remove();
  pass.b?.remove();
}

function clonePass(svg: SVGSVGElement, source: SVGPathElement, d: string) {
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

// pathLength 1 with dash 1, gap 2: at offset 1.05 nothing (not even a round
// cap) shows, so the pass draws from its start as the offset reaches 0.
function setDash(path: SVGPathElement, p: number) {
  path.style.strokeDashoffset = p <= 0 ? "1.05" : String(1 - p);
}

function clearMark(mark: Mark) {
  mark.el.style.clipPath = "";
  mark.el.style.color = "";
}

// Text leaves (elements with their own text) and lucide icons, DOM order.
function collectMarks(
  el: Element,
  out: (HTMLElement | SVGElement)[] = [],
): (HTMLElement | SVGElement)[] {
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

// The frame's unscaled CSS px origin (inside its border) and its canvas zoom.
function frameSpace(frame: HTMLElement) {
  const box = frame.getBoundingClientRect();
  const scale = box.width / frame.offsetWidth || 1;
  return {
    left: box.left + frame.clientLeft * scale,
    top: box.top + frame.clientTop * scale,
    scale,
  };
}

function measure(el: HTMLElement | SVGElement, frame: HTMLElement): MarkGeo {
  const space = frameSpace(frame);
  const elBox = el.getBoundingClientRect();
  let box: DOMRect = elBox;
  if (el instanceof HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const textBox = range.getBoundingClientRect();
    if (textBox.width > 0) box = textBox;
  }
  const width = Math.min(box.width, elBox.right - box.left) / space.scale;
  return {
    offset: Math.max(0, (box.left - elBox.left) / space.scale),
    width,
    x: (box.left - space.left) / space.scale,
    y: (box.top - space.top + box.height * 0.8) / space.scale,
    len: Math.max(width, MIN_WRITE_PX),
  };
}

function nibPoint(
  item: Item,
): { frame: HTMLElement; x: number; y: number } | null {
  const { frame } = item.owner;
  if (item.type === "stroke") {
    let start = 0;
    for (const pass of item.stroke.passes) {
      const local = item.dist - start;
      if (local < pass.len) {
        if (local <= 0) return null;
        const pt = pass.a.getPointAtLength((local / pass.len) * pass.lenA);
        const space = frameSpace(frame);
        const box = item.stroke.svg.getBoundingClientRect();
        return {
          frame,
          x: (box.left - space.left) / space.scale + pt.x,
          y: (box.top - space.top) / space.scale + pt.y,
        };
      }
      start += pass.len;
    }
    return null;
  }
  if (item.type === "mark" && item.mark.color === null && item.mark.geo) {
    const { geo } = item.mark;
    const p = clamp(item.dist / geo.len, 0, 1);
    return { frame, x: geo.x + p * geo.width, y: geo.y };
  }
  return null;
}

function createNib() {
  const nib = document.createElement("div");
  nib.dataset.inkNib = "";
  nib.setAttribute("aria-hidden", "true");
  Object.assign(nib.style, {
    position: "absolute",
    left: "0",
    top: "0",
    zIndex: "10",
    width: `${NIB_PX}px`,
    height: `${NIB_PX}px`,
    borderRadius: "9999px",
    background: INK_COLORS.ink,
    opacity: "0.9",
    pointerEvents: "none",
  });
  return nib;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

type PenRecord = {
  at: number;
  screen: string;
  maxLag: number;
  peakSpeedup: number;
};

// Dev-only pen log: window.__riffPen, one entry each time a screen's pen
// goes idle (max lag and peak catch-up since it last went idle).
function recordPen(entry: Omit<PenRecord, "at">) {
  const w = window as unknown as { __riffPen?: PenRecord[] };
  (w.__riffPen ??= []).push({ at: Math.round(performance.now()), ...entry });
}

export const ACTIVE_TREATMENT: DrawTreatment = penTreatment;

export function treatmentFor(reducedMotion: boolean): DrawTreatment {
  return reducedMotion ? crossfadeTreatment : ACTIVE_TREATMENT;
}
