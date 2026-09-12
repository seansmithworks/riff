// Framework-agnostic Canvas2D engine for the voice-lab route.
//
// Two independent channels, per Sean's correction: `voice` (idle /
// you-talking / riff-talking / silence / dead-mic) drives the human-voice
// marks and Riff's wavering-arc voice at all times. `job` (none / sketching
// / landing) drives the drifting cinders and frame-landing animation at all
// times. render_artifact is fire-and-forget in the real app, so a sketch job
// must never suppress or replace the voice layer — both channels draw in the
// same frame, independently.
//
// A `SequencePreset` (sequences.ts) layers choreography on top of both
// channels: per-role presence envelopes (so a handoff crossfades instead of
// cutting), disc squash, glow follow/swell, job ducking, and landing
// theatrics. Presets only ever multiply/gate Sean's own tuned values — see
// docs/voice-lab-sequences.md §5 precedence.
import {
  W,
  H,
  INK,
  RIFF_GREEN,
  GLOW_DEFAULT_STRENGTH,
  GLOW_DEFAULT_SIZE,
  GLOW_DEFAULT_HEIGHT,
  GLOW_DEFAULT_COLOR_MIX,
  GLOW_DEFAULT_EDGE_SOFTNESS,
  synthesizeLevelData,
  computeBands,
  BAR_ORDER,
  hashSeed,
} from "./constants";
import {
  MARKS,
  MARK_BY_ID,
  defaultMarkConfigs,
  setMarksContext,
  setAlphaMul,
  drawMicDisc,
  drawFlatline,
  drawIdleSquiggle,
  strokeChain,
} from "./marks";
import {
  createFrames,
  resetFrames,
  drawFrames,
  drawCinders,
  spawnDustPuff,
  spawnCinder,
  spawnTipSparks,
  updateCinderDrift,
  beginLanding as beginLandingImpl,
  type Frame,
  type Cinder,
  type DustPuff,
} from "./frames";
import type {
  EngineConfig,
  VoiceState,
  JobState,
  Role,
  MarkDef,
  MarkDrawArgs,
} from "./types";
import { VOICE_STATES } from "./types";
import {
  evalEase,
  SequencePlayer,
  type SequenceHost,
  type SequencePreset,
  type Tween,
} from "./sequence";
import {
  SEQUENCE_BY_HOTKEY,
  SEQUENCE_BY_ID,
  SEQUENCE_PRESETS,
  REDUCED_MOTION_PRESET,
} from "./sequences";

export function defaultEngineConfig(): EngineConfig {
  return {
    voiceState: "idle",
    jobState: "none",
    originSide: "center",
    centerCircleOn: true,
    onsetRingsOn: true,
    ambientGlowOn: true,
    glowStrength: GLOW_DEFAULT_STRENGTH,
    glowSize: GLOW_DEFAULT_SIZE,
    glowHeight: GLOW_DEFAULT_HEIGHT,
    glowColorMix: GLOW_DEFAULT_COLOR_MIX,
    glowEdgeSoftness: GLOW_DEFAULT_EDGE_SOFTNESS,
    cindersOn: true,
    showFramesOn: true,
    // Speaker -> mark assignment: Riff = Burst (green), Human = Ripple (ink).
    humanMarkId: "ripple",
    riffMarkId: "burst",
    humanColor: INK,
    riffColor: RIFF_GREEN,
    markConfigsByRole: {
      human: defaultMarkConfigs(),
      riff: defaultMarkConfigs(),
    },
    cinderConfig: {
      cinderCap: 500,
      windStrength: 1.0,
      burstSize: 40,
      landDurationMs: 900,
      tipSparkRate: 0.8,
    },
    reducedMotion: false,
    realMicEnabled: false,
  };
}

export type EngineStatus = {
  voiceState: VoiceState;
  jobState: JobState;
  markName: string;
  originSide: string;
  realMic: boolean;
  reducedMotion: boolean;
  ambientGlowOn: boolean;
  glowStrength: number;
  glowSize: number;
  glowHeight: number;
  glowColorMix: number;
  glowEdgeSoftness: number;
  // Sequence picker state (spec §5 UX).
  sequenceId: string;
  sequenceHotkey: string;
  sequenceName: string;
  sequenceThesis: string;
  sequencePlaying: boolean;
  sequenceProgress: number;
  slowMo: boolean;
  // Effective colorMix (Sean's dial x preset hueBias) — Stage's buildGlow
  // needs this in its dep list so a preset switch retunes the glow shape.
  effectiveColorMix: number;
};

const ZERO_TWEEN: Tween = {
  ms: 0,
  ease: { kind: "bezier", p: [0.25, 0.1, 0.25, 1] },
};

export class VoiceLabEngine implements SequenceHost {
  config: EngineConfig;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private measurePath: SVGPathElement;
  private frames: Frame[];
  private cinders: Cinder[] = [];
  private dustPuffs: DustPuff[] = [];
  private rings: { x: number; y: number; born: number; rot: number }[] = [];
  private onsetPulse = 0;
  private lastOnsetAt = 0;
  private prevUserAvg = 0;
  private nextSyntheticOnsetAt = 0;
  // Riff gets its own onset pulse — it has no real-mic input, so it's
  // always the synthetic-schedule path, analogous to the human one above.
  private riffOnsetPulse = 0;
  private lastRiffOnsetAt = 0;
  private nextRiffOnsetAt = 0;
  private smoothedUser = [0.2, 0.2, 0.2, 0.2, 0.2];
  private smoothedAgent = [0.2, 0.2, 0.2, 0.2, 0.2];
  // Cached from the last frame's active-speaker mark draw call, so sketch-job
  // cinder spawning (which runs before drawVoiceLayer each frame) can read
  // its tip emitters with a harmless one-frame lag.
  private lastMarkContext: { mark: MarkDef; g: MarkDrawArgs } | null = null;
  private boilFrame = 0;
  private lastBoilAt = 0;
  private sketchStartTime = 0;
  private spawnAccumulator = 0;
  private autoLandTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId: number | null = null;
  private staticIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastT = 0;
  private analyser: AnalyserNode | null = null;
  private micDataArray: Uint8Array | null = null;
  private audioCtx: AudioContext | null = null;
  private dotGridCanvas: HTMLCanvasElement;
  private mql: MediaQueryList;
  private onStatus: ((s: EngineStatus) => void) | null = null;
  private destroyed = false;
  private onMqlChange = () => this.scheduleLoop();
  private onVisibilityChange = () => this.scheduleLoop();

  // ---- Choreography state ----
  private activeSequence: SequencePreset = SEQUENCE_PRESETS[0];
  private prevSequenceId: string = this.activeSequence.id;
  private timeScale = 1; // Z = 0.25x slow motion
  player: SequencePlayer = new SequencePlayer(this);

  private presence: Record<Role, number> = { human: 0, riff: 0 };
  private presenceTween: Record<
    Role,
    { from: number; to: number; start: number; tween: Tween }
  > = {
    human: { from: 0, to: 0, start: 0, tween: ZERO_TWEEN },
    riff: { from: 0, to: 0, start: 0, tween: ZERO_TWEEN },
  };
  private smearFramesLeft: Record<Role, number> = { human: 0, riff: 0 };
  private backchannelTimer: ReturnType<typeof setTimeout> | null = null;

  private anticipationStart = 0;
  private anticipationMs = 0;
  private anticipationDepth = 0;

  // Mark clock: dt x timeScale, frozen during hit-stop, quantized when the
  // effective preset's stepFps > 0. Mic sampling stays on the real clock.
  private markClock = 0;
  private markT = 0;
  private hitStopUntil = 0;

  // Glow — engine writes opacity/transform directly onto these two elements
  // every frame; it never triggers a React re-render (Stage attaches them
  // once via attachGlow()). The wrapper that owns them (and the mask) never
  // animates.
  private glowCyanEl: HTMLElement | null = null;
  private glowGreenEl: HTMLElement | null = null;
  private glowFollower = 0;

  constructor(canvas: HTMLCanvasElement, config?: EngineConfig) {
    this.canvas = canvas;
    this.config = config ?? defaultEngineConfig();
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    setMarksContext(ctx);

    // Backing store starts at the logical 1440x900 size; Stage calls
    // resize() once it knows the actual displayed (contain-fit) size.
    canvas.width = W;
    canvas.height = H;

    const svgNS = "http://www.w3.org/2000/svg";
    const measureSvg = document.createElementNS(svgNS, "svg");
    measureSvg.setAttribute(
      "style",
      "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden",
    );
    this.measurePath = document.createElementNS(svgNS, "path");
    measureSvg.appendChild(this.measurePath);
    document.body.appendChild(measureSvg);

    this.frames = createFrames(this.measurePath);

    this.dotGridCanvas = document.createElement("canvas");
    this.dotGridCanvas.width = W;
    this.dotGridCanvas.height = H;
    const gctx = this.dotGridCanvas.getContext("2d")!;
    gctx.fillStyle = "rgba(212,212,216,0.5)";
    for (let x = 20; x < W; x += 28)
      for (let y = 20; y < H; y += 28) gctx.fillRect(x, y, 1.4, 1.4);

    this.mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.mql.addEventListener("change", this.onMqlChange);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.player.setPreset(this.activeSequence, performance.now());
  }

  onStatusChange(cb: (s: EngineStatus) => void) {
    this.onStatus = cb;
  }

  private activeRoleAndMarkId(): { role: Role; markId: string } {
    return this.config.voiceState === "riff-talking"
      ? { role: "riff", markId: this.config.riffMarkId }
      : { role: "human", markId: this.config.humanMarkId };
  }

  private emitStatus() {
    if (!this.onStatus) return;
    const { markId } = this.activeRoleAndMarkId();
    this.onStatus({
      voiceState: this.config.voiceState,
      jobState: this.config.jobState,
      markName: MARK_BY_ID[markId]?.name ?? "",
      originSide: this.config.originSide,
      realMic: this.config.realMicEnabled,
      reducedMotion: this.reducedMotionActive(),
      ambientGlowOn: this.config.ambientGlowOn,
      glowStrength: this.config.glowStrength,
      glowSize: this.config.glowSize,
      glowHeight: this.config.glowHeight,
      glowColorMix: this.config.glowColorMix,
      glowEdgeSoftness: this.config.glowEdgeSoftness,
      sequenceId: this.activeSequence.id,
      sequenceHotkey: this.activeSequence.hotkey,
      sequenceName: this.activeSequence.name,
      sequenceThesis: this.activeSequence.thesis,
      sequencePlaying: this.player.playing,
      sequenceProgress: this.player.progress(performance.now(), this.timeScale),
      slowMo: this.timeScale !== 1,
      effectiveColorMix: this.effectiveColorMix(),
    });
  }

  getOrigin() {
    return this.config.originSide === "center"
      ? { x: W / 2, y: H - 90 }
      : { x: W - 160, y: H - 90 };
  }

  reducedMotionActive(): boolean {
    return this.config.reducedMotion || this.mql.matches;
  }

  cindersEnabled(): boolean {
    return this.config.cindersOn && !this.reducedMotionActive();
  }

  // Reduced motion (toggle or OS) swaps the active preset's *motion*
  // settings for preset 10's (spec §5 precedence #3). Beats, glow levels,
  // and hueBias are untouched.
  private effectivePreset(): SequencePreset {
    const base = this.activeSequence;
    if (!this.reducedMotionActive()) return base;
    const rm = REDUCED_MOTION_PRESET;
    return {
      ...base,
      handoff: rm.handoff,
      anticipation: rm.anticipation,
      breathe: rm.breathe,
      stepFps: rm.stepFps,
      glow: { ...base.glow, follow: rm.glow.follow, swell: rm.glow.swell },
      job: rm.job,
      landing: rm.landing,
    };
  }

  private effectiveColorMix(): number {
    const preset = this.effectivePreset();
    return Math.max(
      0,
      Math.min(1, this.config.glowColorMix * (1 - preset.glow.hueBias)),
    );
  }

  // ---- Sequence picker ----
  selectSequence(idOrHotkey: string, t = performance.now()) {
    const next =
      SEQUENCE_BY_ID[idOrHotkey] ?? SEQUENCE_BY_HOTKEY[idOrHotkey] ?? null;
    if (!next || next.id === this.activeSequence.id) return;
    this.prevSequenceId = this.activeSequence.id;
    this.activeSequence = next;
    this.resetSequenceState();
    this.player.setPreset(next, t);
    this.emitStatus();
  }

  // `` ` `` — flip to the previously-selected preset (A/B).
  flipToPreviousSequence() {
    this.selectSequence(this.prevSequenceId);
  }

  playSequence() {
    this.player.play();
    this.emitStatus();
  }

  pauseSequence() {
    this.player.pause();
    this.emitStatus();
  }

  setSlowMotion(on: boolean) {
    this.timeScale = on ? 0.25 : 1;
    this.emitStatus();
  }

  getSlowMotion(): boolean {
    return this.timeScale !== 1;
  }

  // Full reset for a fresh preset run: job cleared, presences at 0, cinders
  // cleared (spec §5 "reset, play from 0").
  private resetSequenceState() {
    resetFrames(this.frames);
    this.cinders = [];
    this.dustPuffs = [];
    this.config.jobState = "none";
    this.config.voiceState = "idle";
    const t = performance.now();
    this.presence.human = 0;
    this.presence.riff = 0;
    this.presenceTween.human = { from: 0, to: 0, start: t, tween: ZERO_TWEEN };
    this.presenceTween.riff = { from: 0, to: 0, start: t, tween: ZERO_TWEEN };
    this.smearFramesLeft.human = 0;
    this.smearFramesLeft.riff = 0;
    this.onsetPulse = 0;
    this.riffOnsetPulse = 0;
    if (this.autoLandTimer) {
      clearTimeout(this.autoLandTimer);
      this.autoLandTimer = null;
    }
    if (this.backchannelTimer) {
      clearTimeout(this.backchannelTimer);
      this.backchannelTimer = null;
    }
  }

  // ---- SequenceHost surface (driven by SequencePlayer, no id branching) ----
  getVoiceState(): VoiceState {
    return this.config.voiceState;
  }

  isVoiceGap(): boolean {
    return (
      this.config.voiceState === "idle" || this.config.voiceState === "silence"
    );
  }

  triggerAnticipation(depth: number, ms: number) {
    this.anticipationStart = performance.now();
    this.anticipationMs = ms;
    this.anticipationDepth = depth;
  }

  // Riff "mm-hm": bumps Riff's presence briefly without taking the floor
  // from the human (research point 4) — voiceState is untouched.
  triggerBackchannel(presence: number, ms: number) {
    if (presence <= 0) return;
    const t = performance.now();
    const preset = this.effectivePreset();
    this.retargetPresence(
      "riff",
      Math.max(presence, this.presence.riff),
      { ms: 80, ease: preset.handoff.riffIn.ease },
      t,
    );
    if (this.backchannelTimer) clearTimeout(this.backchannelTimer);
    this.backchannelTimer = setTimeout(() => {
      this.backchannelTimer = null;
      const floor = this.silenceRiffFloor();
      this.retargetPresence(
        "riff",
        floor,
        preset.handoff.riffOut,
        performance.now(),
      );
    }, ms);
  }

  private silenceRiffFloor(): number {
    const state = this.config.voiceState;
    const preset = this.effectivePreset();
    if (state === "riff-talking") return 1;
    if (state === "silence" && preset.silenceHolder === "riff") return 0.25;
    return 0;
  }

  // ---- Voice channel ----
  setVoiceState(next: VoiceState) {
    if (!VOICE_STATES.includes(next)) return;
    if (this.config.voiceState === next) return;
    this.config.voiceState = next;
    if (next === "you-talking") this.nextSyntheticOnsetAt = 0;
    if (next === "riff-talking") this.nextRiffOnsetAt = 0;
    this.retargetPresenceForState(next);
    this.emitStatus();
  }

  private retargetPresence(
    role: Role,
    target: number,
    tween: Tween,
    t: number,
  ) {
    const cur = this.evalPresence(role, t);
    this.presenceTween[role] = { from: cur, to: target, start: t, tween };
  }

  private evalPresence(role: Role, t: number): number {
    const pt = this.presenceTween[role];
    const elapsed = t - pt.start;
    const frac = pt.tween.ms <= 0 ? 1 : elapsed / pt.tween.ms;
    const eased = evalEase(pt.tween.ease, frac);
    return pt.from + (pt.to - pt.from) * eased;
  }

  private retargetPresenceForState(next: VoiceState) {
    const t = performance.now();
    const preset = this.effectivePreset();
    let humanTarget = 0;
    let humanTween = preset.handoff.humanOut;
    let riffTarget = 0;
    let riffTween = preset.handoff.riffOut;
    const enteringRole: Role | null =
      next === "you-talking"
        ? "human"
        : next === "riff-talking"
          ? "riff"
          : null;
    if (next === "you-talking") {
      humanTarget = 1;
      humanTween = preset.handoff.humanIn;
    } else if (next === "riff-talking") {
      riffTarget = 1;
      riffTween = preset.handoff.riffIn;
    } else if (next === "silence") {
      if (preset.silenceHolder === "human") {
        humanTarget = 1;
        humanTween = preset.handoff.humanIn;
      }
      if (preset.silenceHolder === "riff") {
        riffTarget = 0.25;
        riffTween = preset.handoff.riffIn;
      }
    }
    this.retargetPresence("human", humanTarget, humanTween, t);
    this.retargetPresence("riff", riffTarget, riffTween, t);

    if (enteringRole) {
      if (preset.handoff.smearFrames > 0)
        this.smearFramesLeft[enteringRole] = preset.handoff.smearFrames;
      if (preset.handoff.entryPunch > 0) {
        if (enteringRole === "human")
          this.onsetPulse = Math.max(
            this.onsetPulse,
            preset.handoff.entryPunch,
          );
        else
          this.riffOnsetPulse = Math.max(
            this.riffOnsetPulse,
            preset.handoff.entryPunch,
          );
      }
    }
  }

  // ---- Job channel (independent of voice) ----
  setJobState(next: JobState) {
    if (this.autoLandTimer) {
      clearTimeout(this.autoLandTimer);
      this.autoLandTimer = null;
    }
    this.config.jobState = next;
    if (next === "sketching") {
      resetFrames(this.frames);
      this.cinders = [];
      this.dustPuffs = [];
      this.sketchStartTime = performance.now();
      if (this.cindersEnabled())
        spawnDustPuff(
          this.getOrigin(),
          this.config.cinderConfig,
          this.dustPuffs,
        );
      this.autoLandTimer = setTimeout(() => {
        if (this.config.jobState === "sketching") this.setJobState("landing");
      }, 14000);
    }
    if (next === "landing") this.beginLanding();
    if (next === "none") resetFrames(this.frames);
    this.emitStatus();
  }

  startSketch() {
    this.setJobState("sketching");
  }

  landNow() {
    this.setJobState("landing");
  }

  private beginLanding() {
    const preset = this.effectivePreset();
    if (!this.cindersEnabled()) {
      resetFrames(this.frames);
      this.cinders = [];
      return;
    }
    this.cinders = beginLandingImpl(
      this.frames,
      this.cinders,
      this.config.cinderConfig,
    );
    if (preset.landing.hitStopMs > 0)
      this.hitStopUntil = performance.now() + preset.landing.hitStopMs;
    if (preset.landing.riffNod) this.riffOnsetPulse = 1;
    if (preset.landing.tipBurst > 0) {
      const emitters = this.lastMarkContext?.mark.getTipEmitters
        ? this.lastMarkContext.mark.getTipEmitters(this.lastMarkContext.g)
        : [];
      spawnTipSparks(
        this.getOrigin(),
        emitters,
        preset.landing.tipBurst,
        this.dustPuffs,
      );
    }
  }

  // ---- Real mic ----
  async enableRealMic(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioCtx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      )();
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.micDataArray = new Uint8Array(this.analyser.frequencyBinCount);
      source.connect(this.analyser);
      this.config.realMicEnabled = true;
      this.emitStatus();
      return true;
    } catch (err) {
      console.warn(
        "Real mic unavailable, staying on synthetic signal:",
        (err as Error)?.message,
      );
      this.config.realMicEnabled = false;
      return false;
    }
  }

  disableRealMic() {
    this.config.realMicEnabled = false;
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.analyser = null;
    this.emitStatus();
  }

  private levelDataForState(t: number, s: VoiceState): Uint8Array {
    if (
      this.config.realMicEnabled &&
      this.analyser &&
      this.micDataArray &&
      (s === "you-talking" || s === "silence")
    ) {
      this.analyser.getByteFrequencyData(
        this.micDataArray as Uint8Array<ArrayBuffer>,
      );
      return this.micDataArray;
    }
    if (s === "dead-mic") return new Uint8Array(1024);
    if (s === "you-talking") return synthesizeLevelData(t);
    if (s === "riff-talking") return synthesizeLevelData(t * 0.8 + 4000);
    if (s === "silence") {
      const d = synthesizeLevelData(t);
      for (let i = 0; i < d.length; i++) d[i] = Math.min(d[i], 18);
      return d;
    }
    return new Uint8Array(1024);
  }

  private riffLevelData(t: number, active: boolean): Uint8Array {
    const d = synthesizeLevelData(t * 0.8 + 4000);
    if (!active) for (let i = 0; i < d.length; i++) d[i] = Math.min(d[i], 18);
    return d;
  }

  private maybeDetectOnset(t: number, avg: number) {
    if (this.config.voiceState !== "you-talking") return;
    let fired = false;
    if (this.config.realMicEnabled) {
      const delta = avg - this.prevUserAvg;
      if (delta > 0.1 && t - this.lastOnsetAt > 120) fired = true;
      this.prevUserAvg = avg;
    } else {
      if (this.nextSyntheticOnsetAt === 0) this.nextSyntheticOnsetAt = t + 200;
      if (t >= this.nextSyntheticOnsetAt) {
        fired = true;
        this.nextSyntheticOnsetAt = t + 460 + Math.random() * 380;
      }
    }
    if (fired) {
      this.lastOnsetAt = t;
      this.onsetPulse = 1;
      if (this.config.onsetRingsOn && this.rings.length < 8) {
        const o = this.getOrigin();
        this.rings.push({
          x: o.x,
          y: o.y,
          born: t,
          rot: Math.random() * Math.PI * 2,
        });
      }
    }
  }

  // Riff has no real-mic input, so its onset pulse is always the synthetic
  // schedule — the same shape as the human path's synthetic branch above.
  private maybeDetectRiffOnset(t: number) {
    if (this.config.voiceState !== "riff-talking") return;
    if (this.nextRiffOnsetAt === 0) this.nextRiffOnsetAt = t + 300;
    if (t >= this.nextRiffOnsetAt) {
      this.lastRiffOnsetAt = t;
      this.riffOnsetPulse = 1;
      this.nextRiffOnsetAt = t + 500 + Math.random() * 400;
    }
  }

  private drawOnsetRings(t: number, color: string) {
    this.rings = this.rings.filter((r) => t - r.born < 480);
    for (const r of this.rings) {
      const p = (t - r.born) / 480;
      const radius = 22 + p * 100;
      const alpha = 1 - p;
      const gapDeg = 26;
      const seedBase = hashSeed(`ring-${r.born}`);
      const arcPts2 = (a0: number, a1: number): [number, number][] => {
        const pts: [number, number][] = [];
        for (let i = 0; i <= 6; i++) {
          const a = a0 + (a1 - a0) * (i / 6);
          pts.push([r.x + Math.cos(a) * radius, r.y + Math.sin(a) * radius]);
        }
        return pts;
      };
      const arcs: [number, number][] = [
        [r.rot, r.rot + Math.PI - (gapDeg * Math.PI) / 180],
        [r.rot + Math.PI, r.rot + Math.PI * 2 - (gapDeg * Math.PI) / 180],
      ];
      for (const [a0, a1] of arcs)
        strokeChain(
          arcPts2(a0, a1),
          color,
          1.6,
          seedBase,
          Math.min(1, alpha * 1.1),
        );
    }
  }

  private updateMarkClock(t: number, dt: number, preset: SequencePreset) {
    if (t >= this.hitStopUntil) this.markClock += dt * this.timeScale;
    this.markT =
      preset.stepFps > 0
        ? Math.floor(this.markClock / (1000 / preset.stepFps)) *
          (1000 / preset.stepFps)
        : this.markClock;
  }

  private computeDiscSquash(t: number, preset: SequencePreset) {
    let depth = 0;
    if (this.anticipationMs > 0) {
      const elapsed = t - this.anticipationStart;
      const frac = elapsed / this.anticipationMs;
      if (frac >= 0 && frac <= 1)
        depth =
          this.anticipationDepth *
          (frac < 0.5 ? frac / 0.5 : 1 - (frac - 0.5) / 0.5);
    }
    let breathe = 0;
    if (
      preset.breathe.periodMs > 0 &&
      (this.config.voiceState === "idle" ||
        this.config.voiceState === "silence")
    ) {
      breathe =
        Math.sin((t / preset.breathe.periodMs) * Math.PI * 2) *
        preset.breathe.depth;
    }
    return {
      sx: 1 + depth * 0.25 - breathe * 0.5,
      sy: 1 - depth * 0.5 + breathe,
    };
  }

  private drawRole(
    role: Role,
    t: number,
    dt: number,
    activeRole: Role | null,
    preset: SequencePreset,
  ) {
    const presence = this.presence[role];
    if (presence <= 0.01) return;
    const o = this.getOrigin();
    const active = role === activeRole;
    const markId =
      role === "human" ? this.config.humanMarkId : this.config.riffMarkId;
    const color =
      role === "human" ? this.config.humanColor : this.config.riffColor;
    const mark = MARK_BY_ID[markId];
    let bands: number[];
    let level: number;
    let onsetPulse: number;
    if (role === "human") {
      const data = this.levelDataForState(
        t,
        active ? "you-talking" : "silence",
      );
      this.smoothedUser = computeBands(data, this.smoothedUser);
      bands = BAR_ORDER.map((i) => this.smoothedUser[i]);
      level = bands.reduce((a, b) => a + b, 0) / bands.length;
      if (active) this.maybeDetectOnset(t, level);
      onsetPulse = this.onsetPulse;
    } else {
      const data = this.riffLevelData(t, active);
      this.smoothedAgent = computeBands(data, this.smoothedAgent);
      bands = BAR_ORDER.map((i) => this.smoothedAgent[i]);
      level = bands.reduce((a, b) => a + b, 0) / bands.length;
      if (active) this.maybeDetectRiffOnset(t);
      onsetPulse = this.riffOnsetPulse;
    }
    const smear = this.smearFramesLeft[role] > 0 ? 1.6 : 1;
    const g: MarkDrawArgs = {
      o,
      t: this.markT,
      level,
      bands,
      onsetPulse,
      boilFrame: this.boilFrame,
      color,
      cfg:
        role === "human"
          ? this.config.markConfigsByRole.human[markId]
          : this.config.markConfigsByRole.riff[markId],
      mode: active ? "talking" : "silence",
      presence,
      smear,
    };
    setAlphaMul(preset.markPeak * presence);
    mark.draw(g);
    setAlphaMul(1);
    if (this.smearFramesLeft[role] > 0) this.smearFramesLeft[role]--;
    if (role === "human" && active && this.config.onsetRingsOn)
      this.drawOnsetRings(t, color);
    // Sketch-job cinders spawn off whichever mark is Burst (spec item 2):
    // prefer the active speaker so ray tips stay live during a handoff, but
    // fall back to a fading Burst so backchannel/underlay sparks keep going.
    if (mark.id === "burst" && (active || !this.lastMarkContext))
      this.lastMarkContext = { mark, g };
  }

  private drawVoiceLayer(t: number, dt: number, preset: SequencePreset) {
    const o = this.getOrigin();
    const state = this.config.voiceState;

    this.presence.human = this.evalPresence("human", t);
    this.presence.riff = this.evalPresence("riff", t);

    const squash = this.computeDiscSquash(t, preset);
    if (this.config.centerCircleOn) drawMicDisc(o, INK, squash.sx, squash.sy);

    if (this.markT - this.lastBoilAt > 400) {
      this.boilFrame = (this.boilFrame + 1) % 3;
      this.lastBoilAt = this.markT;
    }

    this.onsetPulse *= Math.pow(0.86, dt / 16.7);
    this.riffOnsetPulse *= Math.pow(0.86, dt / 16.7);

    this.lastMarkContext = null;
    const activeRole: Role | null =
      state === "you-talking"
        ? "human"
        : state === "riff-talking"
          ? "riff"
          : null;

    // Incoming role drawn on top: draw the outgoing (or non-active) role
    // first, active role last.
    const order: Role[] =
      activeRole === "riff" ? ["human", "riff"] : ["riff", "human"];
    for (const role of order) this.drawRole(role, t, dt, activeRole, preset);

    if (activeRole === null) {
      if (state === "dead-mic") drawFlatline(o, this.config.humanColor);
      else if (state === "idle" && this.presence.human < 0.02)
        drawIdleSquiggle(o, t, this.config.humanColor, 0);
    }
  }

  private drawBackground() {
    this.ctx.fillStyle = "#f4f4f5";
    this.ctx.fillRect(0, 0, W, H);
    this.ctx.drawImage(this.dotGridCanvas, 0, 0);
  }

  private jobDuckEnvelope(preset: SequencePreset): number {
    // Sidechain ducking: cinders yield visually while a voice role is
    // active (research point 9) — duck is a preset gate on top of Sean's own
    // cinder settings, never a suppression of voice.
    const active = this.presence.human > 0.3 || this.presence.riff > 0.3;
    return active ? 1 - preset.job.duck : 1;
  }

  private updateSketchSpawning(t: number, dt: number, preset: SequencePreset) {
    const elapsed = t - this.sketchStartTime;
    if (elapsed > 11000) return;
    if (this.cinders.length >= this.config.cinderConfig.cinderCap) return;
    if (preset.job.emit === "none") return;
    if (preset.job.emit === "gaps" && !this.isVoiceGap()) return;
    const duck = this.jobDuckEnvelope(preset);
    const rate = Math.max(0, 30 * (1 - elapsed / 11000)) * duck;
    this.spawnAccumulator += (rate * dt) / 1000;
    // Sparks off ray tips: if the active speaker mark exposes an emitter
    // (e.g. Burst), a fraction of spawns fly off its live tip points instead
    // of the disc origin. Falls back to the origin when there's no active
    // talking mark or it has no emitter.
    const emitters = this.lastMarkContext?.mark.getTipEmitters
      ? this.lastMarkContext.mark.getTipEmitters(this.lastMarkContext.g)
      : [];
    if (preset.job.emit === "onsets") {
      const punched = Math.max(this.onsetPulse, this.riffOnsetPulse) > 0.6;
      if (punched && emitters.length > 0) {
        const n = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          if (this.cinders.length >= this.config.cinderConfig.cinderCap) break;
          const emitter = emitters[Math.floor(Math.random() * emitters.length)];
          spawnCinder(this.getOrigin(), this.frames, t, this.cinders, emitter);
        }
      }
      return;
    }
    while (
      this.spawnAccumulator >= 1 &&
      this.cinders.length < this.config.cinderConfig.cinderCap
    ) {
      this.spawnAccumulator -= 1;
      const useTip =
        emitters.length > 0 &&
        Math.random() < this.config.cinderConfig.tipSparkRate;
      const emitter = useTip
        ? emitters[Math.floor(Math.random() * emitters.length)]
        : undefined;
      spawnCinder(this.getOrigin(), this.frames, t, this.cinders, emitter);
    }
  }

  // ---- Glow (spec §3.6) ----
  attachGlow(els: { cyan: HTMLElement; green: HTMLElement }) {
    this.glowCyanEl = els.cyan;
    this.glowGreenEl = els.green;
  }

  private updateGlow(
    t: number,
    dt: number,
    preset: SequencePreset,
    voiceLevel: number,
  ) {
    const target =
      preset.glow.level[this.config.voiceState] *
      (1 - preset.glow.follow + preset.glow.follow * voiceLevel);
    const tc =
      target > this.glowFollower
        ? preset.envelope.attackMs
        : preset.envelope.releaseMs;
    if (tc <= 0) this.glowFollower = target;
    else {
      const alpha = 1 - Math.exp(-dt / tc);
      this.glowFollower += (target - this.glowFollower) * alpha;
    }
    const ambient = this.config.ambientGlowOn ? 1 : 0;
    const reducedMul = this.reducedMotionActive() ? 0.4 : 1;
    const opacity =
      Math.max(0, Math.min(1.2, this.glowFollower)) * ambient * reducedMul;
    const scale = 1 + (preset.glow.swell - 1) * this.glowFollower;
    if (this.glowCyanEl) {
      this.glowCyanEl.style.opacity = String(opacity);
      this.glowCyanEl.style.transform = `scale(${scale})`;
    }
    if (this.glowGreenEl) {
      this.glowGreenEl.style.opacity = String(opacity);
      this.glowGreenEl.style.transform = `scale(${scale})`;
    }
  }

  private renderFrame(t: number) {
    const dt = Math.min(48, t - this.lastT);
    this.lastT = t;
    this.drawBackground();

    const preset = this.effectivePreset();
    this.updateMarkClock(t, dt, preset);
    this.player.tick(t, this.timeScale);

    // Job channel — cinders + landing frames render independent of voice.
    if (this.config.showFramesOn)
      drawFrames(
        this.ctx,
        this.frames,
        t,
        this.config.cinderConfig,
        preset.landing.inkStaggerMs,
        preset.landing.impact,
      );
    if (this.cindersEnabled()) {
      if (this.config.jobState === "sketching")
        this.updateSketchSpawning(t, dt, preset);
      for (const c of this.cinders)
        if (c.phase === "drift")
          updateCinderDrift(
            c,
            this.frames,
            t,
            dt,
            this.sketchStartTime,
            this.config.cinderConfig,
          );
      this.dustPuffs = this.dustPuffs.filter((d) => t - d.born < d.life);
      drawCinders(
        this.ctx,
        this.cinders,
        this.dustPuffs,
        this.getOrigin(),
        t,
        this.jobDuckEnvelope(preset),
      );
    }

    // Voice channel — always renders, regardless of job state.
    this.drawVoiceLayer(t, dt, preset);

    const voiceLevel =
      Math.max(this.presence.human, this.presence.riff) > 0.01
        ? Math.max(
            this.presence.human > 0.01 ? this.presence.human : 0,
            this.presence.riff > 0.01 ? this.presence.riff : 0,
          )
        : 0;
    this.updateGlow(t, dt, preset, voiceLevel);

    if (this.onStatus && this.player.playing) this.emitStatus();
  }

  scheduleLoop() {
    if (this.destroyed) return;
    this.emitStatus();
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.staticIntervalId) {
      clearInterval(this.staticIntervalId);
      this.staticIntervalId = null;
    }
    // Hidden tabs get one static frame and no rAF/interval loop, so a
    // backgrounded route doesn't keep animating or draining battery.
    if (document.hidden) {
      this.renderFrame(performance.now());
      return;
    }
    if (this.reducedMotionActive()) {
      this.staticIntervalId = setInterval(
        () => this.renderFrame(performance.now()),
        100,
      );
      this.renderFrame(performance.now());
    } else {
      this.lastT = performance.now();
      const loop = (t: number) => {
        this.renderFrame(t);
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }
  }

  setReducedMotion(on: boolean) {
    this.config.reducedMotion = on;
    this.scheduleLoop();
  }

  // The glow layer is a DOM element Stage draws outside the canvas, so both
  // of these need to reach it through status (like originSide/reducedMotion
  // above) rather than only living in config, which the canvas loop reads
  // directly.
  setAmbientGlow(on: boolean) {
    this.config.ambientGlowOn = on;
    this.emitStatus();
  }

  setGlowStrength(v: number) {
    this.config.glowStrength = v;
    this.emitStatus();
  }

  setGlowSize(v: number) {
    this.config.glowSize = v;
    this.emitStatus();
  }

  setGlowHeight(v: number) {
    this.config.glowHeight = v;
    this.emitStatus();
  }

  setGlowColorMix(v: number) {
    this.config.glowColorMix = v;
    this.emitStatus();
  }

  setGlowEdgeSoftness(v: number) {
    this.config.glowEdgeSoftness = v;
    this.emitStatus();
  }

  // Sizes the canvas backing store to the actual displayed (contain-fit)
  // CSS size × devicePixelRatio (capped at 2), so the stage stays crisp at
  // every window size instead of a fixed 1440x900 store stretched by CSS.
  // The engine's drawing coordinate space stays the logical 1440x900 — a
  // uniform transform maps it onto the resized backing store.
  resize(cssWidth: number, cssHeight: number) {
    if (this.destroyed || cssWidth <= 0 || cssHeight <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const backingWidth = Math.max(1, Math.round(cssWidth * dpr));
    const backingHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== backingWidth) this.canvas.width = backingWidth;
    if (this.canvas.height !== backingHeight)
      this.canvas.height = backingHeight;
    const scale = backingWidth / W;
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  destroy() {
    this.destroyed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.staticIntervalId) clearInterval(this.staticIntervalId);
    if (this.autoLandTimer) clearTimeout(this.autoLandTimer);
    if (this.backchannelTimer) clearTimeout(this.backchannelTimer);
    this.mql.removeEventListener("change", this.onMqlChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.disableRealMic();
  }
}

export { MARKS, MARK_BY_ID };
