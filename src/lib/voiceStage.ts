// Pure helpers for the real app's voice layer (VoiceStage.tsx): where the
// lab's 1440x900 stage sits over the bar, how the session's state maps to
// the engine's, and the listening gate. Type-only imports, so `node --test`
// loads this file directly.
import type { VoiceState as EngineVoiceState } from "./voiceLab/types";
import type { VoiceState as AppVoiceState } from "../components/VoiceBar";

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
