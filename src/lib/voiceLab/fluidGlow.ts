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
// and the two roles' projected-blob-position arrays never change size
// (fixed FLUID_W×FLUID_H field, ≤4 blobs/role), so there's nothing to
// re-allocate per frame.
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
  // Reinterpreted preset glow.hueBias (docs §"Fluid glow"): 0 = always the
  // shared green blend, 1 = pure role colors.
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

  for (let y = 0; y < h; y++) {
    const vy = y / h;
    for (let x = 0; x < w; x++) {
      const vx = x / w;
      const hDens =
        softUnion(humanPosBuf, humanCount, vx, vy, w, h, minDim) *
        humanActivity;
      const rDens =
        softUnion(riffPosBuf, riffCount, vx, vy, w, h, minDim) * riffActivity;
      const total = hDens + rDens;
      const i = (y * w + x) * 4;
      if (total < 0.003) {
        data[i + 3] = 0;
        continue;
      }
      const density = densityCurve(total);
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

      const alpha = density * opacity;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}
