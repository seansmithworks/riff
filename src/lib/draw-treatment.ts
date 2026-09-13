// How a streamed element's ink animates onto the wireframe canvas
// (docs/plans/riff-real-stream.html, Step 5). The canvas decides what inks
// and when: one element scope mounts per `element` event, and content that
// is already on the canvas never mounts again. A treatment decides only how
// the element draws. Swap ACTIVE_TREATMENT to try another.
//
// Contract, per screen node:
//   treatment.screen(id)          once, when the screen node mounts
//   screen.element(el)            each live element scope, in event order
//   handle.stroke(stroke)         each Sketch stroke, the first time it has
//                                 geometry (a frame after mount; never again
//                                 on resize)
//   handle.cancel()               the scope unmounted
// The treatment calls el.started() once, when the element's first mark
// starts to draw; that is the `sketch:first-ink` mark.
//
// A pen treatment (one pen per screen, elements drawn in sequence at a
// constant px/s, with a catch-up rule) fits as: per-screen pen state lives in
// the object screen() returns; strokes queue with their px length; text,
// icons and fills stay hidden via el.content until the pen reaches them.

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
  /** DOM-order position among the element's strokes. */
  index: number;
  /** Rendered path length in px. */
  length: number;
};

export type InkElement = {
  /** The element's scope node: its strokes, text, icons and fills. */
  root: HTMLElement;
  /** Strokes this element hands over, known at mount. */
  strokeCount: number;
  /** Text reveal hook: hides text, icons and fills; strokes stay visible. */
  content: { hide(): void; show(): void };
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

const STROKE_MS = 280;
const STAGGER_MS = 35;
const ELEMENT_CAP_MS = 1200;

function fadeIn(root: HTMLElement): Animation {
  return root.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: STROKE_MS,
    easing: "ease-out",
    fill: "backwards",
  });
}

// pathLength 1 with dash 1, gap 2: at offset 1.05 nothing (not even a round
// cap) shows, so the stroke draws from its start as the offset reaches 0.
function drawStroke(path: SVGPathElement, delay: number): Animation {
  path.setAttribute("pathLength", "1");
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
  const clear = () => {
    path.removeAttribute("pathLength");
    path.style.strokeDasharray = "";
  };
  animation.onfinish = clear;
  animation.oncancel = clear;
  return animation;
}

/**
 * Each element draws on its own clock as it lands: strokes 280ms apiece,
 * 35ms apart in DOM order (compressed so one element finishes within 1.2s),
 * and the element's text fades in with its first stroke.
 */
export const drawInTreatment: DrawTreatment = {
  name: "draw-in",
  screen: () => ({
    element(el) {
      const begunAt = performance.now();
      const stagger =
        el.strokeCount > 1
          ? Math.min(
              STAGGER_MS,
              (ELEMENT_CAP_MS - STROKE_MS) / (el.strokeCount - 1),
            )
          : 0;
      const animations = [fadeIn(el.root)];
      const timers: number[] = [];
      let startSent = el.strokeCount === 0;
      if (startSent) el.started();
      return {
        stroke({ path, index }) {
          const delay = Math.max(
            0,
            index * stagger - (performance.now() - begunAt),
          );
          animations.push(drawStroke(path, delay));
          if (startSent) return;
          startSent = true;
          if (delay === 0) el.started();
          else timers.push(window.setTimeout(el.started, delay));
        },
        cancel() {
          timers.forEach(clearTimeout);
          animations.forEach((animation) => animation.cancel());
        },
      };
    },
  }),
};

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

export const ACTIVE_TREATMENT: DrawTreatment = drawInTreatment;

export function treatmentFor(reducedMotion: boolean): DrawTreatment {
  return reducedMotion ? crossfadeTreatment : ACTIVE_TREATMENT;
}
