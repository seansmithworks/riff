import { roughLine, roughEllipse, roughRoundedRect } from "drawably";
import {
  SKETCH_ROUGHNESS,
  SKETCH_LINE_ROUGHNESS,
  INK,
  hashSeed,
  firstStroke,
  secondStroke,
  roundRectPath,
} from "./constants";
import type { CinderConfig } from "./types";
import type { LandingImpact } from "./sequence";
import type { DotGrid } from "./dotGrid";
// Type-only: build.ts type-imports Frame/BuiltPath from here, so this stays
// type-only to avoid a runtime circular module dependency.
import type { BuildPlan, BuildPath } from "./build";
import { sampleAt, BUILD_PASS_B_TRAIL } from "./build";

type FrameElement = {
  id: string;
  kind: "rect" | "line" | "cross" | "circle";
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  cx?: number;
  cy?: number;
  // Optional override of the derived tier (build-plan.md §2).
  tier?: 0 | 1 | 2;
};

type FrameDef = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  elements: FrameElement[];
};

export const FRAME_DEFS: FrameDef[] = [
  {
    id: "frameA",
    x: 360,
    y: 130,
    w: 300,
    h: 560,
    elements: [
      { id: "header-rect", kind: "rect", x: 18, y: 18, w: 264, h: 48, r: 8 },
      { id: "header-line", kind: "line", x: 34, y: 42, w: 140 },
      { id: "image-rect", kind: "rect", x: 18, y: 84, w: 264, h: 160, r: 8 },
      { id: "image-cross", kind: "cross", x: 18, y: 84, w: 264, h: 160 },
      { id: "title-line", kind: "line", x: 18, y: 270, w: 180 },
      { id: "body1-line", kind: "line", x: 18, y: 296, w: 264 },
      { id: "body2-line", kind: "line", x: 18, y: 318, w: 210 },
      { id: "input-rect", kind: "rect", x: 18, y: 356, w: 264, h: 36, r: 8 },
      { id: "button-rect", kind: "rect", x: 18, y: 484, w: 264, h: 44, r: 22 },
    ],
  },
  {
    id: "frameB",
    x: 780,
    y: 130,
    w: 300,
    h: 560,
    elements: [
      { id: "avatar", kind: "circle", cx: 52, cy: 56, r: 26 },
      { id: "header-line1", kind: "line", x: 96, y: 44, w: 150 },
      { id: "header-line2", kind: "line", x: 96, y: 64, w: 100 },
      { id: "divider", kind: "line", x: 18, y: 106, w: 264 },
      { id: "row1-rect", kind: "rect", x: 18, y: 126, w: 264, h: 64, r: 8 },
      { id: "row1-cross", kind: "cross", x: 26, y: 134, w: 48, h: 48 },
      { id: "row1-line1", kind: "line", x: 86, y: 150, w: 150 },
      { id: "row1-line2", kind: "line", x: 86, y: 170, w: 110 },
      { id: "row2-rect", kind: "rect", x: 18, y: 202, w: 264, h: 64, r: 8 },
      { id: "row2-cross", kind: "cross", x: 26, y: 210, w: 48, h: 48 },
      { id: "row2-line1", kind: "line", x: 86, y: 226, w: 150 },
      { id: "row2-line2", kind: "line", x: 86, y: 246, w: 110 },
      { id: "row3-rect", kind: "rect", x: 18, y: 278, w: 264, h: 64, r: 8 },
      { id: "row3-cross", kind: "cross", x: 26, y: 286, w: 48, h: 48 },
      { id: "row3-line1", kind: "line", x: 86, y: 302, w: 150 },
      { id: "row3-line2", kind: "line", x: 86, y: 322, w: 110 },
      { id: "fab", kind: "circle", cx: 246, cy: 512, r: 24 },
    ],
  },
];

export type PathSample = { x: number; y: number; angle: number; cum: number };

export type BuiltPath = {
  d: string;
  strokeWidth: number;
  path2d: Path2D;
  len: number;
  // Load-bearing-bug fix (build-plan.md §3): every drawably path is two
  // subpaths ("hand passes"). Pass A/B are split at the second `M` so a
  // dash-based reveal can time them independently instead of both finishing
  // by t=0.5. `samples` is pass A only, fixed ~8px spacing with cumulative
  // arclength, computed once here (never via getPointAtLength per frame).
  passA: Path2D;
  passB: Path2D | null;
  lenA: number;
  lenB: number;
  samples: PathSample[];
};
export type BuiltElement = FrameElement & BuiltPath & { tier: 0 | 1 | 2 };
export type BuiltGuide = BuiltPath & { id: string };
type FramePaths = {
  outline: BuiltPath;
  // Tier 0.5 construction guides, generated from the frame rect — honest at
  // any platform (dotgrid-addendum.md §3): header/footer bands, side
  // margins.
  guides: BuiltGuide[];
  elements: BuiltElement[];
};
export type Frame = FrameDef & {
  landed: boolean;
  landStartedAt: number;
  paths: FramePaths;
};

function deriveTier(el: FrameElement): 0 | 1 | 2 {
  if (el.tier !== undefined) return el.tier;
  return el.kind === "rect" || el.kind === "circle" ? 1 : 2;
}

// World-space anchor used to order tier 1/2 paths "y then x" (build-plan.md
// §2) — build.ts calls this rather than duplicating frame-element geometry.
export function elementWorldPos(
  frame: FrameDef,
  el: FrameElement,
): { x: number; y: number } {
  if (el.kind === "circle") return { x: frame.x + el.cx!, y: frame.y + el.cy! };
  return { x: frame.x + (el.x ?? 0), y: frame.y + (el.y ?? 0) };
}

function sampleFixedSpacing(
  measurePath: SVGPathElement,
  d: string,
  len: number,
  spacing: number,
): PathSample[] {
  if (!d || len <= 0) return [{ x: 0, y: 0, angle: 0, cum: 0 }];
  measurePath.setAttribute("d", d);
  const n = Math.max(1, Math.round(len / spacing));
  const samples: PathSample[] = [];
  for (let i = 0; i <= n; i++) {
    const l0 = Math.min(len, (i / n) * len);
    const l1 = Math.min(len, l0 + 1);
    const p0 = measurePath.getPointAtLength(l0);
    const p1 = measurePath.getPointAtLength(l1);
    samples.push({
      x: p0.x,
      y: p0.y,
      angle: Math.atan2(p1.y - p0.y, p1.x - p0.x),
      cum: l0,
    });
  }
  return samples;
}

function buildPathParts(
  d: string,
  strokeWidth: number,
  measurePath: SVGPathElement,
): BuiltPath {
  measurePath.setAttribute("d", d);
  const len = measurePath.getTotalLength();
  const dA = firstStroke(d);
  const dB = secondStroke(d);
  measurePath.setAttribute("d", dA);
  const lenA = measurePath.getTotalLength();
  let lenB = 0;
  let passB: Path2D | null = null;
  if (dB) {
    measurePath.setAttribute("d", dB);
    lenB = measurePath.getTotalLength();
    passB = new Path2D(dB);
  }
  const samples = sampleFixedSpacing(measurePath, dA, lenA, 8);
  return {
    d,
    strokeWidth,
    path2d: new Path2D(d),
    len,
    passA: new Path2D(dA),
    passB,
    lenA,
    lenB,
    samples,
  };
}

function buildElementPath(
  frame: FrameDef,
  el: FrameElement,
  measurePath: SVGPathElement,
): BuiltPath {
  const ax = frame.x + (el.x ?? 0);
  const ay = frame.y + (el.y ?? 0);
  const seed = hashSeed(`${frame.id}:${el.id}`);
  const opts = { seed, roughness: SKETCH_ROUGHNESS, boil: 0 };
  let d = "",
    strokeWidth = 1.25;
  if (el.kind === "rect") {
    d = roughRoundedRect(ax, ay, el.w!, el.h!, el.r ?? 0, opts);
  } else if (el.kind === "circle") {
    const cx = frame.x + el.cx!,
      cy = frame.y + el.cy!;
    d = roughEllipse(cx, cy, el.r!, el.r!, opts);
  } else if (el.kind === "cross") {
    d =
      roughLine(ax, ay, ax + el.w!, ay + el.h!, opts) +
      roughLine(ax + el.w!, ay, ax, ay + el.h!, { ...opts, seed: seed + 1 });
  } else {
    d = firstStroke(
      roughLine(ax, ay, ax + el.w!, ay, {
        ...opts,
        roughness: SKETCH_LINE_ROUGHNESS,
      }),
    );
    strokeWidth = 1;
  }
  return buildPathParts(d, strokeWidth, measurePath);
}

// Tier 0.5 — construction guides generated from the frame rect: a header
// band, a footer/bottom-bar band, and two side margins. Honest at any
// platform guess since they never encode the real layout (build-plan.md §1).
function buildGuides(
  frame: FrameDef,
  measurePath: SVGPathElement,
): BuiltGuide[] {
  const seedBase = hashSeed(`${frame.id}:guide`);
  const inset = 18;
  const bandY = 64;
  const specs: {
    id: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }[] = [
    {
      id: "guide-header",
      x1: frame.x + inset,
      y1: frame.y + bandY,
      x2: frame.x + frame.w - inset,
      y2: frame.y + bandY,
    },
    {
      id: "guide-footer",
      x1: frame.x + inset,
      y1: frame.y + frame.h - bandY,
      x2: frame.x + frame.w - inset,
      y2: frame.y + frame.h - bandY,
    },
    {
      id: "guide-left",
      x1: frame.x + inset,
      y1: frame.y + bandY,
      x2: frame.x + inset,
      y2: frame.y + frame.h - bandY,
    },
    {
      id: "guide-right",
      x1: frame.x + frame.w - inset,
      y1: frame.y + bandY,
      x2: frame.x + frame.w - inset,
      y2: frame.y + frame.h - bandY,
    },
  ];
  return specs.map((s, i) => {
    const d = firstStroke(
      roughLine(s.x1, s.y1, s.x2, s.y2, {
        seed: seedBase + i,
        roughness: SKETCH_LINE_ROUGHNESS,
        boil: 0,
      }),
    );
    return { id: s.id, ...buildPathParts(d, 1, measurePath) };
  });
}

function buildFramePaths(
  frame: FrameDef,
  measurePath: SVGPathElement,
): FramePaths {
  const outlineSeed = hashSeed(`${frame.id}:outline`);
  const outlineD = roughRoundedRect(frame.x, frame.y, frame.w, frame.h, 26, {
    seed: outlineSeed,
    roughness: SKETCH_ROUGHNESS,
    boil: 0,
  });
  const outline = buildPathParts(outlineD, 1.75, measurePath);
  const guides = buildGuides(frame, measurePath);
  const elements: BuiltElement[] = frame.elements.map((el) => ({
    ...el,
    tier: deriveTier(el),
    ...buildElementPath(frame, el, measurePath),
  }));
  return { outline, guides, elements };
}

export function createFrames(measurePath: SVGPathElement): Frame[] {
  return FRAME_DEFS.map((def) => ({
    ...def,
    landed: false,
    landStartedAt: 0,
    paths: buildFramePaths(def, measurePath),
  }));
}

export function resetFrames(frames: Frame[]) {
  for (const f of frames) {
    f.landed = false;
    f.landStartedAt = 0;
  }
}

// ---- Cinders --------------------------------------------------------------

export type Cinder = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  len: number;
  frameId: string;
  phase: "drift" | "snap";
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  targetAngle: number;
  landStart: number;
  flightMs?: number;
  // F6 (morph spec §2): set instead of wiping the array on job start/clear
  // when a Morph style is active, so old cinders fade over cinderDieMs
  // rather than vanishing in one frame.
  dieAt?: number;
};

export type DustPuff = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  len: number;
  rot: number;
};

export function windAt(x: number, y: number, t: number) {
  const a = Math.sin(x * 0.008 + t * 0.0006) + Math.cos(y * 0.011 - t * 0.0004);
  const b = Math.cos(x * 0.009 - t * 0.0005) + Math.sin(y * 0.007 + t * 0.0007);
  return { x: a, y: b - 1.1 };
}

export function spawnDustPuff(
  origin: { x: number; y: number },
  cfg: CinderConfig,
  dustPuffs: DustPuff[],
  t: number,
) {
  for (let i = 0; i < cfg.burstSize; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const speed = 0.6 + Math.random() * 1.2;
    dustPuffs.push({
      x: origin.x + (Math.random() - 0.5) * 16,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      born: t,
      life: 700 + Math.random() * 300,
      len: 3 + Math.random() * 3,
      rot: angle,
    });
  }
}

// Landing tip-spark burst (spec §3.8) — modeled on spawnDustPuff, but
// launches from the active mark's live ray tips (falling back to origin)
// instead of the disc, so the "sketch job speaks through the mark" moment
// reads at the landing.
export function spawnTipSparks(
  origin: { x: number; y: number },
  emitters: { x: number; y: number; angle: number }[],
  n: number,
  dustPuffs: DustPuff[],
  t: number,
) {
  for (let i = 0; i < n; i++) {
    const emitter = emitters.length
      ? emitters[Math.floor(Math.random() * emitters.length)]
      : null;
    const baseAngle = emitter ? emitter.angle : -Math.PI / 2;
    const angle = baseAngle + (Math.random() - 0.5) * 0.9;
    const speed = 0.8 + Math.random() * 1.6;
    dustPuffs.push({
      x: emitter ? emitter.x : origin.x + (Math.random() - 0.5) * 16,
      y: emitter ? emitter.y : origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      born: t,
      life: 500 + Math.random() * 300,
      len: 3 + Math.random() * 4,
      rot: angle,
    });
  }
}

export function spawnCinder(
  origin: { x: number; y: number },
  frames: Frame[],
  t: number,
  cinders: Cinder[],
  // Sparks off ray tips: when provided, the cinder launches from the tip
  // point, flying outward along the ray's own direction, then joins the
  // same wind field and landing behavior as an origin-spawned cinder.
  emitter?: { x: number; y: number; angle: number },
) {
  const angle = emitter
    ? emitter.angle
    : -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
  const speed = 0.7 + Math.random() * 0.8;
  const frameId = frames[Math.floor(Math.random() * frames.length)].id;
  const x = emitter ? emitter.x : origin.x + (Math.random() - 0.5) * 24;
  const y = emitter ? emitter.y : origin.y;
  cinders.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    born: t,
    len: 3 + Math.random() * 3,
    frameId,
    phase: "drift",
    startX: 0,
    startY: 0,
    targetX: 0,
    targetY: 0,
    targetAngle: 0,
    landStart: 0,
  });
}

export function updateCinderDrift(
  c: Cinder,
  frames: Frame[],
  t: number,
  dt: number,
  sketchStartTime: number,
  cfg: CinderConfig,
) {
  const frame = frames.find((f) => f.id === c.frameId)!;
  const wind = windAt(c.x, c.y, t);
  const elapsed = t - sketchStartTime;
  const pullStrength = Math.min(0.85, elapsed / 9000);
  const cx = frame.x + frame.w / 2,
    cy = frame.y + frame.h / 2;
  const dx = cx - c.x,
    dy = cy - c.y;
  const dist = Math.hypot(dx, dy) || 1;
  const orbitR = Math.max(frame.w, frame.h) / 2 + 12;
  let ax: number, ay: number;
  if (dist > orbitR) {
    ax = (dx / dist) * pullStrength * 0.03 + wind.x * cfg.windStrength * 0.012;
    ay = (dy / dist) * pullStrength * 0.03 + wind.y * cfg.windStrength * 0.012;
  } else {
    const tx = -dy / dist,
      ty = dx / dist;
    ax = tx * 0.03 + wind.x * cfg.windStrength * 0.006;
    ay = ty * 0.03 + wind.y * cfg.windStrength * 0.006 - 0.004;
  }
  c.vx = c.vx * 0.95 + ax;
  c.vy = c.vy * 0.95 + ay;
  const clampSpeed = 1.6;
  const sp = Math.hypot(c.vx, c.vy);
  if (sp > clampSpeed) {
    c.vx = (c.vx / sp) * clampSpeed;
    c.vy = (c.vy / sp) * clampSpeed;
  }
  c.x += c.vx * dt * 0.06;
  c.y += c.vy * dt * 0.06;
}

// Ensures a floor of orbiting "drift" cinders exists at landing, for build.ts
// to recruit (by bearing sort) as spark launch points — resets frames'
// landed flags/timestamp so the white-card fade-in and build reveal restart
// cleanly. No longer assigns per-cinder landing targets: the pooled
// BuildParticle system (build.ts) owns all landing motion now.
export function beginLanding(
  frames: Frame[],
  cinders: Cinder[],
  cfg: CinderConfig,
  t: number,
): Cinder[] {
  resetFrames(frames);
  for (const f of frames) f.landStartedAt = t;
  if (cinders.filter((c) => c.phase === "drift").length >= 20) return cinders;
  const next: Cinder[] = [...cinders];
  for (const f of frames) {
    const n = Math.min(160, cfg.cinderCap / frames.length);
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const pad = 16 + Math.random() * 40;
      const rx = f.w / 2 + pad,
        ry = f.h / 2 + pad;
      next.push({
        x: f.x + f.w / 2 + Math.cos(angle) * rx,
        y: f.y + f.h / 2 + Math.sin(angle) * ry,
        vx: 0,
        vy: 0,
        born: t,
        len: 3 + Math.random() * 3,
        frameId: f.id,
        phase: "drift",
        startX: 0,
        startY: 0,
        targetX: 0,
        targetY: 0,
        targetAngle: 0,
        landStart: 0,
      });
    }
  }
  return next;
}

export function easeOutBack(x: number): number {
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---- Frame + cinder rendering ----------------------------------------------

// Stroke-bleed hook (voice-lab-dotgrid-addendum.md §4): fired once per
// actively-inking path per frame, with the ink head's current world-space
// point, so the caller (engine.ts) can bleed a faint wash onto nearby
// dot-grid paper.
export type InkAdvanceCallback = (x: number, y: number) => void;

export type SpeculativeOpts = {
  speculativeFrame: "off" | "construction" | "full";
  guideDots: "off" | "dots" | "dotsLines";
  dotGrid: DotGrid | null;
  reducedMotion: boolean;
};

export type BuildRenderOpts = {
  dotGrid: DotGrid | null;
  snapToGrid: boolean;
  dotPop: number;
};

function strokeShape(
  ctx: CanvasRenderingContext2D,
  path2d: Path2D,
  width: number,
  alphaMul = 1,
) {
  ctx.save();
  ctx.globalAlpha = alphaMul;
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(path2d);
  ctx.restore();
}

function drawPassReveal(
  ctx: CanvasRenderingContext2D,
  path2d: Path2D,
  len: number,
  t: number,
  strokeWidth: number,
) {
  if (len <= 0 || t <= 0) return;
  const clamped = Math.min(1, t);
  ctx.save();
  ctx.setLineDash([len, len]);
  ctx.lineDashOffset = len * (1 - clamped);
  ctx.strokeStyle = INK;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(path2d);
  ctx.restore();
}

// Draws one build-plan path's ink reveal at fraction `prog` (0-1 across its
// own startMs/durMs window) — pass A sweeps the full window, pass B trails
// by BUILD_PASS_B_TRAIL (build-plan.md's "second hand-pass"). Reads the
// current head position from the path's cached samples (sampleAt, binary
// search) rather than measurePath.getPointAtLength, so this is safe to call
// every frame for every in-flight path.
function drawBuildPathInk(
  ctx: CanvasRenderingContext2D,
  bp: BuildPath,
  prog: number,
  onInkAdvance: InkAdvanceCallback | undefined,
  opts: BuildRenderOpts,
  reducedMotion: boolean,
) {
  // Reduced motion: tiers crossfade in (plain alpha, full shape) rather than
  // sweeping a dash reveal — no traveling stroke to draw.
  if (reducedMotion) {
    ctx.save();
    ctx.globalAlpha = prog;
    ctx.strokeStyle = INK;
    ctx.lineWidth = bp.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(bp.passA);
    if (bp.passB) ctx.stroke(bp.passB);
    ctx.restore();
    return;
  }
  const tA = prog;
  const tB = clamp01((prog - BUILD_PASS_B_TRAIL) / (1 - BUILD_PASS_B_TRAIL));
  drawPassReveal(ctx, bp.passA, bp.lenA, tA, bp.strokeWidth);
  if (bp.passB && bp.lenB > 0)
    drawPassReveal(ctx, bp.passB, bp.lenB, tB, bp.strokeWidth);
  if (bp.samples.length === 0 || bp.lenA <= 0) return;
  const headLen = bp.lenA * Math.min(1, tA);
  const head = sampleAt(bp.samples, headLen);
  if (onInkAdvance && tA > 0 && tA < 1) onInkAdvance(head.x, head.y);
  if (opts.dotGrid && opts.snapToGrid) {
    const idx = opts.dotGrid.nearestDot(head.x, head.y);
    opts.dotGrid.lightDot(idx, 0.5 + opts.dotPop * 0.5);
  }
}

// Honest speculative layer during the wait (build-plan.md §1): device
// outline + construction guides, never element geometry. Off draws nothing;
// Construction lights dot-grid dots along the outline/guide paths (plus an
// optional faint line read); Full ink strokes them outright.
function drawSpeculativeFrame(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  opts: SpeculativeOpts,
) {
  if (opts.speculativeFrame === "off") return;
  if (opts.speculativeFrame === "full") {
    strokeShape(ctx, f.paths.outline.path2d, f.paths.outline.strokeWidth);
    for (const g of f.paths.guides) strokeShape(ctx, g.path2d, 1);
    return;
  }
  if (opts.guideDots === "off" || !opts.dotGrid) return;
  const dg = opts.dotGrid;
  const allPaths: BuiltPath[] = [f.paths.outline, ...f.paths.guides];
  for (const p of allPaths) {
    for (const s of p.samples) {
      const idx = dg.nearestDot(s.x, s.y);
      dg.lightDot(idx, opts.reducedMotion ? 0.5 : 0.35);
    }
  }
  if (opts.guideDots === "dotsLines") {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#a1a1aa";
    ctx.lineWidth = 1;
    ctx.stroke(f.paths.outline.path2d);
    for (const g of f.paths.guides) ctx.stroke(g.path2d);
    ctx.restore();
  }
}

export function drawFrames(
  ctx: CanvasRenderingContext2D,
  frames: Frame[],
  t: number,
  cfg: CinderConfig,
  impact: LandingImpact,
  onInkAdvance: InkAdvanceCallback | undefined,
  plan: BuildPlan | null,
  speculative: SpeculativeOpts,
  buildOpts: BuildRenderOpts,
  // F6 (morph spec §2): a Morph style's clear drives this down over
  // clearMs instead of nulling the plan in one frame — 1 = today's behavior.
  alphaMul = 1,
) {
  if (alphaMul <= 0.01) return;
  for (const f of frames) {
    if (!plan) {
      drawSpeculativeFrame(ctx, f, speculative);
      continue;
    }
    const framePaths = plan.pathsByFrame.get(f.id);
    // Stream prototype: a frame whose part hasn't arrived has no paths in the
    // job's running plan yet, so it keeps its speculative look (the outline
    // head) until it inks. Batch plans always cover every frame.
    if (!framePaths) {
      drawSpeculativeFrame(ctx, f, speculative);
      continue;
    }
    ctx.save();
    ctx.globalAlpha =
      (f.landed ? 1 : Math.min(1, (t - f.landStartedAt) / cfg.landDurationMs)) *
      alphaMul;
    ctx.shadowColor = "rgba(0,0,0,0.12)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = "#ffffff";
    roundRectPath(ctx, f.x, f.y, f.w, f.h, 26);
    ctx.fill();
    ctx.restore();

    if (f.landed) {
      strokeShape(
        ctx,
        f.paths.outline.path2d,
        f.paths.outline.strokeWidth,
        alphaMul,
      );
      for (const el of f.paths.elements)
        strokeShape(ctx, el.path2d, el.strokeWidth, alphaMul);
      continue;
    }

    let allDone = framePaths.length > 0;
    for (const bp of framePaths) {
      const prog = clamp01((t - (plan.startAt + bp.startMs)) / bp.durMs);
      if (prog <= 0) {
        allDone = false;
        continue;
      }
      drawBuildPathInk(
        ctx,
        bp,
        prog,
        onInkAdvance,
        buildOpts,
        plan.reducedMotion,
      );
      if (prog >= 1) bp.landed = true;
      else allDone = false;
    }

    const tier2 = plan.tier2ByFrame.get(f.id);
    if (tier2 && tier2.paths.every((p) => p.landed)) {
      const { lastEnd } = tier2;
      const settleMs = cfg.landDurationMs * (160 / 900);
      const settleT = clamp01((t - (plan.startAt + lastEnd)) / settleMs);
      const squashScale =
        impact.kind === "squash"
          ? 1 + (easeOutBack(settleT) - 1) * 0.12 * impact.bounce
          : 1;
      if (squashScale !== 1) {
        ctx.save();
        const cx = f.x + f.w / 2,
          cy = f.y + f.h / 2;
        ctx.translate(cx, cy);
        ctx.scale(squashScale, squashScale);
        ctx.translate(-cx, -cy);
      }
      if (impact.kind !== "none") drawImpactMarks(ctx, f, settleT);
      if (squashScale !== 1) ctx.restore();
      if (settleT >= 1) f.landed = allDone;
    }
  }
}

function drawImpactMarks(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  settleT: number,
) {
  const corners: [number, number][] = [
    [f.x, f.y],
    [f.x + f.w, f.y],
    [f.x, f.y + f.h],
    [f.x + f.w, f.y + f.h],
  ];
  const alpha = 1 - settleT;
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.25;
  ctx.lineCap = "round";
  for (const [cx, cy] of corners) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + (hashSeed(f.id + i) % 10);
      const r0 = 4,
        r1 = 4 + 10 * settleT;
      const seed = hashSeed(`${f.id}:${cx}:${cy}:${i}`);
      const d = roughLine(
        cx + Math.cos(a) * r0,
        cy + Math.sin(a) * r0,
        cx + Math.cos(a) * r1,
        cy + Math.sin(a) * r1,
        { seed, roughness: SKETCH_ROUGHNESS, boil: 0 },
      );
      ctx.stroke(new Path2D(d));
    }
  }
  ctx.restore();
}

export function drawCinders(
  ctx: CanvasRenderingContext2D,
  cinders: Cinder[],
  dustPuffs: DustPuff[],
  origin: { x: number; y: number },
  t: number,
  duckAlpha = 1,
  cinderDieMs = 0,
) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  for (const c of cinders) {
    if (c.phase === "drift") {
      // Wait embers (build-plan.md §2): fade over a longer travel distance
      // so the raised wait-floor spawn rate reads as longer-lived embers,
      // not just more of them dying at the same pace.
      const distFromOrigin = Math.hypot(c.x - origin.x, c.y - origin.y);
      const fade = Math.max(0.15, 1 - distFromOrigin / 1200);
      // F6: a Morph style's job start/clear sets dieAt instead of wiping the
      // array, so old cinders ease out over cinderDieMs.
      const dieFade =
        c.dieAt && cinderDieMs > 0
          ? Math.max(0, 1 - (t - c.dieAt) / cinderDieMs)
          : 1;
      if (dieFade <= 0) continue;
      const angle = Math.atan2(c.vy, c.vx);
      const hl = c.len / 2;
      ctx.globalAlpha = fade * 0.8 * duckAlpha * dieFade;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(c.x - Math.cos(angle) * hl, c.y - Math.sin(angle) * hl);
      ctx.lineTo(c.x + Math.cos(angle) * hl, c.y + Math.sin(angle) * hl);
      ctx.stroke();
    } else if (c.phase === "snap") {
      const p = (t - c.landStart) / (c.flightMs ?? 1);
      if (p < 0 || p >= 1) continue;
      const eased = easeOutBack(Math.min(1, p));
      const x = c.startX + (c.targetX - c.startX) * eased;
      const y = c.startY + (c.targetY - c.startY) * eased;
      const stretch = 3 + 6 * Math.min(1, p * 1.4);
      const a = c.targetAngle;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(a) * stretch, y - Math.sin(a) * stretch);
      ctx.lineTo(x + Math.cos(a) * stretch, y + Math.sin(a) * stretch);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  const now = t;
  for (const d of dustPuffs) {
    const age = now - d.born,
      p = age / d.life;
    if (p >= 1) continue;
    const x = d.x + d.vx * age * 0.05,
      y = d.y + d.vy * age * 0.05;
    ctx.globalAlpha = (1 - p) * 0.6;
    ctx.lineWidth = 1;
    const hl = d.len / 2;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(d.rot) * hl, y - Math.sin(d.rot) * hl);
    ctx.lineTo(x + Math.cos(d.rot) * hl, y + Math.sin(d.rot) * hl);
    ctx.stroke();
  }
  ctx.restore();
}
