// Fluid "shader" glow — no WebGL. A tiny offscreen density field is computed
// per pixel every frame (CPU "shader"), then upscaled via ordinary smooth
// CSS/canvas scaling into the existing glow slot in Stage.tsx. Two roles
// each drive 2-4 slowly drifting, noise-warped blobs; density is combined
// with a pigment-style mix (routed explicitly through green at the
// midpoint) rather than additive RGB, so equal human+riff density reads
// green instead of gray. See docs/voice-lab-sequences.md "Fluid glow".

export const FLUID_W = 96;
export const FLUID_H = 60;

// Riff's brand decorative green (DESIGN.md accentDecorative) — the color the
// mix always resolves toward at full overlap / low hueBias, regardless of
// which human/riff hues Sean picks.
const GREEN_RGB: [number, number, number] = [0x3f, 0xba, 0x6a];

type Blob = {
  bx: number;
  by: number;
  freqX: number;
  freqY: number;
  phaseX: number;
  phaseY: number;
  driftR: number;
  sigma: number;
};

// Deterministic PRNG (mulberry32) so each role's blob layout is stable
// across frames/reloads instead of jumping around on every render.
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBlobs(seed: number, count: number): Blob[] {
  const rnd = mulberry32(seed);
  const blobs: Blob[] = [];
  for (let i = 0; i < count; i++) {
    blobs.push({
      bx: 0.25 + rnd() * 0.5,
      by: 0.3 + rnd() * 0.5,
      freqX: 0.15 + rnd() * 0.25,
      freqY: 0.13 + rnd() * 0.22,
      phaseX: rnd() * Math.PI * 2,
      phaseY: rnd() * Math.PI * 2,
      driftR: 0.12 + rnd() * 0.16,
      sigma: 0.22 + rnd() * 0.16,
    });
  }
  return blobs;
}

let humanBlobs = makeBlobs(1, 4);
let riffBlobs = makeBlobs(2, 4);
let cachedCount = 4;

function ensureBlobCount(count: number) {
  const n = Math.max(1, Math.min(4, Math.round(count)));
  if (n === cachedCount) return;
  cachedCount = n;
  humanBlobs = makeBlobs(1, n);
  riffBlobs = makeBlobs(2, n);
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export type FluidGlowParams = {
  humanColor: string;
  riffColor: string;
  mixSoftness: number; // 0-1: how wide the green blend region is
  flowSpeed: number; // 0-2ish: blob drift speed
  blobScale: number; // 0.5-2: multiplies each blob's radius
  blobCount: number; // 1-4 per role
  // Reinterpreted preset glow.hueBias (docs §"Fluid glow"): 0 = always the
  // shared green blend, 1 = pure role colors.
  hueBias: number;
  opacity: number; // overall envelope — glowFollower × ambient × reducedMul
};

// Renders one frame of the density field directly onto a small canvas's 2D
// context via putImageData. Cheap: FLUID_W × FLUID_H × ≤8 blobs per frame.
export function renderFluidGlow(
  ctx: CanvasRenderingContext2D,
  t: number,
  humanActivity: number,
  riffActivity: number,
  p: FluidGlowParams,
) {
  ensureBlobCount(p.blobCount);
  const w = FLUID_W;
  const h = FLUID_H;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const humanRgb = hexToRgb(p.humanColor);
  const riffRgb = hexToRgb(p.riffColor);
  const softExp = 1 + Math.max(0, Math.min(1, p.mixSoftness)) * 3;
  const hueBias = Math.max(0, Math.min(1, p.hueBias));
  const opacity = Math.max(0, Math.min(1.2, p.opacity));
  const timeSec = (t / 1000) * (0.3 + Math.max(0, p.flowSpeed) * 0.7);
  const minDim = Math.min(w, h);
  const blobScale = Math.max(0.1, p.blobScale);

  const projectRole = (blobs: Blob[], phaseOffset: number) =>
    blobs.map((b) => ({
      x:
        b.bx +
        Math.sin(timeSec * b.freqX * 2 * Math.PI + b.phaseX + phaseOffset) *
          b.driftR,
      y:
        b.by +
        Math.cos(timeSec * b.freqY * 2 * Math.PI + b.phaseY + phaseOffset) *
          b.driftR,
      sigma: b.sigma * blobScale,
    }));
  const humanPos = projectRole(humanBlobs, 0);
  const riffPos = projectRole(riffBlobs, 1.7);

  for (let y = 0; y < h; y++) {
    const vy = y / h;
    for (let x = 0; x < w; x++) {
      const vx = x / w;
      let hDens = 0;
      for (const b of humanPos) {
        const dx = (vx - b.x) * (w / minDim);
        const dy = (vy - b.y) * (h / minDim);
        hDens += Math.exp(-(dx * dx + dy * dy) / (2 * b.sigma * b.sigma));
      }
      let rDens = 0;
      for (const b of riffPos) {
        const dx = (vx - b.x) * (w / minDim);
        const dy = (vy - b.y) * (h / minDim);
        rDens += Math.exp(-(dx * dx + dy * dy) / (2 * b.sigma * b.sigma));
      }
      hDens = Math.min(1, hDens) * humanActivity;
      rDens = Math.min(1, rDens) * riffActivity;
      const total = hDens + rDens;
      const i = (y * w + x) * 4;
      if (total < 0.003) {
        data[i + 3] = 0;
        continue;
      }
      // frac: 0 = pure human, 1 = pure riff. Route explicitly through green
      // at the midpoint (rather than a straight RGB or hue lerp) so equal
      // densities read green, not gray or an arbitrary in-between hue.
      const frac = rDens / (total + 1e-5);
      const dist = Math.abs(frac - 0.5) * 2;
      const remapped =
        0.5 + Math.sign(frac - 0.5) * Math.pow(dist, softExp) * 0.5;
      let r: number, g: number, b: number;
      if (remapped <= 0.5) {
        const tt = remapped * 2;
        r = lerp(humanRgb[0], GREEN_RGB[0], tt);
        g = lerp(humanRgb[1], GREEN_RGB[1], tt);
        b = lerp(humanRgb[2], GREEN_RGB[2], tt);
      } else {
        const tt = (remapped - 0.5) * 2;
        r = lerp(GREEN_RGB[0], riffRgb[0], tt);
        g = lerp(GREEN_RGB[1], riffRgb[1], tt);
        b = lerp(GREEN_RGB[2], riffRgb[2], tt);
      }
      r = lerp(GREEN_RGB[0], r, hueBias);
      g = lerp(GREEN_RGB[1], g, hueBias);
      b = lerp(GREEN_RGB[2], b, hueBias);

      const alpha = Math.max(0, Math.min(1, total)) * opacity;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}
