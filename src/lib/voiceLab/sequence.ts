// Data model + easing/spring evaluators + player for the voice-lab
// choreography presets (spec: docs/voice-lab-sequences.md §2-3). Every preset
// is pure data (sequences.ts); this file only knows how to *evaluate* that
// data — it never branches on a preset id.
import type { VoiceState } from "./types";

export type Ease =
  | { kind: "bezier"; p: [number, number, number, number] }
  | { kind: "spring"; bounce: number } // Apple-style; Tween.ms = duration
  | { kind: "steps"; n: number };
export type Tween = { ms: number; ease: Ease };

// Easing tokens (spec §2).
export const EASE_OUT: Ease = { kind: "bezier", p: [0.23, 1, 0.32, 1] };
export const EASE_INOUT: Ease = { kind: "bezier", p: [0.77, 0, 0.175, 1] };
export const EASE_ARRIVE: Ease = { kind: "bezier", p: [0.16, 1, 0.3, 1] };
export const EASE_EASE: Ease = { kind: "bezier", p: [0.25, 0.1, 0.25, 1] };

export type Beat = { at: number } & (
  | { kind: "voice"; state: VoiceState }
  | { kind: "yield" }
  | { kind: "backchannel" }
  | { kind: "job"; event: "start" | "ready" | "clear" }
);

export type HandoffStyle = "cut" | "crossfade" | "throughDisc";
export type LandingImpact =
  { kind: "ticks" } | { kind: "none" } | { kind: "squash"; bounce: number };

export type SequencePreset = {
  id: string;
  hotkey: "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "0" | "B";
  name: string;
  thesis: string;
  loopMs: number;
  beats: Beat[];
  handoff: {
    style: HandoffStyle;
    humanIn: Tween;
    humanOut: Tween;
    riffIn: Tween;
    riffOut: Tween;
    smearFrames: 0 | 1 | 2;
    entryPunch: number;
  };
  anticipation: { depth: number; ms: number };
  backchannel: { presence: number; ms: number };
  silenceHolder: "human" | "riff" | "none";
  breathe: { periodMs: number; depth: number };
  stepFps: number;
  markPeak: number;
  envelope: { attackMs: number; releaseMs: number };
  glow: {
    level: Record<VoiceState, number>;
    hueBias: number;
    // True when this preset's own overrides set `glow.hueBias` explicitly
    // (as opposed to inheriting BASE's 0). Fluid role-color dominance
    // (engine.ts#roleColorDominance, dotgrid addendum §3) only lets a
    // preset's hueBias *scale* Sean's "Role color" dial when this is true —
    // BASE counts as "no opinion", not "always green".
    hueBiasExplicit: boolean;
    follow: number;
    swell: number;
  };
  job: {
    emit: "stream" | "onsets" | "gaps" | "none";
    duck: number;
    burstUnderlay: number;
  };
  landing: {
    policy: "immediate" | "nextGap";
    maxHoldMs: number;
    hitStopMs: number;
    tipBurst: number;
    riffNod: boolean;
    inkStaggerMs: number;
    impact: LandingImpact;
  };
};

// ---- Easing evaluation ------------------------------------------------

// Cubic-bezier progress solve (x = time fraction, y = eased progress),
// Newton-Raphson with bisection fallback — same shape as CSS's own
// cubic-bezier(x1,y1,x2,y2) timing function.
function cubicBezier(p: [number, number, number, number], x: number): number {
  const [x1, y1, x2, y2] = p;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const sampleCurveX = (t: number) =>
    3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const sampleCurveY = (t: number) =>
    3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const xEst = sampleCurveX(t) - x;
    if (Math.abs(xEst) < 1e-4) break;
    const d =
      3 * (1 - t) * (1 - t) * x1 +
      6 * (1 - t) * t * (x2 - x1) +
      3 * t * t * (1 - x2);
    if (Math.abs(d) < 1e-6) break;
    t -= xEst / d;
  }
  return sampleCurveY(Math.min(1, Math.max(0, t)));
}

// Duration-normalized spring: bounce 0 = critically damped, closer to 1 =
// underdamped/oscillatory. Settles by roughly `ms` regardless of bounce.
function springProgress(bounce: number, elapsedFrac: number): number {
  const zeta = Math.max(0.02, 1 - Math.max(0, Math.min(0.9, bounce)));
  const wn = 2 * Math.PI; // one natural period across the nominal duration
  const t = Math.max(0, elapsedFrac);
  if (zeta < 1) {
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    return (
      1 -
      Math.exp(-zeta * wn * t) *
        (Math.cos(wd * t) + ((zeta * wn) / wd) * Math.sin(wd * t))
    );
  }
  return 1 - Math.exp(-wn * t) * (1 + wn * t);
}

export function evalEase(ease: Ease, frac: number): number {
  const f = Math.max(0, Math.min(1, frac));
  if (ease.kind === "bezier") return cubicBezier(ease.p, f);
  if (ease.kind === "steps") {
    const n = Math.max(1, ease.n);
    return Math.min(n, Math.floor(f * n)) / n;
  }
  // Spring can overshoot past 1 briefly (bounce); callers that need a
  // strictly 0-1 presence value should clamp.
  return springProgress(ease.bounce, frac * 1.05);
}

// Returns eased progress 0..1 (springs may overshoot slightly) for a tween
// given how many ms have elapsed since it started.
export function tweenProgress(tween: Tween, elapsedMs: number): number {
  if (tween.ms <= 0) return 1;
  return evalEase(tween.ease, elapsedMs / tween.ms);
}

// ---- Player -------------------------------------------------------------

// Narrow surface the player drives — implemented by VoiceLabEngine. Keeping
// this as an interface (rather than importing the engine class) keeps
// sequence.ts framework-agnostic and prevents any per-preset branching from
// creeping into the engine.
export interface SequenceHost {
  setVoiceState(state: VoiceState): void;
  getVoiceState(): VoiceState;
  startSketch(): void;
  landNow(): void;
  setJobState(state: "none" | "sketching" | "landing"): void;
  triggerAnticipation(depth: number, ms: number): void;
  triggerBackchannel(presence: number, ms: number): void;
  isVoiceGap(): boolean;
}

export class SequencePlayer {
  private preset: SequencePreset | null = null;
  private startedAt = 0;
  private lastFiredIdx = -1;
  private lastLoopIndex = -1;
  private jobReadyAt: number | null = null;
  playing = false;

  constructor(private host: SequenceHost) {}

  setPreset(preset: SequencePreset, t: number) {
    this.preset = preset;
    this.restart(t);
  }

  restart(t: number) {
    this.startedAt = t;
    this.lastFiredIdx = -1;
    this.lastLoopIndex = -1;
    this.jobReadyAt = null;
  }

  play() {
    this.playing = true;
  }

  pause() {
    this.playing = false;
  }

  tick(t: number, timeScale: number) {
    if (!this.playing || !this.preset) return;
    const elapsed = (t - this.startedAt) * timeScale;
    const loopMs = this.preset.loopMs;
    const loopIndex = Math.floor(elapsed / loopMs);
    const loopPos = elapsed - loopIndex * loopMs;
    if (loopIndex !== this.lastLoopIndex) {
      this.lastLoopIndex = loopIndex;
      this.lastFiredIdx = -1;
      this.jobReadyAt = null;
    }
    for (let i = this.lastFiredIdx + 1; i < this.preset.beats.length; i++) {
      const beat = this.preset.beats[i];
      if (beat.at > loopPos) break;
      this.fireBeat(beat, t);
      this.lastFiredIdx = i;
    }
    if (this.jobReadyAt !== null) {
      const held = t - this.jobReadyAt;
      const gapNow = this.host.isVoiceGap();
      if (gapNow || held >= this.preset.landing.maxHoldMs) {
        this.host.landNow();
        this.jobReadyAt = null;
      }
    }
  }

  // Absolute time (same clock as `t`) of the next beat matching `pred`, at or
  // after the current loop position — wrapping into the next loop if none
  // remain in this one. Used by build.ts's fitBuildToBeats to clamp a build
  // so it ends before the preset's own "clear" beat. Null if this preset has
  // no matching beat at all, or no preset/player is active.
  nextBeatAt(
    t: number,
    timeScale: number,
    pred: (b: Beat) => boolean,
  ): number | null {
    if (!this.preset) return null;
    const elapsed = (t - this.startedAt) * timeScale;
    const loopMs = this.preset.loopMs;
    const loopPos = ((elapsed % loopMs) + loopMs) % loopMs;
    const loopStartAbs = t - loopPos / timeScale;
    for (const b of this.preset.beats) {
      if (b.at >= loopPos && pred(b)) return loopStartAbs + b.at / timeScale;
    }
    for (const b of this.preset.beats) {
      if (pred(b)) return loopStartAbs + (loopMs + b.at) / timeScale;
    }
    return null;
  }

  // Loop progress 0..1 for the picker's beat-tick progress bar.
  progress(t: number, timeScale: number): number {
    if (!this.preset) return 0;
    const elapsed = (t - this.startedAt) * timeScale;
    const loopMs = this.preset.loopMs;
    return (((elapsed % loopMs) + loopMs) % loopMs) / loopMs;
  }

  private fireBeat(beat: Beat, t: number) {
    if (!this.preset) return;
    if (beat.kind === "voice") this.host.setVoiceState(beat.state);
    else if (beat.kind === "yield")
      this.host.triggerAnticipation(
        this.preset.anticipation.depth,
        this.preset.anticipation.ms,
      );
    else if (beat.kind === "backchannel")
      this.host.triggerBackchannel(
        this.preset.backchannel.presence,
        this.preset.backchannel.ms,
      );
    else if (beat.kind === "job") {
      if (beat.event === "start") this.host.startSketch();
      else if (beat.event === "clear") this.host.setJobState("none");
      else if (beat.event === "ready") {
        if (this.preset.landing.policy === "immediate") this.host.landNow();
        else this.jobReadyAt = t;
      }
    }
  }
}
