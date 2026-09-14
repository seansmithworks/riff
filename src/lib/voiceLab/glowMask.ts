// The glow's gradients and edge mask: one copy, shared by the lab's Stage
// and the real app's voice layer (VoiceStage.tsx).
import { GLOW_TOTAL_BASE } from "./constants";

type GlowOrigin = "center" | "right";

type GlowParams = {
  strength: number;
  size: number;
  height: number;
  colorMix: number;
  edgeSoftness: number;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// Ellipse shapes at size 1 — unaffected by strength/height/colorMix/softness.
const GLOW_SHAPES: Record<
  GlowOrigin,
  { x: number; rx: number; ry: number; cut: number; hue: "cyan" | "green" }[]
> = {
  center: [
    { x: 50, rx: 55, ry: 60, cut: 55, hue: "cyan" },
    { x: 60, rx: 45, ry: 50, cut: 60, hue: "green" },
  ],
  right: [
    { x: 88, rx: 40, ry: 55, cut: 55, hue: "cyan" },
    { x: 94, rx: 32, ry: 45, cut: 60, hue: "green" },
  ],
};

// Single source of truth for the glow's background gradients AND its
// clipping mask. Split into one background per hue so the engine can drive
// each hue's opacity/scale directly every frame (attachGlow) without ever
// touching the mask, which lives on a wrapper that never animates — the
// mask, not the gradients' own geometry, is what guarantees the glow clears
// every edge: its bands always land on an explicit 0%/100% transparent
// stop, independent of size/height/strength, so retuning those can never
// reintroduce a hard line.
export function buildGlow(origin: GlowOrigin, p: GlowParams) {
  const cyanAlpha = clamp(GLOW_TOTAL_BASE * p.colorMix * p.strength, 0, 1);
  const greenAlpha = clamp(
    GLOW_TOTAL_BASE * (1 - p.colorMix) * p.strength,
    0,
    1,
  );
  const hueColor = {
    cyan: `rgba(0,245,241,${cyanAlpha})`,
    green: `rgba(183,255,0,${greenAlpha})`,
  };
  const backgroundFor = (hue: "cyan" | "green") =>
    GLOW_SHAPES[origin]
      .filter((s) => s.hue === hue)
      .map(
        (s) =>
          `radial-gradient(ellipse ${s.rx * p.size}% ${s.ry * p.size}% at ${s.x}% ${p.height}%, ${hueColor[s.hue]}, transparent ${s.cut}%)`,
      )
      .join(", ");

  const bottomBand = clamp(25 * p.edgeSoftness, 1, 45);
  const topBand = clamp(10 * p.edgeSoftness, 0.5, 45);
  const sideBand = clamp(6 * p.edgeSoftness, 0.5, 45);
  const mask = `linear-gradient(to top, transparent 0%, black ${bottomBand}%, black ${100 - topBand}%, transparent 100%), linear-gradient(to right, transparent 0%, black ${sideBand}%, black ${100 - sideBand}%, transparent 100%)`;

  return {
    cyanBackground: backgroundFor("cyan"),
    greenBackground: backgroundFor("green"),
    mask,
  };
}
