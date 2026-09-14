// Sean's tuned voice-lab values: the one copy. Panels.tsx reads these as its
// DialKit defaults (control names and keys unchanged, so saved dials keep
// applying), and engine.ts builds both defaultEngineConfig() and
// createProductionConfig() from them. Change a tuned value here, nowhere else.
//
// Plain data plus pure level math, with type-only imports, so `node --test`
// can load this file directly.
import type { BuildConfig, CinderConfig, OriginSide, Role } from "./types";
import type { StreamMode, StreamPace } from "./stream";
import type { MorphId } from "./morph";

type GlowStyle = "fluid" | "dots" | "both" | "classic";

export type LevelCalibration = {
  // Multiplies the normalized level after floor and curve.
  gain: number;
  // Normalized level (0-1) treated as silence; the rest is rescaled to 0-1.
  floor: number;
  // Exponent on the floored level: <1 lifts quiet input, >1 suppresses it.
  curve: number;
};

export const TUNED: {
  voiceRoles: Record<Role, { mark: string; color: string }>;
  toggles: {
    origin: OriginSide;
    centerCircle: boolean;
    onsetRings: boolean;
    cinders: boolean;
    showFrames: boolean;
  };
  paper: {
    paperOn: boolean;
    pitch: number;
    dotSize: number;
    baseOpacity: number;
  };
  glow: {
    ambientGlow: boolean;
    strength: number;
    size: number;
    height: number;
    colorMix: number;
    edgeSoftness: number;
    style: GlowStyle;
    fluidHumanColor: string;
    fluidRiffColor: string;
    fluidMixSoftness: number;
    fluidFlowSpeed: number;
    fluidBlobScale: number;
    fluidBlobCount: number;
    fluidEdge: number;
    fluidGrain: number;
    fluidLayers: number;
    roleColor: number;
    bleedAmount: number;
  };
  cinders: CinderConfig;
  build: BuildConfig;
  disc: { stretchAmount: number; squishBounce: number; wobble: number };
  morph: {
    style: MorphId;
    speed: number;
    intensity: number;
    breath: { scale: number };
    shapeshift: { sproutDelay: number; backchannelSprout: number };
    relay: {
      gatherMs: number;
      holdMs: number;
      releasePunch: number;
      landingBead: boolean;
    };
    inkwash: { stagger: number; stain: number; wetBloom: number; nib: boolean };
    elastic: { squash: number; wobble: number };
  };
  stream: {
    mode: StreamMode;
    pace: StreamPace;
    bufferMs: number;
    outlineMs: number;
    frame1Ms: number;
    frame2Ms: number;
  };
  sequence: string;
  // Real-audio calibration, applied only to injected level data (never the
  // lab's synthetic levels). Neutral until Sean tunes it on a live session.
  calibration: Record<Role, LevelCalibration>;
  // Real-app listening gate (VoiceStage.tsx): Amoeba shows while the input
  // level (inputLevel in voiceStage.ts: the mean of the SDK's frequency
  // bins, 0-1) is at or above threshold, and holds releaseMs after it drops
  // so it doesn't flicker between syllables. Starting values, uncalibrated.
  listening: { threshold: number; releaseMs: number };
} = {
  // Amoeba = the human mark, Burst = Riff.
  voiceRoles: {
    human: { mark: "amoeba", color: "#542dc3" },
    riff: { mark: "burst", color: "#2e8f50" },
  },
  toggles: {
    origin: "center",
    centerCircle: false,
    onsetRings: false,
    cinders: true,
    showFrames: true,
  },
  paper: { paperOn: true, pitch: 12, dotSize: 1, baseOpacity: 0.3 },
  glow: {
    ambientGlow: true,
    // The mask (Stage.tsx) fades the glow out near the card's edges, so
    // strength boosts the gradients' alphas back to the pre-mask weight.
    strength: 1.5,
    size: 1,
    height: 100,
    colorMix: 1,
    edgeSoftness: 1.5,
    style: "both",
    fluidHumanColor: "#2F6FED",
    fluidRiffColor: "#F5C518",
    fluidMixSoftness: 0.85,
    fluidFlowSpeed: 1.5,
    fluidBlobScale: 1.6,
    fluidBlobCount: 3,
    fluidEdge: 0.7,
    fluidGrain: 0.3,
    fluidLayers: 3,
    roleColor: 0.75,
    bleedAmount: 0.9,
  },
  cinders: {
    cinderCap: 800,
    windStrength: 3,
    burstSize: 120,
    landDurationMs: 600,
    tipSparkRate: 1,
  },
  build: {
    flightSpeed: 1,
    arc: 0.27,
    densityFrame: 3,
    densityBlocks: 3,
    densityDetails: 3,
    tierGapMs: 120,
    speculativeFrame: "construction",
    guideDots: "dots",
    arrival: "comet",
    snapToGrid: true,
    dotPop: 0.8,
    waitEmberRate: 8,
  },
  disc: { stretchAmount: 0.35, squishBounce: 0.35, wobble: 0.15 },
  morph: {
    style: "inkwash",
    speed: 0.9,
    intensity: 1,
    breath: { scale: 1 },
    shapeshift: { sproutDelay: 0.1, backchannelSprout: 0.18 },
    relay: { gatherMs: 140, holdMs: 60, releasePunch: 0.6, landingBead: true },
    inkwash: { stagger: 0.15, stain: 0.6, wetBloom: 0.28, nib: true },
    elastic: { squash: 0.18, wobble: 0.45 },
  },
  // Sean 2026-09-13: stream (A+B) with a bursts pen; batch stays selectable
  // as the A/B baseline.
  stream: {
    mode: "stream",
    pace: "bursts",
    bufferMs: 1500,
    outlineMs: 1500,
    frame1Ms: 2000,
    frame2Ms: 5500,
  },
  // Blend is the base choreography (Sean 2026-09-13).
  sequence: "blend",
  calibration: {
    human: { gain: 1, floor: 0, curve: 1 },
    riff: { gain: 1, floor: 0, curve: 1 },
  },
  listening: { threshold: 0.06, releaseMs: 350 },
};

// A level buffer counts as a source only when it holds data: the SDK hands
// out an empty array when no conversation is connected.
export function hasLevels(
  buf: ArrayLike<number> | null | undefined,
): buf is ArrayLike<number> {
  return !!buf && buf.length > 0;
}

// Copies injected frequency data into `out` (0-255 bytes, the shape the band
// math reads) and applies calibration per bin. A Uint8Array is byte data
// (the SDK's getInput/OutputByteFrequencyData); a Float32Array is 0-1
// normalized. Bins past the source's length are zeroed. Never writes to
// `src`: the SDK reuses its buffer across calls.
export function calibrateLevels(
  src: ArrayLike<number>,
  out: Uint8Array,
  cal: LevelCalibration,
): Uint8Array {
  const toUnit = src instanceof Float32Array ? 1 : 1 / 255;
  const floor = Math.max(0, Math.min(0.99, cal.floor));
  const span = 1 - floor;
  const n = Math.min(src.length, out.length);
  for (let i = 0; i < n; i++) {
    const unit = Math.max(0, Math.min(1, src[i] * toUnit));
    const floored = Math.max(0, unit - floor) / span;
    const v = Math.pow(floored, cal.curve) * cal.gain;
    out[i] = Math.round(Math.max(0, Math.min(1, v)) * 255);
  }
  out.fill(0, n);
  return out;
}
