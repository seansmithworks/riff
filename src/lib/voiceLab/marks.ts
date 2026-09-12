import {
  roughLine,
  roughEllipse,
  roughRoundedRect,
  mulberry32,
} from "drawably";
import { SKETCH_ROUGHNESS, hashSeed, polar, arcPts } from "./constants";
import type { MarkDef, MarkDrawArgs } from "./types";

// Shared drawing helpers ----------------------------------------------------

let ctx: CanvasRenderingContext2D;
export function setMarksContext(c: CanvasRenderingContext2D) {
  ctx = c;
}

// Outer alpha multiplier, set by the engine once per role per frame (from
// preset.markPeak × that role's presence) so a fading/crossfading role
// actually fades — strokePath/strokeChain otherwise set a fixed globalAlpha
// each call, which nothing outside marks.ts could scale.
let alphaMul = 1;
export function setAlphaMul(v: number) {
  alphaMul = v;
}

function strokePath(path2d: Path2D, color: string, width: number, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha * alphaMul;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(path2d);
  ctx.restore();
}

export function strokeChain(
  pts: [number, number][],
  color: string,
  width: number,
  seedBase: number,
  alpha: number,
  closed = false,
) {
  ctx.save();
  ctx.globalAlpha = alpha * alphaMul;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i],
      p1 = pts[(i + 1) % pts.length];
    const d = roughLine(p0[0], p0[1], p1[0], p1[1], {
      seed: seedBase + i,
      roughness: SKETCH_ROUGHNESS,
      boil: 0,
    });
    ctx.stroke(new Path2D(d));
  }
  ctx.restore();
}

// Rolling buffer for the Doodled Waveform mark.
let waveformBuf: number[] = [];

export const MARKS: MarkDef[] = [
  {
    id: "burst",
    num: 1,
    name: "Burst",
    params: [
      {
        key: "rayCount",
        label: "Ray count",
        min: 12,
        max: 30,
        step: 1,
        def: 22,
      },
      {
        key: "spread",
        label: "Spread (deg)",
        min: 120,
        max: 260,
        step: 5,
        def: 200,
      },
      {
        key: "reach",
        label: "Reach (px)",
        min: 60,
        max: 200,
        step: 5,
        def: 130,
      },
      {
        key: "thickness",
        label: "Thickness",
        min: 0.5,
        max: 3,
        step: 0.1,
        def: 1.0,
      },
      {
        key: "onsetPunch",
        label: "Onset punch",
        min: 0,
        max: 2,
        step: 0.1,
        def: 1.0,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, bands, onsetPulse, color, cfg, smear } = g;
      const smearMul = smear ?? 1;
      const pool = Math.round(cfg.rayCount);
      const jitterBucket = Math.floor(t / 150);
      for (let i = 0; i < pool; i++) {
        const frac = i / (pool - 1);
        const pos = frac * (bands.length - 1);
        const i0 = Math.floor(pos),
          i1 = Math.min(bands.length - 1, i0 + 1),
          lerp = pos - i0;
        const lvl = bands[i0] * (1 - lerp) + bands[i1] * lerp;
        const slotRng = mulberry32(hashSeed(`b-slot-${i}`));
        const threshold = 0.05 + slotRng() * 0.5;
        const posJitterDeg = (slotRng() - 0.5) * 16;
        const lenJitter = slotRng();
        if (lvl < threshold) continue;
        const energyAbove = Math.min(1, (lvl - threshold) / (1 - threshold));
        const angleDeg =
          -90 - cfg.spread / 2 + cfg.spread * frac + posJitterDeg;
        const jitterRng = mulberry32(hashSeed(`b-jit-${i}-${jitterBucket}`));
        const angleJitter = (jitterRng() - 0.5) * 6;
        const a = ((angleDeg + angleJitter) * Math.PI) / 180;
        const len =
          (12 +
            energyAbove * cfg.reach +
            lenJitter * 18 +
            onsetPulse * cfg.onsetPunch * 24) *
          smearMul;
        const [x1, y1] = polar(o.x, o.y, 26, a),
          [x2, y2] = polar(o.x, o.y, 26 + len, a);
        const seed = hashSeed(`b-ray-${i}`) + Math.floor(t / 90);
        const width =
          1.25 * 0.8 * cfg.thickness + energyAbove * 1.1 * cfg.thickness;
        strokePath(
          new Path2D(
            roughLine(x1, y1, x2, y2, {
              seed,
              roughness: SKETCH_ROUGHNESS,
              boil: 0,
            }),
          ),
          color,
          width,
          0.45 + energyAbove * 0.5,
        );
      }
    },
    // Mirrors the tip computation in draw() so sketch-job cinders can spawn
    // off the live ray ends instead of the disc origin.
    getTipEmitters(g: MarkDrawArgs) {
      const { o, t, bands, onsetPulse, cfg, smear } = g;
      const smearMul = smear ?? 1;
      const pool = Math.round(cfg.rayCount);
      const jitterBucket = Math.floor(t / 150);
      const tips = [];
      for (let i = 0; i < pool; i++) {
        const frac = i / (pool - 1);
        const pos = frac * (bands.length - 1);
        const i0 = Math.floor(pos),
          i1 = Math.min(bands.length - 1, i0 + 1),
          lerp = pos - i0;
        const lvl = bands[i0] * (1 - lerp) + bands[i1] * lerp;
        const slotRng = mulberry32(hashSeed(`b-slot-${i}`));
        const threshold = 0.05 + slotRng() * 0.5;
        const posJitterDeg = (slotRng() - 0.5) * 16;
        const lenJitter = slotRng();
        if (lvl < threshold) continue;
        const energyAbove = Math.min(1, (lvl - threshold) / (1 - threshold));
        const angleDeg =
          -90 - cfg.spread / 2 + cfg.spread * frac + posJitterDeg;
        const jitterRng = mulberry32(hashSeed(`b-jit-${i}-${jitterBucket}`));
        const angleJitter = (jitterRng() - 0.5) * 6;
        const a = ((angleDeg + angleJitter) * Math.PI) / 180;
        const len =
          (12 +
            energyAbove * cfg.reach +
            lenJitter * 18 +
            onsetPulse * cfg.onsetPunch * 24) *
          smearMul;
        const [x2, y2] = polar(o.x, o.y, 26 + len, a);
        tips.push({ x: x2, y: y2, angle: a });
      }
      return tips;
    },
  },
  {
    id: "emanata",
    num: 2,
    name: "Emanata Lines",
    params: [
      {
        key: "pairCount",
        label: "Bracket pairs",
        min: 1,
        max: 5,
        step: 1,
        def: 3,
      },
      {
        key: "spacing",
        label: "Spacing (px)",
        min: 8,
        max: 36,
        step: 1,
        def: 16,
      },
      { key: "reach", label: "Reach (px)", min: 20, max: 90, step: 5, def: 50 },
      {
        key: "thickness",
        label: "Thickness",
        min: 0.5,
        max: 3,
        step: 0.1,
        def: 1.25,
      },
      {
        key: "onsetPunch",
        label: "Onset punch",
        min: 0,
        max: 2,
        step: 0.1,
        def: 1.0,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, level, onsetPulse, color, cfg, mode } = g;
      const pairs = Math.round(cfg.pairCount);
      const extra = level * cfg.reach + onsetPulse * cfg.onsetPunch * 20;
      const cy = o.y - 46;
      for (let i = 0; i < pairs; i++) {
        const r = 20 + i * cfg.spacing + extra * ((i + 1) / pairs);
        const leftPts = arcPts(
          o.x - 6,
          cy,
          r,
          Math.PI * 0.62,
          Math.PI * 1.38,
          6,
        );
        const rightPts = arcPts(
          o.x + 6,
          cy,
          r,
          -Math.PI * 0.38,
          Math.PI * 0.38,
          6,
        );
        const alpha =
          mode === "silence" ? 0.32 : Math.max(0.22, 0.9 - i * 0.18);
        strokeChain(
          leftPts,
          color,
          cfg.thickness,
          hashSeed(`em-l-${i}`) + Math.floor(t / 260),
          alpha,
        );
        strokeChain(
          rightPts,
          color,
          cfg.thickness,
          hashSeed(`em-r-${i}`) + Math.floor(t / 260),
          alpha,
        );
      }
    },
  },
  {
    id: "loop",
    num: 3,
    name: "Scribble Loop",
    params: [
      {
        key: "baseRadius",
        label: "Base radius",
        min: 16,
        max: 60,
        step: 1,
        def: 34,
      },
      { key: "loopGain", label: "Loop gain", min: 0, max: 6, step: 1, def: 3 },
      { key: "wobble", label: "Wobble", min: 0, max: 1, step: 0.05, def: 0.35 },
      {
        key: "thickness",
        label: "Thickness",
        min: 0.5,
        max: 3,
        step: 0.1,
        def: 1.1,
      },
      {
        key: "onsetPunch",
        label: "Onset punch",
        min: 0,
        max: 2,
        step: 0.1,
        def: 1.0,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, level, onsetPulse, color, cfg } = g;
      const loops = Math.max(
        1,
        1 + Math.round(level * cfg.loopGain + onsetPulse * cfg.onsetPunch),
      );
      for (let i = 0; i < loops; i++) {
        const tightness = 1 - i * 0.15 * (0.4 + level);
        const r = Math.max(5, cfg.baseRadius * tightness);
        const rng = mulberry32(hashSeed(`loop-${i}`));
        const jx = (rng() - 0.5) * cfg.wobble * 14;
        const jy = (rng() - 0.5) * cfg.wobble * 14;
        const seed = hashSeed(`loop-shape-${i}`) + Math.floor(t / 500);
        const d = roughEllipse(
          o.x + jx,
          o.y - 40 + jy,
          r,
          r * (0.85 + rng() * 0.3),
          {
            seed,
            roughness: SKETCH_ROUGHNESS + cfg.wobble * 0.3,
            boil: 0,
          },
        );
        strokePath(new Path2D(d), color, cfg.thickness, 0.75 - i * 0.07);
      }
    },
  },
  {
    id: "hatch",
    num: 4,
    name: "Hatch EQ",
    params: [
      {
        key: "barGap",
        label: "Bar gap (px)",
        min: 4,
        max: 24,
        step: 1,
        def: 10,
      },
      {
        key: "hatchDensity",
        label: "Hatch density",
        min: 2,
        max: 8,
        step: 1,
        def: 4,
      },
      {
        key: "reach",
        label: "Max height (px)",
        min: 40,
        max: 160,
        step: 5,
        def: 110,
      },
      {
        key: "thickness",
        label: "Thickness",
        min: 0.5,
        max: 2.5,
        step: 0.1,
        def: 1.0,
      },
      {
        key: "onsetPunch",
        label: "Onset punch",
        min: 0,
        max: 2,
        step: 0.1,
        def: 1.0,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, bands, onsetPulse, color, cfg, mode } = g;
      const barW = 14;
      const totalW = bands.length * (barW + cfg.barGap) - cfg.barGap;
      const startX = o.x - totalW / 2;
      const baseY = o.y - 34;
      bands.forEach((lvl, i) => {
        const h = 6 + lvl * cfg.reach + onsetPulse * cfg.onsetPunch * 18;
        const x = startX + i * (barW + cfg.barGap);
        const rows = Math.max(2, Math.round(cfg.hatchDensity));
        for (let r = 0; r < rows; r++) {
          const fy = baseY - (h * (r + 1)) / rows;
          const seed =
            hashSeed(`hatch-${i}-${r}`) +
            (mode === "silence" ? 0 : Math.floor(t / 220));
          const d = roughLine(x, fy, x + barW, fy, {
            seed,
            roughness: 0.55,
            boil: 0,
          });
          strokePath(new Path2D(d), color, cfg.thickness, 0.5 + lvl * 0.4);
        }
      });
    },
  },
  {
    id: "balloon",
    num: 5,
    name: "Speech Balloon",
    params: [
      {
        key: "baseWidth",
        label: "Width",
        min: 60,
        max: 160,
        step: 5,
        def: 110,
      },
      {
        key: "baseHeight",
        label: "Height",
        min: 40,
        max: 100,
        step: 5,
        def: 64,
      },
      { key: "wobble", label: "Wobble", min: 0, max: 1, step: 0.05, def: 0.35 },
      {
        key: "thickness",
        label: "Thickness",
        min: 0.5,
        max: 3,
        step: 0.1,
        def: 1.25,
      },
      {
        key: "onsetPunch",
        label: "Onset punch",
        min: 0,
        max: 2,
        step: 0.1,
        def: 1.0,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, level, onsetPulse, color, cfg } = g;
      const scale = 1 + level * 0.3 + onsetPulse * cfg.onsetPunch * 0.25;
      const w = cfg.baseWidth * scale,
        h = cfg.baseHeight * scale * 0.7;
      const x = o.x - w / 2,
        y = o.y - 96 - h;
      const cyc = Math.max(60, 260 - cfg.wobble * 150);
      const wobRng = mulberry32(hashSeed("balloon") + Math.floor(t / cyc));
      const jx = (wobRng() - 0.5) * cfg.wobble * 6,
        jy = (wobRng() - 0.5) * cfg.wobble * 6;
      const seed = hashSeed("balloon-shape") + Math.floor(t / cyc);
      const d = roughRoundedRect(x + jx, y + jy, w, h, 16, {
        seed,
        roughness: SKETCH_ROUGHNESS,
        boil: 0,
      });
      strokePath(new Path2D(d), color, cfg.thickness, 0.85);
      const tailSeed = hashSeed("balloon-tail") + Math.floor(t / cyc);
      const td = roughLine(o.x - 8 + jx, y + h + jy, o.x, o.y - 30, {
        seed: tailSeed,
        roughness: SKETCH_ROUGHNESS,
        boil: 0,
      });
      strokePath(new Path2D(td), color, cfg.thickness * 0.85, 0.85);
    },
  },
  {
    id: "waveform",
    num: 6,
    name: "Doodled Waveform",
    params: [
      {
        key: "reach",
        label: "Width (px)",
        min: 80,
        max: 240,
        step: 10,
        def: 160,
      },
      {
        key: "amplitude",
        label: "Amplitude",
        min: 10,
        max: 80,
        step: 5,
        def: 40,
      },
      {
        key: "density",
        label: "Sample count",
        min: 6,
        max: 24,
        step: 1,
        def: 14,
      },
      {
        key: "thickness",
        label: "Thickness",
        min: 0.5,
        max: 3,
        step: 0.1,
        def: 1.25,
      },
      {
        key: "onsetPunch",
        label: "Onset punch",
        min: 0,
        max: 2,
        step: 0.1,
        def: 1.0,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, level, onsetPulse, color, cfg, mode } = g;
      const n = Math.max(4, Math.round(cfg.density));
      const spike = mode === "talking" ? onsetPulse * cfg.onsetPunch : 0;
      waveformBuf.push(Math.min(1, level + spike * 0.6));
      while (waveformBuf.length > n) waveformBuf.shift();
      while (waveformBuf.length < n)
        waveformBuf.unshift(waveformBuf[0] ?? 0.15);
      const w = cfg.reach,
        x0 = o.x - w / 2,
        y0 = o.y - 54;
      const active = Math.max(0, level - 0.08);
      const pts: [number, number][] = [];
      for (let i = 0; i < waveformBuf.length; i++) {
        const x = x0 + (i / (waveformBuf.length - 1)) * w;
        const hist = (waveformBuf[i] - 0.15) * cfg.amplitude * 0.55;
        const wobble =
          Math.sin(i * 0.85 + t / 150) * cfg.amplitude * 0.6 * active;
        const y = y0 - hist - wobble;
        pts.push([x, y]);
      }
      strokeChain(
        pts,
        color,
        cfg.thickness,
        hashSeed("wave") + Math.floor(t / 9999),
        0.85,
      );
    },
  },
  {
    id: "stipple",
    num: 7,
    name: "Stipple Spray",
    params: [
      {
        key: "dotCountBase",
        label: "Dot count",
        min: 10,
        max: 60,
        step: 5,
        def: 24,
      },
      {
        key: "reach",
        label: "Reach (px)",
        min: 30,
        max: 140,
        step: 5,
        def: 80,
      },
      {
        key: "dotSize",
        label: "Dot size",
        min: 0.8,
        max: 3,
        step: 0.1,
        def: 1.6,
      },
      { key: "jitter", label: "Jitter", min: 0, max: 1, step: 0.05, def: 0.6 },
      {
        key: "onsetPunch",
        label: "Onset punch",
        min: 0,
        max: 2,
        step: 0.1,
        def: 1.0,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, level, onsetPulse, color, cfg } = g;
      const burst = onsetPulse * cfg.onsetPunch * 20;
      const count = Math.max(
        0,
        Math.round(cfg.dotCountBase * (0.3 + level * 1.2) + burst),
      );
      const jitterBucket = Math.floor(t / 280);
      ctx.save();
      ctx.fillStyle = color;
      for (let i = 0; i < count; i++) {
        const rng = mulberry32(hashSeed(`stip-${i}-${jitterBucket}`));
        const a = rng() * Math.PI * 2;
        const dist = 14 + rng() * (cfg.reach * (0.4 + level * 0.8));
        const jr = (rng() - 0.5) * cfg.jitter * 10;
        const [x, y] = polar(o.x, o.y - 20, dist + jr, a);
        const size = cfg.dotSize * (0.5 + rng() * 0.7);
        ctx.globalAlpha = (0.35 + rng() * 0.4) * alphaMul;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
  },
  {
    id: "spiral",
    num: 8,
    name: "Spiral",
    params: [
      {
        key: "turnsBase",
        label: "Base turns",
        min: 0.5,
        max: 4,
        step: 0.1,
        def: 1.5,
      },
      {
        key: "reach",
        label: "Reach (px)",
        min: 40,
        max: 160,
        step: 5,
        def: 110,
      },
      { key: "wobble", label: "Wobble", min: 0, max: 1, step: 0.05, def: 0.3 },
      {
        key: "thickness",
        label: "Thickness",
        min: 0.5,
        max: 3,
        step: 0.1,
        def: 1.25,
      },
      {
        key: "onsetPunch",
        label: "Onset punch",
        min: 0,
        max: 2,
        step: 0.1,
        def: 1.0,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, level, onsetPulse, color, cfg, mode } = g;
      const turns =
        cfg.turnsBase + level * 2 + onsetPulse * cfg.onsetPunch * 1.2;
      const segs = Math.max(16, Math.round(turns * 22));
      const rot = mode === "talking" ? t / 2600 : 0;
      const pts: [number, number][] = [];
      for (let i = 0; i <= segs; i++) {
        const frac = i / segs;
        const a = frac * turns * Math.PI * 2 + rot;
        const r = 6 + frac * cfg.reach * (0.35 + level * 0.65);
        const wob = Math.sin(a * 5 + t / 280) * cfg.wobble * 4 * frac;
        pts.push(polar(o.x, o.y - 30, r + wob, a));
      }
      strokeChain(
        pts,
        color,
        cfg.thickness,
        hashSeed("spiral") + Math.floor(t / 240),
        0.85,
      );
    },
  },
  {
    id: "orbit",
    num: 9,
    name: "Orbit Ticks",
    params: [
      {
        key: "tickCount",
        label: "Tick count",
        min: 4,
        max: 16,
        step: 1,
        def: 8,
      },
      {
        key: "orbitReach",
        label: "Orbit radius",
        min: 30,
        max: 90,
        step: 5,
        def: 50,
      },
      {
        key: "orbitSpeed",
        label: "Orbit speed",
        min: 0.2,
        max: 3,
        step: 0.1,
        def: 1.0,
      },
      {
        key: "thickness",
        label: "Thickness",
        min: 0.5,
        max: 3,
        step: 0.1,
        def: 1.25,
      },
      {
        key: "onsetPunch",
        label: "Onset punch",
        min: 0,
        max: 2,
        step: 0.1,
        def: 1.0,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, level, onsetPulse, color, cfg } = g;
      const n = Math.round(cfg.tickCount);
      const speed = cfg.orbitSpeed * (0.3 + level * 1.2);
      const baseAngle = (t / 1000) * speed;
      const r = cfg.orbitReach * (0.7 + level * 0.3);
      for (let i = 0; i < n; i++) {
        const a = baseAngle + i * ((Math.PI * 2) / n);
        const [cx, cy] = polar(o.x, o.y - 20, r, a);
        const len = 6 + onsetPulse * cfg.onsetPunch * 8;
        const ta = a + Math.PI / 2;
        const x1 = cx - Math.cos(ta) * (len / 2),
          y1 = cy - Math.sin(ta) * (len / 2);
        const x2 = cx + Math.cos(ta) * (len / 2),
          y2 = cy + Math.sin(ta) * (len / 2);
        const seed = hashSeed(`orbit-${i}`) + Math.floor(t / 300);
        strokePath(
          new Path2D(
            roughLine(x1, y1, x2, y2, {
              seed,
              roughness: SKETCH_ROUGHNESS,
              boil: 0,
            }),
          ),
          color,
          cfg.thickness,
          0.5 + level * 0.4,
        );
      }
    },
  },
  {
    id: "rings",
    num: 10,
    name: "Concentric Rings",
    params: [
      {
        key: "ringCount",
        label: "Ring count",
        min: 2,
        max: 6,
        step: 1,
        def: 4,
      },
      {
        key: "spacing",
        label: "Spacing (px)",
        min: 8,
        max: 30,
        step: 1,
        def: 16,
      },
      { key: "wobble", label: "Wobble", min: 0, max: 1, step: 0.05, def: 0.3 },
      {
        key: "thickness",
        label: "Thickness",
        min: 0.5,
        max: 2.5,
        step: 0.1,
        def: 1.1,
      },
      {
        key: "onsetPunch",
        label: "Onset punch",
        min: 0,
        max: 2,
        step: 0.1,
        def: 1.0,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, level, onsetPulse, color, cfg } = g;
      const n = Math.round(cfg.ringCount);
      for (let i = 0; i < n; i++) {
        const r =
          18 + i * cfg.spacing + level * 10 + onsetPulse * cfg.onsetPunch * 14;
        const raw = arcPts(o.x, o.y - 30, r, 0, Math.PI * 2, 20);
        const pts: [number, number][] = raw.map(([x, y], idx) => {
          const wob = Math.sin(idx * 0.9 + t / 260 + i) * cfg.wobble * 4;
          return [x + wob * 0.4, y + wob];
        });
        const alpha = 0.85 * (1 - (i / n) * 0.6);
        strokeChain(
          pts,
          color,
          cfg.thickness,
          hashSeed(`ring-${i}`) + Math.floor(t / 240),
          alpha,
          true,
        );
      }
    },
  },
  {
    id: "smear",
    num: 11,
    name: "Brush Smear",
    params: [
      {
        key: "reach",
        label: "Reach (px)",
        min: 30,
        max: 160,
        step: 5,
        def: 90,
      },
      {
        key: "thicknessBase",
        label: "Thickness base",
        min: 2,
        max: 14,
        step: 1,
        def: 6,
      },
      {
        key: "thicknessRange",
        label: "Thickness range",
        min: 0,
        max: 14,
        step: 1,
        def: 8,
      },
      {
        key: "strokesCount",
        label: "Stroke count",
        min: 1,
        max: 4,
        step: 1,
        def: 2,
      },
      {
        key: "onsetPunch",
        label: "Onset punch",
        min: 0,
        max: 2,
        step: 0.1,
        def: 1.0,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, level, onsetPulse, color, cfg } = g;
      const layers = Math.max(1, Math.round(cfg.strokesCount));
      const segs = 8;
      const a0 = -Math.PI * 0.86,
        a1 = -Math.PI * 0.14;
      for (let s = 0; s < layers; s++) {
        const rBase = cfg.reach * 0.5 + s * (cfg.reach * 0.13);
        const rng = mulberry32(hashSeed(`smear-${s}`) + Math.floor(t / 260));
        const width =
          cfg.thicknessBase +
          level * cfg.thicknessRange +
          onsetPulse * cfg.onsetPunch * 6 -
          s * 1.6;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(1.5, width);
        ctx.globalAlpha =
          Math.max(0.18, 0.6 - s * 0.12 + level * 0.2) * alphaMul;
        ctx.beginPath();
        for (let i = 0; i <= segs; i++) {
          const frac = i / segs;
          const a = a0 + (a1 - a0) * frac;
          const jitter = (rng() - 0.5) * 6;
          const [x, y] = polar(o.x, o.y - 10, rBase + jitter, a);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }
    },
  },
  {
    // Promotes the broken/gapped onset-ring visual (previously only a
    // transient overlay fired by onsets, drawOnsetRings) to a standalone,
    // continuously-driven mark: level sets the resting radius/alpha, onsets
    // punch it outward. This is a new implementation, not a reuse of
    // "10 — Concentric Rings" — that mark draws closed loops; Ripple draws
    // the gapped double-arc rings, matching what onsets already throw.
    id: "ripple",
    num: 12,
    name: "Ripple",
    params: [
      {
        key: "ringCount",
        label: "Ring count",
        min: 2,
        max: 6,
        step: 1,
        def: 4,
      },
      {
        key: "spacing",
        label: "Spacing (px)",
        min: 8,
        max: 30,
        step: 1,
        def: 15,
      },
      { key: "gapDeg", label: "Gap (deg)", min: 10, max: 60, step: 2, def: 26 },
      {
        key: "thickness",
        label: "Thickness",
        min: 0.5,
        max: 2.5,
        step: 0.1,
        def: 1.4,
      },
      {
        key: "onsetPunch",
        label: "Onset punch",
        min: 0,
        max: 2,
        step: 0.1,
        def: 1.0,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, level, onsetPulse, color, cfg, mode } = g;
      const n = Math.round(cfg.ringCount);
      const gapRad = (cfg.gapDeg * Math.PI) / 180;
      for (let i = 0; i < n; i++) {
        const radius =
          22 + i * cfg.spacing + level * 16 + onsetPulse * cfg.onsetPunch * 22;
        const rot = t / 1800 + i * 0.6;
        const arcs: [number, number][] = [
          [rot, rot + Math.PI - gapRad],
          [rot + Math.PI, rot + Math.PI * 2 - gapRad],
        ];
        const alpha =
          mode === "silence"
            ? 0.28
            : Math.max(0.2, 0.85 - i * 0.15) * (0.5 + level * 0.5);
        const seedBase = hashSeed(`ripple-${i}`) + Math.floor(t / 260);
        for (const [a0, a1] of arcs) {
          strokeChain(
            arcPts(o.x, o.y, radius, a0, a1, 6),
            color,
            cfg.thickness,
            seedBase,
            alpha,
          );
        }
      }
    },
  },
  {
    // Riff's voice, generalized into the shared mark library so either
    // speaker can select it. Arcs are split into segments driven by the 5
    // frequency bands (so different parts of the sweep flex independently,
    // not one uniform phase wobble), a sweep tuner controls how far they
    // wrap the mic disc (default ~300°, innermost arc hugging it), and a
    // traveling bump — gated by onsetPulse — reads as a pulse moving along
    // the arcs.
    id: "riffArcs",
    num: 13,
    name: "Riff Arcs",
    params: [
      { key: "arcCount", label: "Arc count", min: 1, max: 5, step: 1, def: 3 },
      {
        key: "baseRadius",
        label: "Base radius",
        min: 16,
        max: 50,
        step: 1,
        def: 28,
      },
      { key: "arcGap", label: "Arc gap", min: 4, max: 30, step: 1, def: 20 },
      {
        key: "sweep",
        label: "Sweep (deg)",
        min: 120,
        max: 340,
        step: 5,
        def: 200,
      },
      { key: "bandFlex", label: "Band flex", min: 0, max: 20, step: 1, def: 5 },
      {
        key: "pulseSpeed",
        label: "Pulse speed",
        min: 0.2,
        max: 3,
        step: 0.1,
        def: 1.0,
      },
      {
        key: "thickness",
        label: "Thickness",
        min: 0.5,
        max: 3,
        step: 0.1,
        def: 1.5,
      },
    ],
    draw(g: MarkDrawArgs) {
      const { o, t, level, bands, onsetPulse, color, cfg, mode } = g;
      const n = Math.round(cfg.arcCount);
      const sweepRad = (cfg.sweep * Math.PI) / 180;
      const a0 = -Math.PI / 2 - sweepRad / 2;
      const a1 = -Math.PI / 2 + sweepRad / 2;
      const segsPerBand = 4;
      const totalSegs = bands.length * segsPerBand;
      const pulseT = ((t * cfg.pulseSpeed) / 1000) % 1;
      for (let i = 0; i < n; i++) {
        const baseR = cfg.baseRadius + i * cfg.arcGap;
        const pts: [number, number][] = [];
        for (let s = 0; s <= totalSegs; s++) {
          const frac = s / totalSegs;
          const a = a0 + (a1 - a0) * frac;
          const bandIdx = Math.min(
            bands.length - 1,
            Math.floor(frac * bands.length),
          );
          const bandLevel = bands[bandIdx];
          const wob =
            Math.sin(frac * 9 + t / 240 + i * 1.3 + bandIdx * 0.8) *
            cfg.bandFlex *
            (0.3 + bandLevel);
          const pulseDist = Math.abs(frac - pulseT);
          const pulseBump =
            onsetPulse > 0.02
              ? Math.max(0, 1 - pulseDist * 6) * onsetPulse * 10
              : 0;
          const r = baseR + wob + pulseBump + level * 4;
          pts.push(polar(o.x, o.y, r, a));
        }
        const alpha =
          mode === "silence"
            ? 0.3
            : Math.max(0.2, 0.55 + level * 0.35 - i * 0.05);
        strokeChain(
          pts,
          color,
          cfg.thickness,
          hashSeed(`arcs-${i}`) + Math.floor(t / 90),
          alpha,
        );
      }
    },
  },
];

export const MARK_BY_ID: Record<string, MarkDef> = Object.fromEntries(
  MARKS.map((m) => [m.id, m]),
);

export function defaultMarkConfigs(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  MARKS.forEach((m) => {
    out[m.id] = {};
    m.params.forEach((p) => (out[m.id][p.key] = p.def));
  });
  return out;
}

// sx/sy squash the disc around its own center (anticipation, breathing,
// landing impact all drive this from the engine) — 1/1 is the resting shape.
export function drawMicDisc(
  o: { x: number; y: number },
  color: string,
  sx = 1,
  sy = 1,
) {
  const seed = hashSeed("mic-disc");
  const d = roughEllipse(o.x, o.y, 22 * sx, 22 * sy, {
    seed,
    roughness: SKETCH_ROUGHNESS,
    boil: 0,
  });
  strokePath(new Path2D(d), color, 1.25 + 0.25, 0.95);
}

export function drawFlatline(o: { x: number; y: number }, color: string) {
  const seed = hashSeed("flatline");
  const d = roughLine(o.x - 60, o.y, o.x + 60, o.y, {
    seed,
    roughness: SKETCH_ROUGHNESS,
    boil: 0,
  });
  strokePath(new Path2D(d), color, 1.25, 0.85);
}

export function drawIdleSquiggle(
  o: { x: number; y: number },
  t: number,
  color: string,
  boil: number,
) {
  const seed = hashSeed("idle-squiggle");
  const d = roughLine(o.x - 20, o.y, o.x + 20, o.y, {
    seed,
    roughness: SKETCH_ROUGHNESS,
    boil,
    boilSeed: seed,
  });
  strokePath(new Path2D(d), color, 1.25, boil ? 0.5 : 0.6);
}

export function resetWaveformBuf() {
  waveformBuf = [];
}
