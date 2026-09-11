import { roughLine, roughEllipse, roughRoundedRect } from "drawably";
import {
  SKETCH_ROUGHNESS,
  SKETCH_LINE_ROUGHNESS,
  INK,
  hashSeed,
  firstStroke,
  roundRectPath,
} from "./constants";
import type { CinderConfig } from "./types";

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

type BuiltPath = { d: string; strokeWidth: number; path2d: Path2D };
type BuiltElement = FrameElement & BuiltPath;
type FramePaths = {
  outline: BuiltPath;
  elements: BuiltElement[];
  targetPoints: { x: number; y: number; angle: number }[];
};
export type Frame = FrameDef & {
  landed: boolean;
  landStartedAt: number;
  paths: FramePaths;
};

const svgNS = "http://www.w3.org/2000/svg";

function buildElementPath(frame: FrameDef, el: FrameElement): BuiltPath {
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
  return { d, strokeWidth, path2d: new Path2D(d) };
}

function samplePathPoints(measurePath: SVGPathElement, d: string, n: number) {
  measurePath.setAttribute("d", d);
  const len = measurePath.getTotalLength();
  const pts: { x: number; y: number; angle: number }[] = [];
  for (let i = 0; i < n; i++) {
    const l0 = (i / n) * len;
    const l1 = Math.min(len, l0 + 1);
    const p0 = measurePath.getPointAtLength(l0);
    const p1 = measurePath.getPointAtLength(l1);
    pts.push({ x: p0.x, y: p0.y, angle: Math.atan2(p1.y - p0.y, p1.x - p0.x) });
  }
  return pts;
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
  const outline: BuiltPath = {
    d: outlineD,
    strokeWidth: 1.75,
    path2d: new Path2D(outlineD),
  };
  const elements: BuiltElement[] = frame.elements.map((el) => ({
    ...el,
    ...buildElementPath(frame, el),
  }));
  const allSources: BuiltPath[] = [outline, ...elements];
  const samples: { x: number; y: number; angle: number }[] = [];
  for (const src of allSources) {
    measurePath.setAttribute("d", src.d);
    const len = measurePath.getTotalLength();
    if (len <= 0) continue;
    const n = Math.max(2, Math.round(len / 14));
    samples.push(...samplePathPoints(measurePath, src.d, n));
  }
  return { outline, elements, targetPoints: samples };
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
) {
  for (let i = 0; i < cfg.burstSize; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const speed = 0.6 + Math.random() * 1.2;
    dustPuffs.push({
      x: origin.x + (Math.random() - 0.5) * 16,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      born: performance.now(),
      life: 700 + Math.random() * 300,
      len: 3 + Math.random() * 3,
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

export function beginLanding(
  frames: Frame[],
  cinders: Cinder[],
  cfg: CinderConfig,
): Cinder[] {
  const t = performance.now();
  resetFrames(frames);
  for (const f of frames) f.landStartedAt = t;
  let next = cinders;
  if (cinders.filter((c) => c.phase === "drift").length < 20) {
    next = [];
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
  }
  const flightMs = cfg.landDurationMs * (520 / 900);
  for (const f of frames) {
    const targets = f.paths.targetPoints;
    const myCinders = next.filter((c) => c.frameId === f.id);
    myCinders.forEach((c, i) => {
      const pt = targets.length
        ? targets[i % targets.length]
        : { x: f.x + f.w / 2, y: f.y + f.h / 2, angle: 0 };
      c.phase = "snap";
      c.startX = c.x;
      c.startY = c.y;
      c.targetX = pt.x;
      c.targetY = pt.y;
      c.targetAngle = pt.angle;
      c.landStart = t + Math.random() * 120;
      c.flightMs = flightMs;
    });
  }
  return next;
}

export function easeOutBack(x: number): number {
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

// ---- Frame + cinder rendering ----------------------------------------------

export function drawFrames(
  ctx: CanvasRenderingContext2D,
  frames: Frame[],
  t: number,
  cfg: CinderConfig,
) {
  for (const f of frames) {
    const inkStart = f.landStartedAt
      ? f.landStartedAt + cfg.landDurationMs * (520 / 900)
      : 0;
    if (!f.landed && (f.landStartedAt === 0 || t < inkStart)) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = "#d4d4d8";
      ctx.lineWidth = 1.5;
      ctx.stroke(f.paths.outline.path2d);
      for (const el of f.paths.elements) ctx.stroke(el.path2d);
      ctx.restore();
      continue;
    }
    ctx.save();
    ctx.globalAlpha = f.landed
      ? 1
      : Math.min(1, (t - f.landStartedAt) / cfg.landDurationMs);
    ctx.shadowColor = "rgba(0,0,0,0.12)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = "#ffffff";
    roundRectPath(ctx, f.x, f.y, f.w, f.h, 26);
    ctx.fill();
    ctx.restore();
    if (f.landed) {
      strokeShape(ctx, f.paths.outline.path2d, f.paths.outline.strokeWidth);
      for (const el of f.paths.elements)
        strokeShape(ctx, el.path2d, el.strokeWidth);
      continue;
    }
    const inkMs = cfg.landDurationMs * (180 / 900);
    const inkT = Math.max(0, Math.min(1, (t - inkStart) / inkMs));
    if (inkT > 0) {
      drawInkingReveal(ctx, f.paths.outline, inkT);
      for (const el of f.paths.elements) drawInkingReveal(ctx, el, inkT);
      if (inkT >= 1) {
        const settleT = Math.min(
          1,
          (t - inkStart - inkMs) / (cfg.landDurationMs * (160 / 900)),
        );
        drawImpactMarks(ctx, f, settleT);
        if (settleT >= 1) f.landed = true;
      }
    }
  }
}

function strokeShape(
  ctx: CanvasRenderingContext2D,
  path2d: Path2D,
  width: number,
) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(path2d);
  ctx.restore();
}

function drawInkingReveal(
  ctx: CanvasRenderingContext2D,
  src: BuiltPath,
  t: number,
) {
  const measurePath = document.createElementNS(svgNS, "path");
  measurePath.setAttribute("d", src.d);
  const len = measurePath.getTotalLength();
  ctx.save();
  ctx.setLineDash([len, len]);
  ctx.lineDashOffset = len * (1 - t);
  ctx.strokeStyle = INK;
  ctx.lineWidth = src.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(src.path2d);
  ctx.restore();
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
) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  for (const c of cinders) {
    if (c.phase === "drift") {
      const distFromOrigin = Math.hypot(c.x - origin.x, c.y - origin.y);
      const fade = Math.max(0.15, 1 - distFromOrigin / 900);
      const angle = Math.atan2(c.vy, c.vx);
      const hl = c.len / 2;
      ctx.globalAlpha = fade * 0.8;
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
