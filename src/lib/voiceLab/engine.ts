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
  setLineMul,
  drawMicDisc,
  drawBead,
  drawFlatline,
  drawIdleSquiggle,
  drawShapeshiftBody,
  SHAPESHIFT_BODY_MARK,
  mixHexColor,
  strokeChain,
} from "./marks";
import {
  renderFluidGlow,
  sampleFluidPixelBilinear,
  sampleGrainAt,
} from "./fluidGlow";
import { DotGrid } from "./dotGrid";
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
import {
  planBuild,
  updateBuild,
  drawBuildParticles,
  type BuildPlan,
} from "./build";
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
import {
  MORPH_IDS,
  MORPH_LABELS,
  MORPH_STYLES,
  REDUCED_MOTION_PRESENCE,
  createMotionState,
  dialSpeed,
  easeInOutCubic,
  setMorphReducedMotion,
  shapeshiftSprout,
  smoothstep,
  type MorphId,
  type MotionState,
  type RolePose,
  type SpringSpec,
} from "./morph";

function hexToRgbTuple(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return [63, 63, 70];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

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
    // Speaker -> mark assignment: Riff = Burst (green), Human = Amoeba (ink).
    humanMarkId: "amoeba",
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
    glowStyle: "both",
    glowHumanColor: "#2F6FED",
    glowRiffColor: "#F5C518",
    glowMixSoftness: 0.4,
    glowFlowSpeed: 1,
    glowBlobScale: 1,
    glowBlobCount: 3,
    glowEdgeAmount: 0.35,
    glowGrainAmount: 0.4,
    glowLayers: 2,
    glowRoleColor: 0.8,
    glowBleedAmount: 0.5,
    paperOn: true,
    paperPitch: 16,
    paperDotSize: 0.9,
    paperBaseOpacity: 0.5,
    buildConfig: {
      flightSpeed: 1,
      arc: 0.18,
      densityFrame: 2.5,
      densityBlocks: 2.0,
      densityDetails: 1.2,
      tierGapMs: -100,
      speculativeFrame: "construction",
      guideDots: "dots",
      arrival: "dotsLead",
      snapToGrid: true,
      dotPop: 0.6,
      waitEmberRate: 12,
    },
    discStretchAmount: 0.35,
    discSquishBounce: 0.35,
    discWobble: 0.15,
    morph: {
      speed: 1,
      intensity: 1,
      breath: { scale: 0.88 },
      shapeshift: { sproutDelay: 0.15, backchannelSprout: 0.18 },
      relay: {
        gatherMs: 140,
        holdMs: 60,
        releasePunch: 0.6,
        landingBead: true,
      },
      inkwash: { stagger: 0.6, stain: 0.6, wetBloom: 0.15, nib: true },
      elastic: { squash: 0.18, wobble: 0.45 },
    },
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
  slowMo: boolean;
  // Effective colorMix (Sean's dial x preset hueBias) — Stage's buildGlow
  // needs this in its dep list so a preset switch retunes the glow shape.
  effectiveColorMix: number;
  // Morph lab (spec §5): current style, for the caption and MorphPanel sync.
  morphId: MorphId;
  morphLabel: string;
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
  private dotGrid: DotGrid;
  private lastPaperParams = { pitch: 16, dotSize: 0.9, baseOpacity: 0.5 };
  private buildPlan: BuildPlan | null = null;
  private mql: MediaQueryList;
  private statusListeners: Set<(s: EngineStatus) => void> = new Set();
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
  private glowFluidCanvas: HTMLCanvasElement | null = null;
  private glowFluidCtx: CanvasRenderingContext2D | null = null;
  private glowFollower = 0;
  private progressEl: HTMLElement | null = null;

  // Last computed voice level per role (drawRole), read by the fluid glow so
  // its flow/turbulence tracks loudness, not just presence.
  private lastLevel: Record<Role, number> = { human: 0, riff: 0 };

  // Disc squash & stretch spring state (ask 4) — target aspect comes from
  // role presence; this is the current/velocity pair the spring integrates
  // toward that target every frame, composed multiplicatively with the
  // existing anticipation/breathe squash in computeDiscSquash.
  private discSx = 1;
  private discSy = 1;
  private discVx = 0;
  private discVy = 0;

  // F0 one-frame clock: renderFrame stores the rAF-driven t here before
  // player.tick runs, so state-change handlers invoked mid-frame (retarget
  // presence, land, sketch-start) stamp themselves with the same instant the
  // frame is about to draw, instead of a later performance.now() that can
  // land after the draw's own clock read (the T7 landing flash's root cause).
  private frameT = 0;
  private now(): number {
    return this.frameT || performance.now();
  }

  // ---- Morph lab (docs/voice-lab-morph-spec.md) ----
  // Default on fresh install is Ink & Wash (spec §5) — persisted overrides
  // (DialKit's "voiceLab.morph" key) restore Sean's last pick, same pattern
  // as every other lab control.
  private morphId: MorphId = "inkwash";
  private motion: MotionState;
  private lastVoiceStateForMorph: VoiceState = "idle";
  // Last pose applied per role (a reference to morph.ts's per-role scratch
  // pose) — read by dev-session evidence evals only, never by UI.
  private lastPose: Record<Role, RolePose | null> = { human: null, riff: null };
  // Ink & Wash stain throttle (spec §4.4: bleed every 50ms per role).
  private lastStainAt: Record<Role, number> = { human: 0, riff: 0 };
  private clearSpec: SpringSpec = { response: 1, damping: 1 };
  // Whether Shapeshift's shared body drew last frame (dev evidence evals).
  private shapeshiftBodyActive = false;
  // Relay landing bead (spec §4.3): tip sparks wait for the bead to arrive.
  private pendingLandSparks = 0;

  constructor(canvas: HTMLCanvasElement, config?: EngineConfig) {
    this.canvas = canvas;
    this.config = config ?? defaultEngineConfig();
    // The motion layer reads dials straight off this config object every
    // frame (MorphPanel replaces config.morph on each drag), so they're live.
    this.motion = createMotionState(this.config);
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

    this.dotGrid = new DotGrid(
      W,
      H,
      this.config.paperPitch,
      this.config.paperDotSize,
      this.config.paperBaseOpacity,
    );
    this.lastPaperParams = {
      pitch: this.config.paperPitch,
      dotSize: this.config.paperDotSize,
      baseOpacity: this.config.paperBaseOpacity,
    };

    this.mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.mql.addEventListener("change", this.onMqlChange);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.player.setPreset(this.activeSequence, performance.now());
  }

  // Multiple listeners: Stage mirrors status for the caption/UI, Panels
  // mirrors it to sync DialKit controls with engine-driven changes (hotkeys,
  // `, Z). Returns an unsubscribe fn.
  onStatusChange(cb: (s: EngineStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  private activeRoleAndMarkId(): { role: Role; markId: string } {
    return this.config.voiceState === "riff-talking"
      ? { role: "riff", markId: this.config.riffMarkId }
      : { role: "human", markId: this.config.humanMarkId };
  }

  private emitStatus() {
    if (this.statusListeners.size === 0) return;
    const { markId } = this.activeRoleAndMarkId();
    const status: EngineStatus = {
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
      slowMo: this.timeScale !== 1,
      effectiveColorMix: this.effectiveColorMix(),
      morphId: this.morphId,
      morphLabel: MORPH_LABELS[this.morphId],
    };
    for (const cb of this.statusListeners) cb(status);
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

  // Fluid role-color dominance (voice-lab-dotgrid-addendum.md §3): the "Role
  // color" dial is the actual dominance value; a preset's own hueBias only
  // *scales* it, and only when that preset explicitly set one — BASE (most
  // presets) counts as "no opinion", not "always green", so preset 1/4's
  // default look reads role-distinct instead of collapsing to the shared
  // green wash.
  private roleColorDominance(): number {
    const preset = this.effectivePreset();
    const dial = Math.max(0, Math.min(1, this.config.glowRoleColor));
    const scale = preset.glow.hueBiasExplicit
      ? Math.max(0, Math.min(1, preset.glow.hueBias))
      : 1;
    return dial * scale;
  }

  private effectiveColorMix(): number {
    const preset = this.effectivePreset();
    return Math.max(
      0,
      Math.min(1, this.config.glowColorMix * (1 - preset.glow.hueBias)),
    );
  }

  // ---- Sequence picker ----
  getActiveSequenceId(): string {
    return this.activeSequence.id;
  }

  selectSequence(idOrHotkey: string, t = performance.now()) {
    const next =
      SEQUENCE_BY_ID[idOrHotkey] ?? SEQUENCE_BY_HOTKEY[idOrHotkey] ?? null;
    if (!next) return;
    // Re-pressing the active preset's hotkey must still reset + restart from
    // 0 (spec §5) — only skip touching prevSequenceId (the A/B flip target)
    // when it's a genuine no-op reselect.
    if (next.id !== this.activeSequence.id)
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
    // The player now drives job landing itself; a pending manual auto-land
    // timer (armed by a paused-player `S`) would otherwise race it.
    if (this.autoLandTimer) {
      clearTimeout(this.autoLandTimer);
      this.autoLandTimer = null;
    }
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

  // ---- Morph lab surface (spec §5) ----
  getMorph(): MorphId {
    return this.morphId;
  }

  // Switching style never restarts the loop (spec §5 "Live switching"), so
  // Sean can A/B mid-loop: presence springs seed from whatever the previous
  // path's current value was, velocity 0, rather than snapping to 0/1.
  setMorph(id: MorphId) {
    if (!MORPH_IDS.includes(id) || id === this.morphId) return;
    const wasOff = this.morphId === "off";
    this.morphId = id;
    if (id !== "off") {
      const t = this.now();
      const seedFrom = wasOff
        ? { human: this.presence.human, riff: this.presence.riff }
        : {
            human: this.motion.presence.human.value,
            riff: this.motion.presence.riff.value,
          };
      this.motion.presence.human.set(seedFrom.human);
      this.motion.presence.riff.set(seedFrom.riff);
      this.motion.talk.human.set(
        this.config.voiceState === "you-talking" ? 1 : 0,
      );
      this.motion.talk.riff.set(
        this.config.voiceState === "riff-talking" ? 1 : 0,
      );
      this.retargetMotionForState(this.config.voiceState, t);
      MORPH_STYLES[id].onEnter?.(this.motion, t);
    }
    this.pendingLandSparks = 0;
    this.emitStatus();
  }

  cycleMorph(dir: 1 | -1) {
    const idx = MORPH_IDS.indexOf(this.morphId);
    const next = MORPH_IDS[(idx + dir + MORPH_IDS.length) % MORPH_IDS.length];
    this.setMorph(next);
  }

  // Full reset for a fresh preset run: job cleared, presences at 0, cinders
  // cleared (spec §5 "reset, play from 0").
  private resetSequenceState() {
    resetFrames(this.frames);
    this.cinders = [];
    this.dustPuffs = [];
    this.config.jobState = "none";
    this.config.voiceState = "idle";
    const t = this.now();
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
    this.anticipationStart = this.now();
    this.anticipationMs = ms;
    this.anticipationDepth = depth;
  }

  // Riff "mm-hm": bumps Riff's presence briefly without taking the floor
  // from the human (research point 4) — voiceState is untouched.
  triggerBackchannel(presence: number, ms: number) {
    if (presence <= 0) return;
    const t = this.now();
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
      this.retargetPresence("riff", floor, preset.handoff.riffOut, this.now());
    }, ms);

    if (this.morphId !== "off") {
      const style = MORPH_STYLES[this.morphId as Exclude<MorphId, "off">];
      this.motion.presenceSpec.riff = style.riffIn;
      this.motion.presence.riff.target = Math.max(
        presence,
        this.motion.presence.riff.value,
      );
      style.onBackchannel?.(this.motion, presence, ms, t);
      setTimeout(() => {
        this.motion.presenceSpec.riff = style.riffOut;
        this.motion.presence.riff.target = this.silenceRiffFloor();
      }, ms);
    }
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
    if (this.morphId !== "off") this.retargetMotionForState(next, this.now());
    this.emitStatus();
  }

  // Morph-layer counterpart to retargetPresenceForState: same target rules
  // (who's entering, who holds the floor in silence), but retargets the
  // motion layer's springs — using the active style's own spring specs — and
  // fires the style's onHandoff hook exactly when the active role actually
  // changes (not on every beat, e.g. anticipation/backchannel beats never
  // land here).
  private retargetMotionForState(next: VoiceState, t: number) {
    const style = MORPH_STYLES[this.morphId as Exclude<MorphId, "off">];
    const preset = this.effectivePreset();
    const prevState = this.lastVoiceStateForMorph;
    this.lastVoiceStateForMorph = next;

    let humanTarget = 0;
    let riffTarget = 0;
    const enteringRole: Role | null =
      next === "you-talking"
        ? "human"
        : next === "riff-talking"
          ? "riff"
          : null;
    if (next === "you-talking") humanTarget = 1;
    else if (next === "riff-talking") riffTarget = 1;
    else if (next === "silence") {
      if (preset.silenceHolder === "human") humanTarget = 1;
      if (preset.silenceHolder === "riff") riffTarget = 0.25;
    }

    this.motion.presenceSpec.human =
      humanTarget > this.motion.presence.human.value
        ? style.humanIn
        : style.humanOut;
    this.motion.presenceSpec.riff =
      riffTarget > this.motion.presence.riff.value
        ? style.riffIn
        : style.riffOut;
    this.motion.presence.human.target = humanTarget;
    this.motion.presence.riff.target = riffTarget;
    this.motion.talk.human.target = next === "you-talking" ? 1 : 0;
    this.motion.talk.riff.target = next === "riff-talking" ? 1 : 0;

    const fromRole: Role | null =
      prevState === "you-talking"
        ? "human"
        : prevState === "riff-talking"
          ? "riff"
          : null;
    if (fromRole !== enteringRole) {
      this.motion.handoff = { from: fromRole, to: enteringRole, at: t };
      style.onHandoff?.(this.motion, fromRole, enteringRole, t);
    }
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
    const t = this.now();
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
      // F6 (morph spec §2): a Morph style fades old cinders out over
      // cinderDieMs instead of wiping the array in one frame.
      if (this.morphId !== "off") {
        const now = this.now();
        for (const c of this.cinders) if (!c.dieAt) c.dieAt = now;
        this.motion.jobOut.set(1);
      } else {
        this.cinders = [];
      }
      this.dustPuffs = [];
      this.buildPlan = null;
      this.sketchStartTime = this.now();
      if (this.cindersEnabled())
        spawnDustPuff(
          this.getOrigin(),
          this.config.cinderConfig,
          this.dustPuffs,
          this.sketchStartTime,
        );
      // Skip the wall-clock auto-land while the player drives (spec §3.1):
      // its own landing.policy (immediate/nextGap) decides when `ready`
      // lands, and under slow-mo this timer would force-land before that.
      // Manual `S` with the player paused still auto-lands as before.
      if (!this.player.playing) {
        this.autoLandTimer = setTimeout(() => {
          if (this.config.jobState === "sketching") this.setJobState("landing");
        }, 14000);
      }
    }
    if (next === "landing") this.beginLanding();
    if (next === "none") {
      // F6 clear: a Morph style keeps the plan alive and drives jobOut to 0
      // over clearMs instead of vanishing in one frame — stepMotion() runs
      // resetFrames/nulls the plan once the spring settles below 0.01. Old
      // cinders get the same dieAt treatment as job start, above.
      if (this.morphId !== "off") {
        const now = this.now();
        for (const c of this.cinders) if (!c.dieAt) c.dieAt = now;
        this.motion.jobOut.target = 0;
      } else {
        resetFrames(this.frames);
        this.buildPlan = null;
      }
    }
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
    const now = this.now();
    // The ink/crossfade build always runs on landing (build-plan.md §3's
    // reduced-motion tier crossfade included) — only particle scheduling
    // (drift-cinder recruitment, pooled sparks) depends on cinders being
    // enabled. Cinders off (or reduced motion, folded into cindersEnabled())
    // must not stall the frame on guide dots forever.
    const cindersOn = this.cindersEnabled();
    resetFrames(this.frames);
    // F0 landing-timestamp ownership: every frame gets landStartedAt here,
    // unconditionally, before the cindersOn branch below. Previously this
    // was only ever set inside beginLandingImpl's own resetFrames+stamp,
    // which only ran when cinders were on — so Cinders-off landings drew
    // cards at t=0 forever (landStartedAt stuck at 0), i.e. full alpha, no
    // fade.
    for (const f of this.frames) f.landStartedAt = now;
    if (this.morphId !== "off") {
      this.motion.jobOut.set(1);
      MORPH_STYLES[this.morphId as Exclude<MorphId, "off">].onLanding?.(
        this.motion,
        now,
      );
      // Relay landing bead: fly from the bead anchor to the nearest frame's
      // bottom-center.
      const land = this.motion.relay.land;
      if (this.morphId === "relay" && land.on) {
        const o = this.getOrigin();
        land.x0 = o.x;
        land.y0 = this.config.centerCircleOn ? o.y : o.y - 15;
        let best = Infinity;
        for (const f of this.frames) {
          const bx = f.x + f.w / 2;
          const by = f.y + f.h;
          const d2 = (bx - land.x0) ** 2 + (by - land.y0) ** 2;
          if (d2 < best) {
            best = d2;
            land.x1 = bx;
            land.y1 = by;
          }
        }
      }
    }
    // Recruit drift cinders (bearing-sorted from the origin) as the pooled
    // spark particles' launch points (build-plan.md §2/§3) — this happens
    // before ensuring the drift floor below so a fast landing (few cinders
    // yet) still gets *some* launch points rather than none.
    const origin = this.getOrigin();
    let launchPoints: { x: number; y: number }[] = [];
    if (cindersOn) {
      launchPoints = [...this.cinders]
        .filter((c) => c.phase === "drift")
        .sort(
          (a, b) =>
            Math.atan2(a.y - origin.y, a.x - origin.x) -
            Math.atan2(b.y - origin.y, b.x - origin.x),
        )
        .map((c) => ({ x: c.x, y: c.y }));
      this.cinders = beginLandingImpl(
        this.frames,
        this.cinders,
        this.config.cinderConfig,
        now,
      );
    } else {
      this.cinders = [];
    }
    if (preset.landing.hitStopMs > 0)
      this.hitStopUntil = now + preset.landing.hitStopMs;
    // Build clock starts after hit-stop (build-plan.md §2): hitStopUntil only
    // freezes the mark clock, so without this the build's own clock (t below)
    // would already be hitStopMs into tier 0's sweep when the freeze reads.
    const buildStartAt = now + preset.landing.hitStopMs;
    if (preset.landing.riffNod) this.riffOnsetPulse = 1;
    if (cindersOn && preset.landing.tipBurst > 0) {
      if (this.morphId === "relay" && this.motion.relay.land.on) {
        // Fired from the bead's arrival point in stepMotion.
        this.pendingLandSparks = preset.landing.tipBurst;
      } else {
        const emitters = this.lastMarkContext?.mark.getTipEmitters
          ? this.lastMarkContext.mark.getTipEmitters(this.lastMarkContext.g)
          : [];
        spawnTipSparks(
          this.getOrigin(),
          emitters,
          preset.landing.tipBurst,
          this.dustPuffs,
          now,
        );
      }
    }
    const clearAt = this.player.nextBeatAt(
      now,
      this.timeScale,
      (b) => b.kind === "job" && b.event === "clear",
    );
    this.buildPlan = planBuild(
      this.frames,
      buildStartAt,
      this.config.buildConfig,
      this.config.cinderConfig,
      preset.landing.inkStaggerMs,
      clearAt,
      { x: W / 2, y: H / 2 },
      launchPoints.length ? launchPoints : [origin],
      this.reducedMotionActive(),
      preset.job.emit === "none" || !cindersOn,
    );
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

  private computeDiscSquash(t: number, dt: number, preset: SequencePreset) {
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
    const anticipation = {
      sx: 1 + depth * 0.25 - breathe * 0.5,
      sy: 1 - depth * 0.5 + breathe,
    };

    // Ask 4: squash & stretch from role presence — human -> vertical oval
    // (sy>sx), riff -> horizontal (sx>sy) — reached via an overshooting
    // spring, volume-preserving (sx*sy ≈ 1), composed multiplicatively with
    // the anticipation/breathe squash above.
    const stretch = this.config.discStretchAmount;
    const bias = this.presence.human - this.presence.riff; // -1..1
    let targetSy = 1 + bias * stretch * 0.5;
    targetSy = Math.max(0.4, targetSy);
    let targetSx = 1 / targetSy; // exact volume preservation

    const reduced = this.reducedMotionActive();
    const zeta = reduced ? 1 : Math.max(0.05, 1 - this.config.discSquishBounce);
    const wn = (2 * Math.PI) / 260; // ~260ms nominal settle period, in ms^-1... see below
    const dtSec = Math.min(48, dt) / 1000;
    const wnRad = wn * 1000; // convert to rad/s
    const springStep = (
      cur: number,
      vel: number,
      target: number,
    ): [number, number] => {
      const accel = -wnRad * wnRad * (cur - target) - 2 * zeta * wnRad * vel;
      const nextVel = vel + accel * dtSec;
      const nextVal = cur + nextVel * dtSec;
      return [nextVal, nextVel];
    };
    [this.discSx, this.discVx] = springStep(this.discSx, this.discVx, targetSx);
    [this.discSy, this.discVy] = springStep(this.discSy, this.discVy, targetSy);

    // Small level-driven wobble while either role is talking, opposite-signed
    // between axes so it stays roughly volume-neutral. Dropped in reduced
    // motion (aspect change stays, wobble doesn't).
    let wobbleSx = 1;
    let wobbleSy = 1;
    if (!reduced) {
      const level = Math.max(
        this.presence.human * this.lastLevel.human,
        this.presence.riff * this.lastLevel.riff,
      );
      const wob = Math.sin(t / 90) * this.config.discWobble * level * 0.08;
      wobbleSx = 1 + wob;
      wobbleSy = 1 - wob;
    }

    return {
      sx: anticipation.sx * this.discSx * wobbleSx,
      sy: anticipation.sy * this.discSy * wobbleSy,
    };
  }

  private drawRole(
    role: Role,
    t: number,
    dt: number,
    activeRole: Role | null,
    preset: SequencePreset,
  ) {
    const morphOn = this.morphId !== "off";
    const style = morphOn
      ? MORPH_STYLES[this.morphId as Exclude<MorphId, "off">]
      : null;
    const presence = morphOn
      ? this.motion.presence[role].value
      : this.presence[role];
    if (morphOn) this.presence[role] = presence;
    // Shapeshift draws one shared body (spec §4.2) only for the Amoeba/Burst
    // pairing, and only when geometry may move: under reduced motion, or any
    // other pairing, both marks draw normally with Still Breath poses.
    const shapeshiftBody =
      style?.id === "shapeshift" &&
      this.config.humanMarkId === "amoeba" &&
      this.config.riffMarkId === "burst" &&
      !this.reducedMotionActive();
    this.shapeshiftBodyActive = shapeshiftBody;
    if (shapeshiftBody && role === "riff") return;
    const poseStyle =
      style?.id === "shapeshift" && !shapeshiftBody
        ? MORPH_STYLES.breath
        : style;

    const pose = poseStyle ? poseStyle.pose(role, this.motion, t) : null;
    this.lastPose[role] = pose;
    const cullAlpha = pose ? pose.alpha : presence;
    if (cullAlpha <= 0.01) return;

    const o = this.getOrigin();
    const active = role === activeRole;
    const markId =
      role === "human" ? this.config.humanMarkId : this.config.riffMarkId;
    const color =
      role === "human" ? this.config.humanColor : this.config.riffColor;
    const mark = MARK_BY_ID[markId];
    const talk = morphOn ? this.motion.talk[role].value : undefined;
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
      onsetPulse = morphOn ? this.motion.onset.human.value : this.onsetPulse;
    } else {
      const data = this.riffLevelData(t, active);
      this.smoothedAgent = computeBands(data, this.smoothedAgent);
      bands = BAR_ORDER.map((i) => this.smoothedAgent[i]);
      level = bands.reduce((a, b) => a + b, 0) / bands.length;
      if (active) this.maybeDetectRiffOnset(t);
      onsetPulse = morphOn ? this.motion.onset.riff.value : this.riffOnsetPulse;
    }
    this.lastLevel[role] = level;
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
      mode: (morphOn ? talk! >= 0.5 : active) ? "talking" : "silence",
      presence,
      smear,
      talk,
      reveal: pose?.reveal,
      radial: pose?.radial,
      stagger: morphOn ? this.config.morph.inkwash.stagger : undefined,
      nib: morphOn ? this.config.morph.inkwash.nib : undefined,
    };
    if (shapeshiftBody && role === "human") {
      // The shared body replaces both roles' ordinary mark.draw() calls —
      // built here so it has both roles' live band data in the same frame.
      const riffData = this.riffLevelData(t, activeRole === "riff");
      this.smoothedAgent = computeBands(riffData, this.smoothedAgent);
      const riffBands = BAR_ORDER.map((i) => this.smoothedAgent[i]);
      const riffLevel = riffBands.reduce((a, b) => a + b, 0) / riffBands.length;
      this.lastLevel.riff = riffLevel;
      if (activeRole === "riff") this.maybeDetectRiffOnset(t);
      const gRiff: MarkDrawArgs = {
        o,
        t: this.markT,
        level: riffLevel,
        bands: riffBands,
        onsetPulse: this.motion.onset.riff.value,
        boilFrame: this.boilFrame,
        color: this.config.riffColor,
        cfg: this.config.markConfigsByRole.riff[this.config.riffMarkId],
        mode: this.motion.talk.riff.value >= 0.5 ? "talking" : "silence",
        presence: this.motion.presence.riff.value,
        smear: this.smearFramesLeft.riff > 0 ? 1.6 : 1,
        talk: this.motion.talk.riff.value,
      };
      setAlphaMul(preset.markPeak * pose!.alpha);
      drawShapeshiftBody(
        g,
        gRiff,
        this.motion.morph.value,
        shapeshiftSprout(this.motion, t),
      );
    } else if (pose) {
      setAlphaMul(preset.markPeak * pose.alpha);
      setLineMul(pose.lineMul);
      const pivot = pose.pivot
        ? { x: o.x + pose.pivot.x, y: o.y + pose.pivot.y }
        : markId === "amoeba"
          ? { x: o.x, y: o.y - 30 }
          : o;
      this.ctx.save();
      this.ctx.translate(pivot.x, pivot.y);
      this.ctx.scale(pose.scale * pose.sx, pose.scale * pose.sy);
      this.ctx.translate(-pivot.x, -pivot.y);
      mark.draw(g);
      this.ctx.restore();
      setLineMul(1);
      if (style!.id === "inkwash")
        this.stainOutgoing(role, mark, g, pose.alpha, t);
    } else {
      setAlphaMul(preset.markPeak * presence);
      mark.draw(g);
    }
    setAlphaMul(1);
    if (this.smearFramesLeft[role] > 0) this.smearFramesLeft[role]--;
    if (role === "human" && active && this.config.onsetRingsOn)
      this.drawOnsetRings(t, color);
    // Sketch-job cinders spawn off whichever assigned mark exposes tip
    // emitters (Burst, Amoeba — spec item 2): prefer the active speaker so
    // ray/bulge tips stay live during a handoff, but fall back to a fading
    // one so backchannel/underlay sparks keep going.
    if (shapeshiftBody)
      this.lastMarkContext = { mark: SHAPESHIFT_BODY_MARK, g };
    else if (mark.getTipEmitters && (active || !this.lastMarkContext))
      this.lastMarkContext = { mark, g };
  }

  private drawRelayBeads(o: { x: number; y: number }, t: number) {
    const m = this.motion;
    const r = m.relay;
    const intensity = Math.max(0, this.config.morph.intensity);
    const human = this.config.humanColor;
    const riff = this.config.riffColor;
    // Bead anchor = the pose pivot: (o.x, o.y − 15), or o when the disc is on.
    const px = o.x;
    const py = this.config.centerCircleOn ? o.y : o.y - 15;
    setAlphaMul(1);
    if (m.bead.value > 0.02) {
      const a = r.from ?? r.to;
      const b = r.to ?? r.from;
      drawBead(
        px,
        py,
        mixHexColor(
          a === "riff" ? riff : human,
          b === "riff" ? riff : human,
          r.beadMix,
        ),
        9 * m.bead.value * intensity,
        Math.min(0.9, m.bead.value),
      );
    }
    // Backchannel: a green bead springs 10px out of Amoeba's top and back.
    if (Math.abs(r.bc.value) > 0.01) {
      const cfg = this.config.markConfigsByRole.human[this.config.humanMarkId];
      const s = this.lastPose.human ? this.lastPose.human.scale : 1;
      const topY = py + (o.y - 30 - (cfg?.baseRadius ?? 37) - py) * s;
      drawBead(
        px,
        topY - 10 * r.bc.value * intensity,
        riff,
        5,
        Math.min(0.85, m.backchannel.amount * 2.4) *
          smoothstep(0, 0.25, Math.abs(r.bc.value)),
      );
    }
    // Landing: the coiled bead travels to the nearest frame over 260ms.
    if (r.land.on) {
      const p = Math.min(1, ((t - r.land.at) * dialSpeed(m)) / 260);
      const k = easeInOutCubic(p);
      drawBead(
        r.land.x0 + (r.land.x1 - r.land.x0) * k,
        r.land.y0 + (r.land.y1 - r.land.y0) * k,
        riff,
        9 * intensity * smoothstep(0, 0.15, p) * (1 - smoothstep(0.85, 1, p)),
        0.9,
      );
    }
  }

  // Ink & Wash stain (spec §4.4 "Bleed while fading"): while an outgoing
  // role's alpha sits between 0.05 and 0.9, every 50ms per role, bleed ≤6 of
  // its outline/tip points into the paper at glowBleedAmount × Stain ×
  // alpha. A silence hold stains at 0.3×; reduced motion keeps half (color,
  // not motion).
  private stainOutgoing(
    role: Role,
    mark: MarkDef,
    g: MarkDrawArgs,
    alpha: number,
    t: number,
  ) {
    if (!this.config.paperOn || !mark.getTipEmitters) return;
    if (alpha <= 0.05 || alpha >= 0.9) return;
    const p = this.motion.presence[role];
    if (p.value - p.target <= 0.01) return; // only the outgoing role stains
    if (t - this.lastStainAt[role] < 50 / dialSpeed(this.motion)) return;
    const d = this.config.morph;
    const amount =
      this.config.glowBleedAmount *
      d.inkwash.stain *
      Math.max(0, d.intensity) *
      alpha *
      (p.target > 0 ? 0.3 : 1) *
      (this.reducedMotionActive() ? 0.5 : 1);
    if (amount <= 0) return;
    this.lastStainAt[role] = t;
    const tips = mark.getTipEmitters(g);
    if (!tips.length) return;
    const stride = Math.ceil(tips.length / 6);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < tips.length; i += stride) pts.push(tips[i]);
    this.dotGrid.bleedAlongPath(pts, hexToRgbTuple(g.color), amount);
  }

  private drawVoiceLayer(t: number, dt: number, preset: SequencePreset) {
    const o = this.getOrigin();
    const state = this.config.voiceState;
    const morphOn = this.morphId !== "off";

    // Off keeps the original tween-eval path; drawRole assigns
    // this.presence[role] from the motion springs directly when Morph is on
    // (F1 "Off: the motion layer is not consulted").
    if (!morphOn) {
      this.presence.human = this.evalPresence("human", t);
      this.presence.riff = this.evalPresence("riff", t);
    }

    const squash = this.computeDiscSquash(t, dt, preset);
    if (this.config.centerCircleOn) drawMicDisc(o, INK, squash.sx, squash.sy);

    if (this.markT - this.lastBoilAt > 400) {
      this.boilFrame = (this.boilFrame + 1) % 3;
      this.lastBoilAt = this.markT;
    }

    if (!morphOn) {
      this.onsetPulse *= Math.pow(0.86, dt / 16.7);
      this.riffOnsetPulse *= Math.pow(0.86, dt / 16.7);
    }

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

    // Relay's beads (spec §4.3) draw after both roles so they read on top of
    // whichever mark is mid-gather. Reduced motion draws none.
    if (morphOn && this.morphId === "relay" && !this.reducedMotionActive())
      this.drawRelayBeads(o, t);

    if (activeRole === null) {
      if (state === "dead-mic") drawFlatline(o, this.config.humanColor);
      else if (state === "idle") {
        if (morphOn) {
          // F7: the squiggle fades with presence instead of cutting at a
          // hard 0.02 threshold.
          const alpha = Math.max(0, 1 - this.presence.human * 3.3);
          if (alpha > 0.01) {
            setAlphaMul(alpha);
            drawIdleSquiggle(o, t, this.config.humanColor, 0);
            setAlphaMul(1);
          }
        } else if (this.presence.human < 0.02) {
          drawIdleSquiggle(o, t, this.config.humanColor, 0);
        }
      }
    }
  }

  // Steps every spring/envelope/pulse on the motion layer once per frame
  // (spec §2 F1 "Integration") — only when a Morph style is active; Off
  // never touches `this.motion` at all.
  private stepMotion(t: number, dt: number) {
    const style = MORPH_STYLES[this.morphId as Exclude<MorphId, "off">];
    const reduced = this.reducedMotionActive();
    setMorphReducedMotion(reduced);
    // Speed dial (spec §4): stepping every style spring/envelope on dt×speed
    // is exactly "divide every r and ms by Speed".
    const speed = dialSpeed(this.motion);
    const sdt = dt * speed;
    const presenceSpec = reduced ? REDUCED_MOTION_PRESENCE : undefined;
    this.motion.presence.human.step(
      sdt,
      presenceSpec ?? this.motion.presenceSpec.human,
    );
    this.motion.presence.riff.step(
      sdt,
      presenceSpec ?? this.motion.presenceSpec.riff,
    );
    this.motion.talk.human.step(sdt, style.talk);
    this.motion.talk.riff.step(sdt, style.talk);
    this.clearSpec.response =
      (reduced ? 400 : Math.max(60, style.clearMs)) / 0.755;
    this.motion.jobOut.step(sdt, this.clearSpec);
    this.motion.onset.human.step(dt, style.onsetAttackMs / speed);
    this.motion.onset.riff.step(dt, style.onsetAttackMs / speed);
    // F5: wash activity targets the presence spring's *target* (not its
    // current value), so a retarget mid-tween doesn't also snap the wash —
    // the wash's own attack/release is what makes it lag/lead presence.
    // Style-owned springs/timelines first, so a Relay hold can steer this
    // frame's wash targets.
    this.motion.washHold = -1;
    style.step?.(this.motion, t, sdt);
    const washHold = this.motion.washHold;
    this.motion.wash.human.step(
      sdt,
      washHold >= 0 ? washHold : this.motion.presence.human.target,
      style.wash.attackMs,
      style.wash.releaseMs,
    );
    this.motion.wash.riff.step(
      sdt,
      washHold >= 0 ? washHold : this.motion.presence.riff.target,
      style.wash.attackMs,
      style.wash.releaseMs,
    );
    this.motion.energy.human.step(dt, this.lastLevel.human, 80, 200);
    this.motion.energy.riff.step(dt, this.lastLevel.riff, 80, 200);
    // Relay landing bead arrival → the deferred tip-spark burst.
    const land = this.motion.relay.land;
    if (
      this.pendingLandSparks > 0 &&
      (!land.on || (t - land.at) * speed >= 260)
    ) {
      spawnTipSparks(
        this.getOrigin(),
        [{ x: land.x1, y: land.y1, angle: -Math.PI / 2 }],
        this.pendingLandSparks,
        this.dustPuffs,
        t,
      );
      this.pendingLandSparks = 0;
      land.on = false;
    }
    // F6: finish the deferred clear teardown once the fade has settled.
    if (
      this.config.jobState === "none" &&
      this.motion.jobOut.value < 0.01 &&
      this.buildPlan
    ) {
      resetFrames(this.frames);
      this.buildPlan = null;
    }
    // Prune cinders whose dieAt fade (F6) has fully finished.
    if (this.cinders.some((c) => c.dieAt)) {
      this.cinders = this.cinders.filter(
        (c) => !(c.dieAt && t - c.dieAt > style.cinderDieMs / speed),
      );
    }
  }

  private drawBackground(dt: number) {
    this.ctx.fillStyle = "#f4f4f5";
    this.ctx.fillRect(0, 0, W, H);
    if (this.config.paperOn) {
      this.dotGrid.decay(dt);
      this.dotGrid.draw(this.ctx);
    }
  }

  // Rebuilds the dot grid when Pitch changes (count changes, so the typed
  // arrays must be reallocated); Dot size/Base opacity are cheap in-place
  // updates on the existing grid (DotGrid#setDotSize/#setBaseOpacity).
  setPaperParams(pitch: number, dotSize: number, baseOpacity: number) {
    this.config.paperPitch = pitch;
    this.config.paperDotSize = dotSize;
    this.config.paperBaseOpacity = baseOpacity;
    if (pitch !== this.lastPaperParams.pitch) {
      // Reallocating discards live ink/tint state (Phase A reviewer
      // should-fix) — resample each new dot from its nearest dot on the old
      // grid so an in-flight build or wash survives a mid-frame Pitch change
      // instead of visibly resetting.
      const old = this.dotGrid;
      const next = new DotGrid(W, H, pitch, dotSize, baseOpacity);
      for (let i = 0; i < next.count; i++) {
        const oldIdx = old.nearestDot(next.x(i), next.y(i));
        if (oldIdx < 0) continue;
        if (old.ink[oldIdx] > 0.004) next.lightDot(i, old.ink[oldIdx]);
        if (old.tintAmount[oldIdx] > 0.004)
          next.setTint(
            i,
            [old.tintR[oldIdx], old.tintG[oldIdx], old.tintB[oldIdx]],
            old.tintAmount[oldIdx],
          );
        if (old.fieldTintAmount[oldIdx] > 0.004)
          next.setFieldTint(
            i,
            [
              old.fieldTintR[oldIdx],
              old.fieldTintG[oldIdx],
              old.fieldTintB[oldIdx],
            ],
            old.fieldTintAmount[oldIdx],
          );
      }
      this.dotGrid = next;
    } else {
      this.dotGrid.setDotSize(dotSize);
      this.dotGrid.setBaseOpacity(baseOpacity);
    }
    this.lastPaperParams = { pitch, dotSize, baseOpacity };
  }

  // Stroke-bleed hook (voice-lab-dotgrid-addendum.md §4) — bound once so
  // frames.ts's drawInkingReveal can call it without knowing about the dot
  // grid or role colors; picks whichever role is presently active (or falls
  // back to the human color, e.g. during a silence hold).
  private onInkAdvance = (x: number, y: number) => {
    const amount = this.config.glowBleedAmount;
    if (amount <= 0) return;
    const { role } = this.activeRoleAndMarkId();
    const color =
      role === "riff" ? this.config.riffColor : this.config.humanColor;
    this.dotGrid.bleedAlongPath([{ x, y }], hexToRgbTuple(color), amount);
  };

  private jobDuckEnvelope(preset: SequencePreset): number {
    // Sidechain ducking: cinders yield visually while a voice role is
    // active (research point 9) — duck is a preset gate on top of Sean's own
    // cinder settings, never a suppression of voice.
    const active = this.presence.human > 0.3 || this.presence.riff > 0.3;
    return active ? Math.max(0.4, 1 - preset.job.duck) : 1;
  }

  private updateSketchSpawning(t: number, dt: number, preset: SequencePreset) {
    const elapsed = t - this.sketchStartTime;
    if (this.cinders.length >= this.config.cinderConfig.cinderCap) return;
    if (preset.job.emit === "none") return;
    if (preset.job.emit === "gaps" && !this.isVoiceGap()) return;
    const duck = this.jobDuckEnvelope(preset);
    // Ember floor (build-plan.md §2): the wait can run 11-19s real, so
    // instead of emission dying at 11s and leaving the canvas dead for the
    // rest of the hold, it decays to a steady floor (Sean's "Wait embers"
    // dial in the Build panel — default raised from 4/s so a 744×465 canvas
    // still visibly reads as alive during a long hold).
    const emberFloor = this.config.buildConfig.waitEmberRate;
    const rate =
      elapsed > 11000
        ? emberFloor * duck
        : Math.max(emberFloor, 30 * (1 - elapsed / 11000)) * duck;
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

  // Fluid "shader" glow canvas (ask 1) — lives inside the same never-
  // animating mask wrapper as the two classic gradient divs; the engine
  // writes pixels + opacity/transform onto it directly, same imperative
  // pattern as attachGlow above.
  attachGlowFluid(canvas: HTMLCanvasElement) {
    this.glowFluidCanvas = canvas;
    this.glowFluidCtx = canvas.getContext("2d");
  }

  // Loop progress bar, driven the same way as glow: written directly onto a
  // DOM element every frame, never through setState (spec item 2).
  attachProgress(el: HTMLElement) {
    this.progressEl = el;
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

    if (this.config.glowStyle === "classic") {
      if (this.glowCyanEl) {
        this.glowCyanEl.style.opacity = String(opacity);
        this.glowCyanEl.style.transform = `scale(${scale})`;
      }
      if (this.glowGreenEl) {
        this.glowGreenEl.style.opacity = String(opacity);
        this.glowGreenEl.style.transform = `scale(${scale})`;
      }
      if (this.glowFluidCanvas) this.glowFluidCanvas.style.opacity = "0";
      return;
    }

    // Wash / Dots / Both: hide the classic gradients. The density field
    // always renders (cheap, FLUID_W×FLUID_H) so "dots" can sample it even
    // when the wash canvas itself stays hidden; "wash"/"both" show it too.
    if (this.glowCyanEl) this.glowCyanEl.style.opacity = "0";
    if (this.glowGreenEl) this.glowGreenEl.style.opacity = "0";
    const showWash =
      this.config.glowStyle === "fluid" || this.config.glowStyle === "both";
    const showDots =
      this.config.glowStyle === "dots" || this.config.glowStyle === "both";
    if (this.glowFluidCanvas) {
      this.glowFluidCanvas.style.opacity = ambient && showWash ? "1" : "0";
      this.glowFluidCanvas.style.transform = `scale(${scale})`;
    }
    const fctx = this.glowFluidCtx;
    if (fctx && ambient) {
      // Same anchor the classic glow used: origin.x for left/right, and
      // glowHeight (% of card height, matching buildGlow's "at X% height%")
      // for vertical placement — so Fluid occupies the classic glow's
      // footprint instead of roaming the whole card.
      const o = this.getOrigin();
      const t0 = performance.now();
      // F5 (morph spec §2): wash activity decoupled from the fast presence
      // spring when a Morph style is active — it follows the style's own
      // wash envelope (attack/release) instead, so the cloud retints on the
      // handoff's own cadence instead of snapping with presence.
      const morphOn = this.morphId !== "off";
      const humanActivity = morphOn
        ? this.motion.wash.human.value *
          (0.4 + 0.6 * this.motion.energy.human.value)
        : this.presence.human * (0.4 + 0.6 * this.lastLevel.human);
      const riffActivity = morphOn
        ? this.motion.wash.riff.value *
          (0.4 + 0.6 * this.motion.energy.riff.value)
        : this.presence.riff * (0.4 + 0.6 * this.lastLevel.riff);
      renderFluidGlow(fctx, t, humanActivity, riffActivity, {
        humanColor: this.config.glowHumanColor,
        riffColor: this.config.glowRiffColor,
        mixSoftness: this.config.glowMixSoftness,
        flowSpeed: this.config.glowFlowSpeed,
        blobScale: this.config.glowBlobScale,
        blobCount: this.config.glowBlobCount,
        hueBias: this.roleColorDominance(),
        opacity,
        originX: o.x / W,
        originY: this.config.glowHeight / 100,
        glowSize: this.config.glowSize,
        // Ink & Wash wet bloom (spec §4.4) swells the wash edge on handoff.
        edgeAmount:
          this.config.glowEdgeAmount +
          (morphOn && this.morphId === "inkwash" ? this.motion.bloom.value : 0),
        grainAmount: this.config.glowGrainAmount,
        layers: this.config.glowLayers,
      });
      if (this.fieldMsLog) this.fieldMsLog(performance.now() - t0);
      if (showDots && this.config.paperOn) this.tintDotsFromField(opacity);
    }
  }

  // Dev-only perf hook (spec acceptance §6/§2 "report ms/frame") — set from
  // the browser console during evidence capture; no-op otherwise, never
  // committed as a UI control.
  fieldMsLog: ((ms: number) => void) | null = null;

  // Style: Dots / Both (addendum §2) — the density field also tints and
  // brightens dot-grid paper within its footprint, using the same finished
  // pixels the wash canvas would show (sampleFluidPixelBilinear), so "the
  // shader shows through the paper" whether or not the wash itself is drawn.
  //
  // Walks every dot rather than a footprint box: a box's own edge was the
  // bug (see docs/evidence/paper) — every dot inside it got a tint amount
  // every frame regardless of how faint the field was there, and setTint's
  // additive model (built for bleedAlongPath's occasional impulses) then
  // saturated it to solid color within a couple of frames, while dots just
  // outside the box were never touched at all. That reads as a flat-filled
  // rectangle, not pigment. tint amount is now the field's own bilinear
  // alpha at that dot (0 with no clamping past the field's edge), assigned
  // fresh each frame (setFieldTint), so it can only ever be as strong, and
  // fall off exactly as softly, as the wash itself. Grid walk is a few
  // thousand cheap dots at typical pitch — bounded regardless of card size.
  private tintDotsFromField(opacity: number) {
    if (opacity <= 0.01) return;
    const dg = this.dotGrid;
    for (let i = 0; i < dg.count; i++) {
      const nx = dg.x(i) / W;
      const ny = dg.y(i) / H;
      const [r, g, b, a] = sampleFluidPixelBilinear(nx, ny);
      if (a < 0.003) {
        if (dg.fieldTintAmount[i] > 0.003) dg.setFieldTint(i, [0, 0, 0], 0);
        continue;
      }
      // Granulated pigment, not a flat fill: modulate by the same paper
      // grain the wash multiplies against, biased so valleys (low grain
      // value) take more pigment than peaks — and cap well short of a flat
      // fill (~70% toward the role color) regardless of field strength.
      const grain = sampleGrainAt(nx, ny);
      const valley = 1 - Math.max(0, Math.min(1, (grain - 0.55) / 0.45));
      const grainMod = 0.7 + 0.6 * valley;
      const amount = Math.min(0.7, a * 0.6 * grainMod);
      dg.setFieldTint(i, [Math.round(r), Math.round(g), Math.round(b)], amount);
    }
  }

  private renderFrame(t: number) {
    const dt = Math.min(48, t - this.lastT);
    this.lastT = t;
    // F0 one-frame clock: stamp before player.tick / any state-change side
    // effect runs this frame, so this.now() below reads the same instant
    // this frame is drawing at, not a later performance.now().
    this.frameT = t;
    this.drawBackground(dt);

    const preset = this.effectivePreset();
    this.updateMarkClock(t, dt, preset);
    this.player.tick(t, this.timeScale);
    if (this.morphId !== "off") this.stepMotion(t, dt);

    // Job channel — cinders + landing frames render independent of voice.
    if (this.buildPlan) {
      updateBuild(
        this.buildPlan,
        t,
        this.config.paperOn ? this.dotGrid : null,
        this.config.buildConfig.snapToGrid,
        this.config.buildConfig.dotPop,
      );
    }
    if (this.config.showFramesOn)
      drawFrames(
        this.ctx,
        this.frames,
        t,
        this.config.cinderConfig,
        preset.landing.impact,
        this.config.paperOn ? this.onInkAdvance : undefined,
        this.buildPlan,
        {
          // F0: construction dots only draw while a job is actually
          // sketching — otherwise the speculative layer (which draws
          // whenever no plan exists, regardless of job state) re-lights
          // within a few frames of clear.
          speculativeFrame:
            this.config.jobState === "sketching"
              ? this.config.buildConfig.speculativeFrame
              : "off",
          guideDots: this.config.buildConfig.guideDots,
          dotGrid: this.config.paperOn ? this.dotGrid : null,
          reducedMotion: this.reducedMotionActive(),
        },
        {
          dotGrid: this.config.paperOn ? this.dotGrid : null,
          snapToGrid: this.config.buildConfig.snapToGrid,
          dotPop: this.config.buildConfig.dotPop,
        },
        this.morphId !== "off" ? this.motion.jobOut.value : 1,
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
        this.morphId !== "off"
          ? MORPH_STYLES[this.morphId as Exclude<MorphId, "off">].cinderDieMs /
              dialSpeed(this.motion)
          : 0,
      );
      // Frames → drift cinders → build particles → voice (build-plan.md §3
      // draw-order note), so the sparks read on top of the ambient drift.
      if (this.buildPlan) {
        const role = this.activeRoleAndMarkId().role;
        const color =
          role === "riff" ? this.config.riffColor : this.config.humanColor;
        drawBuildParticles(
          this.ctx,
          this.buildPlan,
          t,
          color,
          this.config.buildConfig.arrival,
          this.jobDuckEnvelope(preset),
        );
      }
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

    // Progress bar: written directly, every frame, never through setState.
    // Everything else in EngineStatus only changes on real beats/state
    // transitions, each of which already calls emitStatus() itself (voice
    // and job state, preset select, play/pause, slow-mo) — no blanket
    // per-frame emit needed.
    if (this.progressEl) {
      const progress = this.player.progress(t, this.timeScale);
      this.progressEl.style.transform = `scaleX(${progress})`;
    }
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
