// Sparks build the sketch — the landing-time particle→ink build system
// (build-plan.md §2-3). A single BuildPlan is created once at landing (device
// outline → structure blocks → detail), pooled particles fly from recruited
// drift-cinder positions to points along each path's own arclength, timed to
// arrive exactly when the ink head (clock-authoritative, driven by
// startMs/durMs) reaches that point — never the other way around, so ducking
// or capping particles never stalls the drawing itself.
//
// Speculative tiers 0/0.5 during the *wait* (before landing) are handled
// separately by frames.ts's drawSpeculativeFrame as dot-grid lighting
// (voice-lab-dotgrid-addendum.md §3) — device outline + construction guides
// never get a particle build of their own pre-landing. This plan only ever
// spans the landing sequence: outline (tier 0) is folded in as its first,
// fastest tier so "device frame first, then structure, then detail" still
// reads as one continuous build.
import { evalEase, EASE_OUT } from "./sequence";
// Type-only: frames.ts type-imports BuildPlan/BuildPath from here, so these
// stay type-only to avoid a runtime circular module dependency.
import type { Frame, PathSample, BuiltPath, BuiltElement } from "./frames";
import { elementWorldPos } from "./frames";
import type { DotGrid } from "./dotGrid";
import type { BuildConfig, CinderConfig } from "./types";

export type BuildTier = 0 | 1 | 2;

export type BuildPath = {
  frameId: string;
  tier: BuildTier;
  passA: Path2D;
  passB: Path2D | null;
  lenA: number;
  lenB: number;
  strokeWidth: number;
  samples: PathSample[];
  startMs: number; // relative to plan.startAt
  durMs: number;
  landed: boolean;
};

type ParticleBlock = {
  total: number;
  px: Float32Array;
  py: Float32Array;
  sx: Float32Array;
  sy: Float32Array;
  tx: Float32Array;
  ty: Float32Array;
  launchAt: Float32Array;
  arriveAt: Float32Array;
  side: Float32Array; // +1/-1, which perpendicular side bows away from center
  order: Int32Array; // indices sorted by launchAt, fixed schedule
  schedCursor: number;
  activeIdx: Int32Array;
  activeCount: number;
};

export type BuildPlan = {
  startAt: number;
  paths: BuildPath[];
  particles: ParticleBlock;
  center: { x: number; y: number };
  arc: number;
  flightSpeed: number;
  endAt: number; // plan.startAt + last settle end, for external "build done" checks
  reducedMotion: boolean;
};

// Binary search over a path's fixed-spacing cumulative-length samples for the
// point nearest arclength `len` — O(log n), zero allocation, safe every
// frame (replaces per-frame getPointAtLength).
export function sampleAt(samples: PathSample[], len: number): PathSample {
  if (samples.length === 0) return { x: 0, y: 0, angle: 0, cum: 0 };
  let lo = 0,
    hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].cum < len) lo = mid + 1;
    else hi = mid;
  }
  return samples[lo];
}

export const BUILD_PASS_B_TRAIL = 0.38;

const FLIGHT_MIN = 220;
const FLIGHT_MAX = 380;
const TIER0_MS = 520;
const TIER1_MIN = 140,
  TIER1_MAX = 320,
  TIER1_FACTOR = 0.45;
const TIER2_MIN = 90,
  TIER2_MAX = 180,
  TIER2_FACTOR = 0.35;
const SETTLE_MS = 160;
const FRAME_OFFSET_MS = 90;
const COLD_CAP_MS = 1800;
const BEAT_TAIL_MS = 300;
const MAX_SCHEDULED = 600;
const MAX_CONCURRENT = 240;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function densityFor(tier: BuildTier, cfg: BuildConfig): number {
  if (tier === 0) return cfg.densityFrame;
  if (tier === 1) return cfg.densityBlocks;
  return cfg.densityDetails;
}

type ScheduleDraft = {
  path: BuildPath;
  targets: { x: number; y: number; arrive: number }[];
};

// Builds the full landing BuildPlan: tier 0 → 1 → 2 timeline (wave-major
// across frames, 90ms frame offset), fitted to the preset's own tempo and
// clamped so it never overruns the preset's next "clear" beat.
export function planBuild(
  frames: Frame[],
  now: number,
  cfg: BuildConfig,
  cinderCfg: CinderConfig,
  inkStaggerMsIn: number,
  clearAt: number | null,
  center: { x: number; y: number },
  driftLaunchPoints: { x: number; y: number }[],
  reducedMotion = false,
): BuildPlan {
  // Reduced motion (build-plan.md §3): tiers crossfade in order at a flat
  // 300ms each, no stagger, no particles — enforced here (durations) and in
  // scheduleParticles (empty pool) rather than adding a second draw path.
  const inkStaggerMs = reducedMotion ? 0 : inkStaggerMsIn;
  const masterScale = cinderCfg.landDurationMs / 900;
  const orderedFrames = [...frames].sort((a, b) => a.x - b.x);
  const paths: BuildPath[] = [];

  orderedFrames.forEach((f, frameIdx) => {
    const waveOffset = frameIdx * FRAME_OFFSET_MS * masterScale;
    const gap = cfg.tierGapMs * masterScale;
    let cursor = waveOffset;

    // Tier 0 — device outline.
    const t0Dur = TIER0_MS * masterScale;
    paths.push(toBuildPath(f.id, 0, f.paths.outline, cursor, t0Dur));
    cursor += t0Dur + gap;

    // Tier 1 — structure blocks (rect/circle), ordered y then x.
    const tier1 = f.paths.elements
      .filter((el) => el.tier === 1)
      .sort(byYThenX(f));
    let tier1End = cursor;
    tier1.forEach((el, i) => {
      const dur =
        clamp(el.lenA * TIER1_FACTOR, TIER1_MIN, TIER1_MAX) * masterScale;
      const start = cursor + i * inkStaggerMs;
      paths.push(toBuildPath(f.id, 1, el, start, dur));
      tier1End = Math.max(tier1End, start + dur);
    });
    cursor = tier1End + gap;

    // Tier 2 — detail (line/cross), ordered y then x, staggered tighter and
    // overlapping tier 1 via the (default-negative) tier gap.
    const tier2 = f.paths.elements
      .filter((el) => el.tier === 2)
      .sort(byYThenX(f));
    tier2.forEach((el, i) => {
      const dur =
        clamp(el.lenA * TIER2_FACTOR, TIER2_MIN, TIER2_MAX) * masterScale;
      const start = cursor + i * inkStaggerMs * 0.6;
      paths.push(toBuildPath(f.id, 2, el, start, dur));
    });
  });

  if (reducedMotion) {
    const crossfadeMs = 300 * masterScale;
    for (const p of paths) p.durMs = crossfadeMs;
  }

  const settleMs = SETTLE_MS * masterScale;
  const rawEnd =
    Math.max(0, ...paths.map((p) => p.startMs + p.durMs)) + settleMs;

  const coldCap = COLD_CAP_MS * masterScale;
  const beatCap =
    clearAt !== null ? Math.max(0, clearAt - now - BEAT_TAIL_MS) : null;
  const finalCap = beatCap !== null ? Math.min(coldCap, beatCap) : coldCap;
  const scale = rawEnd > finalCap && rawEnd > 0 ? finalCap / rawEnd : 1;
  if (scale < 1) {
    for (const p of paths) {
      p.startMs *= scale;
      p.durMs *= scale;
    }
  }
  const endAt = now + rawEnd * scale;

  const particles = reducedMotion
    ? emptyParticleBlock()
    : scheduleParticles(paths, cfg, now, driftLaunchPoints);

  return {
    startAt: now,
    paths,
    particles,
    center,
    arc: cfg.arc,
    flightSpeed: cfg.flightSpeed,
    endAt,
    reducedMotion,
  };
}

function emptyParticleBlock(): ParticleBlock {
  return {
    total: 0,
    px: new Float32Array(0),
    py: new Float32Array(0),
    sx: new Float32Array(0),
    sy: new Float32Array(0),
    tx: new Float32Array(0),
    ty: new Float32Array(0),
    launchAt: new Float32Array(0),
    arriveAt: new Float32Array(0),
    side: new Float32Array(0),
    order: new Int32Array(0),
    schedCursor: 0,
    activeIdx: new Int32Array(0),
    activeCount: 0,
  };
}

function byYThenX(frame: Frame) {
  return (a: BuiltElement, b: BuiltElement) => {
    const pa = elementWorldPos(frame, a);
    const pb = elementWorldPos(frame, b);
    return pa.y - pb.y || pa.x - pb.x;
  };
}

function toBuildPath(
  frameId: string,
  tier: BuildTier,
  src: BuiltPath,
  startMs: number,
  durMs: number,
): BuildPath {
  return {
    frameId,
    tier,
    passA: src.passA,
    passB: src.passB,
    lenA: src.lenA,
    lenB: src.lenB,
    strokeWidth: src.strokeWidth,
    samples: src.samples,
    startMs,
    durMs,
    landed: false,
  };
}

function scheduleParticles(
  paths: BuildPath[],
  cfg: BuildConfig,
  planStartAt: number,
  driftLaunchPoints: { x: number; y: number }[],
): ParticleBlock {
  const drafts: ScheduleDraft[] = [];
  let rawTotal = 0;
  for (const p of paths) {
    if (p.lenA <= 0) continue;
    const density = densityFor(p.tier, cfg);
    const n = clamp(Math.round((density * p.lenA) / 100), 2, 24);
    rawTotal += n;
    const targets: { x: number; y: number; arrive: number }[] = [];
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const s = sampleAt(p.samples, p.lenA * f);
      targets.push({
        x: s.x,
        y: s.y,
        arrive: planStartAt + p.startMs + f * p.durMs,
      });
    }
    drafts.push({ path: p, targets });
  }

  const scale = rawTotal > MAX_SCHEDULED ? MAX_SCHEDULED / rawTotal : 1;
  const flat: { pathIdx: number; x: number; y: number; arrive: number }[] = [];
  drafts.forEach((d, pathIdx) => {
    const keep = Math.max(2, Math.round(d.targets.length * scale));
    const step = d.targets.length / keep;
    for (let i = 0; i < keep; i++) {
      const t = d.targets[Math.min(d.targets.length - 1, Math.floor(i * step))];
      flat.push({ pathIdx, ...t });
    }
  });

  const total = flat.length;
  const px = new Float32Array(total),
    py = new Float32Array(total);
  const sx = new Float32Array(total),
    sy = new Float32Array(total);
  const tx = new Float32Array(total),
    ty = new Float32Array(total);
  const launchAt = new Float32Array(total),
    arriveAt = new Float32Array(total);
  const side = new Float32Array(total);

  const originFallback = driftLaunchPoints[0] ?? { x: 0, y: 0 };
  for (let i = 0; i < total; i++) {
    const f = flat[i];
    const launch = driftLaunchPoints.length
      ? driftLaunchPoints[i % driftLaunchPoints.length]
      : originFallback;
    const dist = Math.hypot(f.x - launch.x, f.y - launch.y);
    const flightMs =
      clamp(180 + dist * 0.28, FLIGHT_MIN, FLIGHT_MAX) /
      Math.max(0.25, cfg.flightSpeed);
    sx[i] = launch.x;
    sy[i] = launch.y;
    tx[i] = f.x;
    ty[i] = f.y;
    arriveAt[i] = f.arrive;
    launchAt[i] = f.arrive - flightMs;
    side[i] = i % 2 === 0 ? 1 : -1;
    px[i] = launch.x;
    py[i] = launch.y;
  }

  const order = Array.from({ length: total }, (_, i) => i).sort(
    (a, b) => launchAt[a] - launchAt[b],
  );

  return {
    total,
    px,
    py,
    sx,
    sy,
    tx,
    ty,
    launchAt,
    arriveAt,
    side,
    order: Int32Array.from(order),
    schedCursor: 0,
    activeIdx: new Int32Array(total),
    activeCount: 0,
  };
}

// Advances the particle pool in place — no per-frame allocation. Activates
// newly-due particles from the precomputed schedule, steps in-flight ones
// along an ease-out quadratic arc bowing away from the canvas center, and
// pops the grid dot under any particle that just arrived.
export function updateBuild(
  plan: BuildPlan,
  now: number,
  dotGrid: DotGrid | null,
  snapToGrid: boolean,
  dotPop: number,
) {
  const b = plan.particles;
  while (
    b.schedCursor < b.total &&
    b.activeCount < MAX_CONCURRENT &&
    b.launchAt[b.order[b.schedCursor]] <= now
  ) {
    b.activeIdx[b.activeCount++] = b.order[b.schedCursor];
    b.schedCursor++;
  }
  for (let i = 0; i < b.activeCount; i++) {
    const idx = b.activeIdx[i];
    const dur = Math.max(1, b.arriveAt[idx] - b.launchAt[idx]);
    const frac = (now - b.launchAt[idx]) / dur;
    if (frac >= 1) {
      if (dotGrid && snapToGrid) {
        const dotIdx = dotGrid.nearestDot(b.tx[idx], b.ty[idx]);
        dotGrid.lightDot(dotIdx, 0.4 + dotPop * 0.6);
      }
      b.activeIdx[i] = b.activeIdx[--b.activeCount];
      i--;
      continue;
    }
    const eased = evalEase(EASE_OUT, Math.max(0, frac));
    const lx = b.sx[idx] + (b.tx[idx] - b.sx[idx]) * eased;
    const ly = b.sy[idx] + (b.ty[idx] - b.sy[idx]) * eased;
    const dx = b.tx[idx] - b.sx[idx],
      dy = b.ty[idx] - b.sy[idx];
    const chord = Math.hypot(dx, dy) || 1;
    const nx = -dy / chord,
      ny = dx / chord;
    const mx = (b.sx[idx] + b.tx[idx]) / 2,
      my = (b.sy[idx] + b.ty[idx]) / 2;
    const awayX = mx - plan.center.x,
      awayY = my - plan.center.y;
    const sign = nx * awayX + ny * awayY >= 0 ? 1 : -1;
    const bow =
      chord * plan.arc * Math.sin(Math.PI * Math.min(1, Math.max(0, frac)));
    b.px[idx] = lx + nx * sign * bow;
    b.py[idx] = ly + ny * sign * bow;
  }
}

// Ease-out tail: particles collapse from a 9px streak to a 2px dot over the
// last 22% of flight, reading as a "dots lead" leader the stroke connects
// (build-plan.md §2, arrival fork B default) — or a tight comet dot for the
// alternate fork.
export function drawBuildParticles(
  ctx: CanvasRenderingContext2D,
  plan: BuildPlan,
  now: number,
  color: string,
  arrival: "dotsLead" | "comet",
  duckAlpha: number,
) {
  const b = plan.particles;
  if (b.activeCount === 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  for (let i = 0; i < b.activeCount; i++) {
    const idx = b.activeIdx[i];
    const dur = Math.max(1, b.arriveAt[idx] - b.launchAt[idx]);
    const frac = Math.min(1, Math.max(0, (now - b.launchAt[idx]) / dur));
    const dx = b.tx[idx] - b.sx[idx],
      dy = b.ty[idx] - b.sy[idx];
    const angle = Math.atan2(dy, dx);
    const tailFrac = Math.max(0, (frac - 0.78) / 0.22);
    const len = arrival === "comet" ? 6 : 9 - (9 - 2) * Math.min(1, tailFrac);
    const hl = len / 2;
    ctx.globalAlpha = (0.55 + 0.35 * (1 - frac)) * duckAlpha;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(
      b.px[idx] - Math.cos(angle) * hl,
      b.py[idx] - Math.sin(angle) * hl,
    );
    ctx.lineTo(
      b.px[idx] + Math.cos(angle) * hl,
      b.py[idx] + Math.sin(angle) * hl,
    );
    ctx.stroke();
  }
  ctx.restore();
}

export function buildDone(plan: BuildPlan, now: number): boolean {
  return now >= plan.endAt && plan.particles.activeCount === 0;
}
