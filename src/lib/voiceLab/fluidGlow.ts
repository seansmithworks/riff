// Fluid "shader" glow — no WebGL. A tiny offscreen density field is computed
// per pixel every frame (CPU "shader"), then upscaled via ordinary smooth
// CSS/canvas scaling into the existing glow slot in Stage.tsx. Two roles
// each drive 2-4 slowly drifting, noise-warped blobs; density is combined
// with a pigment-style mix (routed explicitly through green at the
// midpoint) rather than additive RGB, so equal human+riff density reads
// green instead of gray. See docs/voice-lab-sequences.md "Fluid glow".
//
// Ink-and-wash pass (voice-lab-dotgrid-addendum.md §4): the same field is
// composited from 1-3 translucent "glaze" layers (sampled at small spatial
// offsets, each layer alpha-over'd onto the last) instead of one smooth
// ramp, multiplied by a static paper-grain texture, and darkened at its own
// gradient edge for a drying-wash rim. `sampleFluidPixel` exposes the final
// per-pixel result so the engine can also tint/brighten dot-grid paper
// (dotGrid.ts) within the wash's footprint.

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

// bx/by are offsets from the anchor (mic-disc origin), not absolute field
// coordinates — this is what keeps the fluid layer pinned to the same
// footprint the classic glow occupied instead of roaming the whole card.
// by is biased negative (up, toward the sketch) since the anchor already
// sits near the card's bottom edge.
function makeBlobs(seed: number, count: number): Blob[] {
  const rnd = mulberry32(seed);
  const blobs: Blob[] = [];
  for (let i = 0; i < count; i++) {
    blobs.push({
      bx: (rnd() - 0.5) * 0.3,
      by: -0.06 - rnd() * 0.16,
      freqX: 0.15 + rnd() * 0.25,
      freqY: 0.13 + rnd() * 0.22,
      phaseX: rnd() * Math.PI * 2,
      phaseY: rnd() * Math.PI * 2,
      driftR: 0.05 + rnd() * 0.07,
      sigma: 0.1 + rnd() * 0.07,
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

type BlobPos = { x: number; y: number; sigma: number };

// Reused every frame instead of allocated — ImageData, its backing buffer,
// the two roles' projected-blob-position arrays, the layer accumulators, and
// the static grain texture never change size (fixed FLUID_W×FLUID_H field,
// ≤4 blobs/role, ≤3 glaze layers), so there's nothing to re-allocate per
// frame.
let cachedImg: ImageData | null = null;
const humanPosBuf: BlobPos[] = [0, 1, 2, 3].map(() => ({
  x: 0,
  y: 0,
  sigma: 0,
}));
const riffPosBuf: BlobPos[] = [0, 1, 2, 3].map(() => ({
  x: 0,
  y: 0,
  sigma: 0,
}));

const FIELD_N = FLUID_W * FLUID_H;
const accR = new Float32Array(FIELD_N);
const accG = new Float32Array(FIELD_N);
const accB = new Float32Array(FIELD_N);
const accA = new Float32Array(FIELD_N);
const alphaPre = new Float32Array(FIELD_N); // pre-grain/edge alpha, for edge-detect

// Static paper-grain texture (granulation), generated once and box-blurred
// slightly so pigment "settles" in soft clumps rather than per-pixel static.
// Deliberately independent of the DOM dot grid's own pitch (it lives on the
// small field canvas, upscaled) — "aligned to the grid" per the addendum
// means it reads as consistent paper texture at the same footprint the dots
// occupy, not a literal per-dot lookup.
const GRAIN = (() => {
  const raw = new Float32Array(FIELD_N);
  const rnd = mulberry32(0xc0ffee);
  for (let i = 0; i < FIELD_N; i++) raw[i] = rnd();
  const out = new Float32Array(FIELD_N);
  for (let y = 0; y < FLUID_H; y++) {
    for (let x = 0; x < FLUID_W; x++) {
      let sum = 0,
        n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= FLUID_H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= FLUID_W) continue;
          sum += raw[yy * FLUID_W + xx];
          n++;
        }
      }
      // Bias toward [0.55, 1] so grain only ever darkens/mutes, never blows
      // out — a drying wash never gets *brighter* from paper texture.
      out[y * FLUID_W + x] = 0.55 + (sum / n) * 0.45;
    }
  }
  return out;
})();

// Soft union (screen-blend), not a sum: overlapping blobs approach 1 but
// never exceed it regardless of blob count, so density never plateaus into
// a flat box the way `min(1, sum)` did.
function softUnion(
  pos: BlobPos[],
  count: number,
  vx: number,
  vy: number,
  w: number,
  h: number,
  minDim: number,
): number {
  let keep = 1;
  for (let i = 0; i < count; i++) {
    const b = pos[i];
    const dx = (vx - b.x) * (w / minDim);
    const dy = (vy - b.y) * (h / minDim);
    const contrib = Math.exp(-(dx * dx + dy * dy) / (2 * b.sigma * b.sigma));
    keep *= 1 - contrib;
  }
  return 1 - keep;
}

// Peak-density curve: maps the combined (0-~2) union density through a soft
// exponential so a fully-overlapped, full-activity peak lands around 0.78 —
// ambient light behind the sketch, never a saturated fill.
function densityCurve(total: number): number {
  return 1 - Math.exp(-1.4 * total);
}

export type FluidGlowParams = {
  humanColor: string;
  riffColor: string;
  mixSoftness: number; // 0-1: how wide the green blend region is
  flowSpeed: number; // 0-2ish: blob drift speed
  blobScale: number; // 0.5-2: multiplies each blob's radius
  blobCount: number; // 1-4 per role
  // Role-color dominance (docs §"Fluid glow" / dotgrid addendum §3): 0 =
  // always the shared green blend, 1 = pure role colors. Computed by the
  // engine from the "Role color" dial × the active preset's hueBias scale
  // (see engine.ts roleColorDominance()) — this file just applies whatever
  // number it's given.
  hueBias: number;
  opacity: number; // overall envelope — glowFollower × ambient × reducedMul
  // Anchor (mic-disc origin) in normalized field coords [0-1], same point
  // the classic glow's gradients were centered on. Blobs drift around this,
  // not the whole card.
  originX: number;
  originY: number;
  // Classic glow's own size dial — scales blob radii the same way it scaled
  // the classic gradient ellipses, so Fluid/Classic occupy the same
  // footprint at a given dial setting.
  glowSize: number;
  // Ink-and-wash dials (addendum §4).
  edgeAmount: number; // 0-1: wet-edge/bloom darkening at the density rim
  grainAmount: number; // 0-1: paper-grain multiply strength
  layers: number; // 1-3: translucent glaze layers, composited not ramped
};

// Small, fixed per-layer spatial offsets (normalized field units) so glazes
// read as separate translucent washes rather than one smooth alpha ramp.
const LAYER_OFFSETS: [number, number][] = [
  [0, 0],
  [0.018, -0.012],
  [-0.014, 0.02],
];

// Renders one frame of the density field directly onto a small canvas's 2D
// context via putImageData. Cheap: FLUID_W × FLUID_H × ≤8 blobs × ≤3 layers
// per frame.
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
  if (!cachedImg) cachedImg = ctx.createImageData(w, h);
  const img = cachedImg;
  const data = img.data;
  const humanRgb = hexToRgb(p.humanColor);
  const riffRgb = hexToRgb(p.riffColor);
  const softExp = 1 + Math.max(0, Math.min(1, p.mixSoftness)) * 3;
  const hueBias = Math.max(0, Math.min(1, p.hueBias));
  const opacity = Math.max(0, Math.min(1.2, p.opacity));
  const timeSec = (t / 1000) * (0.3 + Math.max(0, p.flowSpeed) * 0.7);
  const minDim = Math.min(w, h);
  const grainAmount = Math.max(0, Math.min(1, p.grainAmount));
  const edgeAmount = Math.max(0, Math.min(1, p.edgeAmount));
  const layers = Math.max(1, Math.min(3, Math.round(p.layers)));
  // glowSize scales blob radii the same way it scales the classic gradient
  // ellipses (buildGlow's rx/ry * size), so switching Fluid/Classic at a
  // given dial setting keeps the same footprint.
  const blobScale = Math.max(0.1, p.blobScale) * Math.max(0.1, p.glowSize);
  const ox = p.originX;
  const oy = p.originY;

  // Project each role's blobs into the reused position buffers in place —
  // no per-frame array/object allocation.
  const projectRole = (blobs: Blob[], buf: BlobPos[], phaseOffset: number) => {
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      buf[i].x =
        ox +
        b.bx +
        Math.sin(timeSec * b.freqX * 2 * Math.PI + b.phaseX + phaseOffset) *
          b.driftR;
      buf[i].y =
        oy +
        b.by +
        Math.cos(timeSec * b.freqY * 2 * Math.PI + b.phaseY + phaseOffset) *
          b.driftR;
      buf[i].sigma = b.sigma * blobScale;
    }
  };
  projectRole(humanBlobs, humanPosBuf, 0);
  projectRole(riffBlobs, riffPosBuf, 1.7);
  const humanCount = humanBlobs.length;
  const riffCount = riffBlobs.length;

  // Pass 1: composite `layers` translucent glazes into accR/accG/accB/accA,
  // each glaze sampled at a small fixed spatial offset so the wash reads as
  // layered washes, not a single smooth ramp (addendum "glazes").
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let l = 0; l < layers; l++) {
        const [offX, offY] = LAYER_OFFSETS[l];
        const vx = x / w + offX;
        const vy = y / h + offY;
        // Wet-in-wet: warp the sampling point along the static grain field
        // so the human/riff boundary bleeds along an irregular edge instead
        // of a linear crossfade. Scaled off Grain — no separate dial needed.
        const warp = (GRAIN[idx] - 0.775) * 0.35 * grainAmount;
        const hDens =
          softUnion(
            humanPosBuf,
            humanCount,
            vx + warp,
            vy - warp,
            w,
            h,
            minDim,
          ) * humanActivity;
        const rDens =
          softUnion(riffPosBuf, riffCount, vx - warp, vy + warp, w, h, minDim) *
          riffActivity;
        const total = hDens + rDens;
        if (total < 0.003) continue;
        const density = densityCurve(total);
        // frac: 0 = pure human, 1 = pure riff. Route explicitly through
        // green at the midpoint (rather than a straight RGB or hue lerp) so
        // equal densities read green, not gray or an arbitrary in-between
        // hue.
        const frac = rDens / (total + 1e-5);
        const dist = Math.abs(frac - 0.5) * 2;
        const remapped =
          0.5 + Math.sign(frac - 0.5) * Math.pow(dist, softExp) * 0.5;
        let lr: number, lg: number, lb: number;
        if (remapped <= 0.5) {
          const tt = remapped * 2;
          lr = lerp(humanRgb[0], GREEN_RGB[0], tt);
          lg = lerp(humanRgb[1], GREEN_RGB[1], tt);
          lb = lerp(humanRgb[2], GREEN_RGB[2], tt);
        } else {
          const tt = (remapped - 0.5) * 2;
          lr = lerp(GREEN_RGB[0], riffRgb[0], tt);
          lg = lerp(GREEN_RGB[1], riffRgb[1], tt);
          lb = lerp(GREEN_RGB[2], riffRgb[2], tt);
        }
        lr = lerp(GREEN_RGB[0], lr, hueBias);
        lg = lerp(GREEN_RGB[1], lg, hueBias);
        lb = lerp(GREEN_RGB[2], lb, hueBias);
        const layerAlpha = (density / layers) * 1.3; // glazes stack toward densityCurve's peak
        // Standard alpha-over compositing: each glaze is a translucent wash
        // laid on top of the previous one.
        const outA = layerAlpha + a * (1 - layerAlpha);
        if (outA > 0) {
          r = (lr * layerAlpha + r * a * (1 - layerAlpha)) / outA;
          g = (lg * layerAlpha + g * a * (1 - layerAlpha)) / outA;
          b = (lb * layerAlpha + b * a * (1 - layerAlpha)) / outA;
        }
        a = outA;
      }
      accR[idx] = r;
      accG[idx] = g;
      accB[idx] = b;
      accA[idx] = Math.min(1, a);
      alphaPre[idx] = accA[idx];
    }
  }

  // Pass 2: wet-edge darkening (gradient-magnitude rim of the pre-grain
  // alpha) + paper-grain multiply, then write final pixels.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const i = idx * 4;
      let a = accA[idx];
      if (a < 0.003) {
        data[i + 3] = 0;
        continue;
      }
      // Sobel-lite gradient magnitude on the alpha channel — a soft ring
      // wherever density crosses its own boundary, like a drying wash's
      // darker rim.
      const xm = x > 0 ? alphaPre[idx - 1] : alphaPre[idx];
      const xp = x < w - 1 ? alphaPre[idx + 1] : alphaPre[idx];
      const ym = y > 0 ? alphaPre[idx - w] : alphaPre[idx];
      const yp = y < h - 1 ? alphaPre[idx + w] : alphaPre[idx];
      const grad = Math.hypot(xp - xm, yp - ym);
      const edge = Math.min(1, grad * 6) * edgeAmount;

      let r = accR[idx];
      let g = accG[idx];
      let b = accB[idx];
      // Darken (toward the pigment's own color, not black) at the rim.
      const darken = 1 - edge * 0.4;
      r *= darken;
      g *= darken;
      b *= darken;

      // Granulation: multiply toward the static grain texture, biased so it
      // only ever mutes.
      const grainMul = lerp(1, GRAIN[idx], grainAmount);
      a *= grainMul;

      const alpha = a * opacity;
      data[i] = Math.round(Math.max(0, Math.min(255, r)));
      data[i + 1] = Math.round(Math.max(0, Math.min(255, g)));
      data[i + 2] = Math.round(Math.max(0, Math.min(255, b)));
      data[i + 3] = Math.round(Math.max(0, Math.min(255, alpha * 255)));
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Samples the last-rendered field at a normalized [0-1] card position —
// bilinear, and *not* clamped to the nearest edge texel outside the field's
// own [0,1] extent: a query past the edge blends toward transparent instead
// of repeating the boundary pixel, so dot tinting (the only caller) inherits
// the wash's own soft falloff instead of inventing a hard edge of its own.
// Corners are premultiplied before interpolating so a fully-transparent
// neighbor's stale (never-repainted-this-frame) RGB bytes can't bleed a
// wrong color into the result. Returns fully transparent before the first
// render.
export function sampleFluidPixelBilinear(
  nx: number,
  ny: number,
): [number, number, number, number] {
  if (!cachedImg) return [0, 0, 0, 0];
  const data = cachedImg.data;
  const sample = (xx: number, yy: number): [number, number, number, number] => {
    if (xx < 0 || xx >= FLUID_W || yy < 0 || yy >= FLUID_H) return [0, 0, 0, 0];
    const i = (yy * FLUID_W + xx) * 4;
    const a = data[i + 3] / 255;
    return [data[i] * a, data[i + 1] * a, data[i + 2] * a, a];
  };
  const fx = nx * FLUID_W - 0.5;
  const fy = ny * FLUID_H - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const c00 = sample(x0, y0);
  const c10 = sample(x0 + 1, y0);
  const c01 = sample(x0, y0 + 1);
  const c11 = sample(x0 + 1, y0 + 1);
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const top = lerp(c00[k], c10[k], tx);
    const bot = lerp(c01[k], c11[k], tx);
    out[k] = lerp(top, bot, ty);
  }
  const a = out[3];
  if (a < 0.003) return [0, 0, 0, 0];
  return [out[0] / a, out[1] / a, out[2] / a, a];
}

// Static-grain lookup (the same texture the wash multiplies against, see
// GRAIN above) at a normalized [0-1] card position — lets the dot tint
// granulate with the identical paper texture the wash itself settles into,
// instead of inventing a second noise field.
export function sampleGrainAt(nx: number, ny: number): number {
  const x = Math.max(0, Math.min(FLUID_W - 1, Math.round(nx * FLUID_W)));
  const y = Math.max(0, Math.min(FLUID_H - 1, Math.round(ny * FLUID_H)));
  return GRAIN[y * FLUID_W + x];
}
