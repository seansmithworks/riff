// Sketch-rendering constants, matched to the standalone prototype and to
// DESIGN.md (`wireframeInk` / `accentDecorative`).

export const W = 1440;
export const H = 900;

export const SKETCH_ROUGHNESS = 0.6;
export const SKETCH_STROKE_WIDTH = 1.25;
export const SKETCH_LINE_ROUGHNESS = 0.55;
export const INK = "#3f3f46";
export const RIFF_GREEN = "#3FBA6A";

export function hashSeed(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++)
    hash = (hash * 33) ^ input.charCodeAt(i);
  return hash >>> 0;
}

export function firstStroke(doubledPath: string): string {
  const secondMoveIndex = doubledPath.indexOf("M", 1);
  return secondMoveIndex === -1
    ? doubledPath
    : doubledPath.slice(0, secondMoveIndex);
}

export function synthesizeLevelData(t: number): Uint8Array {
  const data = new Uint8Array(1024);
  for (let i = 0; i < 410; i++) {
    const v = 50 + 40 * Math.sin(t / 220 + i * 0.15);
    data[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return data;
}

export const GAIN = 2.5;
export const BIN_COUNT = 410;
export const SLICE_COUNT = 5;
export const SLICE_LEN = Math.floor(BIN_COUNT / SLICE_COUNT);
export const BAR_ORDER = [3, 1, 0, 2, 4];

export function computeBands(
  data: Uint8Array | null,
  prevSmoothed: number[],
): number[] {
  if (!data || data.length === 0) return prevSmoothed.map(() => 0.2);
  const next: number[] = [];
  for (let i = 0; i < SLICE_COUNT; i++) {
    let sum = 0;
    const start = i * SLICE_LEN;
    for (let j = start; j < start + SLICE_LEN; j++) sum += data[j] ?? 0;
    const v = Math.min(1, Math.max(0, (sum / SLICE_LEN / 255) * GAIN));
    next.push(v);
  }
  return prevSmoothed.map((prev, i) => prev * 0.6 + next[i] * 0.4);
}

export function polar(
  cx: number,
  cy: number,
  r: number,
  a: number,
): [number, number] {
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

export function arcPts(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  segs: number,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= segs; i++)
    pts.push(polar(cx, cy, r, a0 + (a1 - a0) * (i / segs)));
  return pts;
}

export function wavePoints(
  cx: number,
  cy: number,
  r: number,
  amp: number,
  freq: number,
  phase: number,
  n: number,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI * 0.85 + (i / n) * Math.PI * 0.7;
    const wob = Math.sin(i * freq + phase) * amp;
    pts.push([cx + (r + wob) * Math.cos(a), cy + (r + wob) * Math.sin(a)]);
  }
  return pts;
}

export function roundRectPath(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
