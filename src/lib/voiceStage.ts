// Pure helpers for the real app's voice layer (VoiceStage.tsx): where the
// lab's 1440x900 stage sits over the bar, how the session's state maps to
// the engine's, the listening gate, and a synthetic speech-like feed for dev
// evidence. Type-only imports, so `node --test` loads this file directly.
import type { VoiceState as EngineVoiceState } from "./voiceLab/types";
import type { VoiceState as AppVoiceState } from "../components/VoiceBar";

export const LEVEL_BINS = 1024;

// The marks' reach around the engine's origin, in stage px at scale 1,
// measured from ink pixels at 1440x900 (2026-09-13): Burst at full level
// reaches 210 above and 88 below (its side rays), speech-like 196 and 56;
// Amoeba 88 and 28. The stage sits so the lowest reach clears the bar by
// MARKS_GAP, and the caption sits MARKS_GAP above the tallest reach.
export const MARKS_BELOW = 90;
export const MARKS_ABOVE = 210;
export const MARKS_GAP = 8;

// Below this the marks would be too small to read on a phone.
export const MIN_STAGE_SCALE = 0.5;

// Scales with the viewport width, never past the lab's own 1:1.
export function stageScale(viewportW: number, stageW: number): number {
  return Math.max(MIN_STAGE_SCALE, Math.min(1, viewportW / stageW));
}

export type StageLayout = {
  scale: number;
  // Stage's top-left corner in viewport px.
  left: number;
  top: number;
  width: number;
  height: number;
  // Space between the bar's top edge and the caption slot.
  captionLift: number;
};

export function stageLayout(p: {
  bar: { left: number; top: number; width: number };
  viewportW: number;
  stageW: number;
  stageH: number;
  // The engine's mark origin in stage px (engine.getOrigin()).
  origin: { x: number; y: number };
  marksBelow: number;
  marksAbove: number;
  gap: number;
}): StageLayout {
  const scale = stageScale(p.viewportW, p.stageW);
  const originX = p.bar.left + p.bar.width / 2;
  const originY = p.bar.top - p.gap - p.marksBelow * scale;
  return {
    scale,
    left: Math.round(originX - p.origin.x * scale),
    top: Math.round(originY - p.origin.y * scale),
    width: Math.round(p.stageW * scale),
    height: Math.round(p.stageH * scale),
    captionLift: Math.round((p.marksBelow + p.marksAbove) * scale + 2 * p.gap),
  };
}

// Riff speaking -> Burst. Listening -> Amoeba while the gate hears input,
// silence otherwise. Mic blocked -> dead mic. Everything else -> idle. A dev
// fixture has no audio to gate on, so its listening state shows Amoeba.
export function engineVoiceState(
  app: AppVoiceState,
  o: { fixture: boolean; talking: boolean },
): EngineVoiceState {
  switch (app) {
    case "speaking":
      return "riff-talking";
    case "listening":
    case "silence":
      if (o.fixture) return app === "listening" ? "you-talking" : "silence";
      return o.talking ? "you-talking" : "silence";
    case "mic-blocked":
      return "dead-mic";
    default:
      return "idle";
  }
}

export type TalkGate = { talking: boolean; lastAboveAt: number };

// Opens the moment the level reaches threshold; closes once it has stayed
// below for releaseMs.
export function stepTalkGate(
  gate: TalkGate,
  level: number,
  now: number,
  cfg: { threshold: number; releaseMs: number },
): boolean {
  if (level >= cfg.threshold) {
    gate.lastAboveAt = now;
    gate.talking = true;
  } else if (gate.talking && now - gate.lastAboveAt >= cfg.releaseMs) {
    gate.talking = false;
  }
  return gate.talking;
}

// Mean of a frequency buffer, 0-1 (the SDK's getVolume math). Bytes are
// 0-255; a Float32Array is already 0-1.
export function inputLevel(buf: ArrayLike<number> | null | undefined): number {
  if (!buf || buf.length === 0) return 0;
  const unit = buf instanceof Float32Array ? 1 : 1 / 255;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i];
  return Math.max(0, Math.min(1, (sum / buf.length) * unit));
}

// Any array of levels as a 1024-bin byte frame (Float32Array reads as 0-1).
export function toLevelFrame(src: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(LEVEL_BINS);
  const scale = src instanceof Float32Array ? 255 : 1;
  const n = Math.min(src.length, LEVEL_BINS);
  for (let i = 0; i < n; i++)
    out[i] = Math.round(Math.max(0, Math.min(255, src[i] * scale)));
  return out;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, i))];
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bump(i: number, center: number, width: number): number {
  const d = (i - center) / width;
  return Math.exp(-d * d);
}

// SYNTHETIC speech-like frequency frames: no recording of the SDK's data
// exists yet. 1024 bins shaped like its resampled 100-8000 Hz output, energy
// falling with frequency plus three formant bumps that move per syllable,
// under a syllable envelope (~0.14-0.32s) with pauses. Deterministic per seed.
export function syntheticSpeechFrames(
  seconds: number,
  fps = 60,
  seed = 1,
): Uint8Array[] {
  const rnd = mulberry32(seed);
  const count = Math.max(0, Math.round(seconds * fps));
  const frames: Uint8Array[] = [];
  let start = 0;
  let dur = 0;
  let amp = 0;
  let f1 = 0;
  let f2 = 0;
  let f3 = 0;
  for (let k = 0; k < count; k++) {
    const t = k / fps;
    if (t >= start + dur) {
      const pause = rnd() < 0.2;
      start = t;
      dur = pause ? 0.18 + rnd() * 0.3 : 0.14 + rnd() * 0.18;
      amp = pause ? 0 : 0.5 + rnd() * 0.5;
      f1 = 30 + rnd() * 50;
      f2 = 120 + rnd() * 110;
      f3 = 300 + rnd() * 140;
    }
    const env = amp * Math.sin(Math.PI * Math.min(1, (t - start) / dur));
    const frame = new Uint8Array(LEVEL_BINS);
    for (let i = 0; i < LEVEL_BINS; i++) {
      const tilt = Math.exp(-i / 240);
      const voice =
        (0.35 * tilt +
          0.75 * bump(i, f1, 22) +
          0.5 * bump(i, f2, 38) +
          0.3 * bump(i, f3, 60)) *
        env;
      const noise = (0.03 + rnd() * 0.04) * tilt;
      frame[i] = Math.round(Math.min(1, voice + noise) * 255);
    }
    frames.push(frame);
  }
  return frames;
}

// Dev readout: what the engine last read for a role, after calibration.
export type RoleReadout = {
  live: boolean;
  input: number;
  level: number;
  bands: number[];
};

export type VoiceReadout = {
  human: RoleReadout;
  riff: RoleReadout;
  talking: boolean;
  state: string;
};
