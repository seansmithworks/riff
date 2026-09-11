// Framework-agnostic Canvas2D engine for the voice-lab route.
//
// Two independent channels, per Sean's correction: `voice` (idle /
// you-talking / riff-talking / silence / dead-mic) drives the human-voice
// marks and Riff's wavering-arc voice at all times. `job` (none / sketching
// / landing) drives the drifting cinders and frame-landing animation at all
// times. render_artifact is fire-and-forget in the real app, so a sketch job
// must never suppress or replace the voice layer — both channels draw in the
// same frame, independently.
import {
  W,
  H,
  INK,
  RIFF_GREEN,
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
  drawMicDisc,
  drawFlatline,
  drawIdleSquiggle,
  drawRiffMark,
  strokeChain,
} from "./marks";
import {
  createFrames,
  resetFrames,
  drawFrames,
  drawCinders,
  spawnDustPuff,
  spawnCinder,
  updateCinderDrift,
  beginLanding as beginLandingImpl,
  type Frame,
  type Cinder,
  type DustPuff,
} from "./frames";
import type { EngineConfig, VoiceState, JobState } from "./types";
import { VOICE_STATES } from "./types";

export function defaultEngineConfig(): EngineConfig {
  return {
    voiceState: "idle",
    jobState: "none",
    originSide: "center",
    colorMode: "ink",
    centerCircleOn: true,
    onsetRingsOn: true,
    ambientGlowOn: true,
    cindersOn: true,
    showFramesOn: true,
    currentMarkId: "burst",
    markConfigs: defaultMarkConfigs(),
    riffConfig: {
      arcCount: 3,
      baseRadius: 34,
      radiusStep: 20,
      amplitude: 5,
      thickness: 1.5,
    },
    cinderConfig: {
      cinderCap: 500,
      windStrength: 1.0,
      burstSize: 40,
      landDurationMs: 900,
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
};

export class VoiceLabEngine {
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
  private smoothedUser = [0.2, 0.2, 0.2, 0.2, 0.2];
  private smoothedAgent = [0.2, 0.2, 0.2, 0.2, 0.2];
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
  }

  onStatusChange(cb: (s: EngineStatus) => void) {
    this.onStatus = cb;
  }

  private emitStatus() {
    if (!this.onStatus) return;
    this.onStatus({
      voiceState: this.config.voiceState,
      jobState: this.config.jobState,
      markName: MARK_BY_ID[this.config.currentMarkId]?.name ?? "",
      originSide: this.config.originSide,
      realMic: this.config.realMicEnabled,
      reducedMotion: this.reducedMotionActive(),
    });
  }

  getOrigin() {
    return this.config.originSide === "center"
      ? { x: W / 2, y: H - 90 }
      : { x: W - 160, y: H - 90 };
  }

  currentColor() {
    return this.config.colorMode === "green" ? RIFF_GREEN : INK;
  }

  reducedMotionActive(): boolean {
    return this.config.reducedMotion || this.mql.matches;
  }

  cindersEnabled(): boolean {
    return this.config.cindersOn && !this.reducedMotionActive();
  }

  // ---- Voice channel ----
  setVoiceState(next: VoiceState) {
    if (!VOICE_STATES.includes(next)) return;
    this.config.voiceState = next;
    if (next === "you-talking") this.nextSyntheticOnsetAt = 0;
    this.emitStatus();
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
    this.cinders = this.cindersEnabled()
      ? beginLandingImpl(this.frames, this.cinders, this.config.cinderConfig)
      : (resetFrames(this.frames), (this.cinders = []), this.cinders);
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

  private drawOnsetRings(t: number) {
    this.rings = this.rings.filter((r) => t - r.born < 480);
    const color = this.currentColor();
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

  private drawVoiceLayer(t: number, dt: number) {
    const o = this.getOrigin();
    const color = this.currentColor();
    const state = this.config.voiceState;
    if (this.config.centerCircleOn) drawMicDisc(o, color);
    if (t - this.lastBoilAt > 400) {
      this.boilFrame = (this.boilFrame + 1) % 3;
      this.lastBoilAt = t;
    }

    if (state === "you-talking") {
      const data = this.levelDataForState(t, state);
      this.smoothedUser = computeBands(data, this.smoothedUser);
      const bands = BAR_ORDER.map((i) => this.smoothedUser[i]);
      const level = bands.reduce((a, b) => a + b, 0) / bands.length;
      this.maybeDetectOnset(t, level);
      this.onsetPulse *= Math.pow(0.86, dt / 16.7);
      const mark = MARK_BY_ID[this.config.currentMarkId];
      mark.draw({
        o,
        t,
        level,
        bands,
        onsetPulse: this.onsetPulse,
        boilFrame: this.boilFrame,
        color,
        cfg: this.config.markConfigs[this.config.currentMarkId],
        mode: "talking",
      });
      if (this.config.onsetRingsOn) this.drawOnsetRings(t);
    } else if (state === "riff-talking") {
      const data = synthesizeLevelData(t * 0.8 + 4000);
      this.smoothedAgent = computeBands(data, this.smoothedAgent);
      const level =
        this.smoothedAgent.reduce((a, b) => a + b, 0) /
        this.smoothedAgent.length;
      drawRiffMark(o, t, level, this.config.riffConfig, RIFF_GREEN);
    } else if (state === "silence") {
      const data = this.levelDataForState(t, state);
      this.smoothedUser = computeBands(data, this.smoothedUser);
      const bands = BAR_ORDER.map((i) => this.smoothedUser[i]);
      const level = bands.reduce((a, b) => a + b, 0) / bands.length;
      const mark = MARK_BY_ID[this.config.currentMarkId];
      mark.draw({
        o,
        t,
        level,
        bands,
        onsetPulse: 0,
        boilFrame: this.boilFrame,
        color,
        cfg: this.config.markConfigs[this.config.currentMarkId],
        mode: "silence",
      });
    } else if (state === "dead-mic") {
      drawFlatline(o, color);
    } else {
      drawIdleSquiggle(o, t, color, 0);
    }
  }

  private drawBackground() {
    this.ctx.fillStyle = "#f4f4f5";
    this.ctx.fillRect(0, 0, W, H);
    this.ctx.drawImage(this.dotGridCanvas, 0, 0);
  }

  private updateSketchSpawning(t: number, dt: number) {
    const elapsed = t - this.sketchStartTime;
    if (elapsed > 11000) return;
    if (this.cinders.length >= this.config.cinderConfig.cinderCap) return;
    const rate = Math.max(0, 30 * (1 - elapsed / 11000));
    this.spawnAccumulator += (rate * dt) / 1000;
    while (
      this.spawnAccumulator >= 1 &&
      this.cinders.length < this.config.cinderConfig.cinderCap
    ) {
      this.spawnAccumulator -= 1;
      spawnCinder(this.getOrigin(), this.frames, t, this.cinders);
    }
  }

  private renderFrame(t: number) {
    const dt = Math.min(48, t - this.lastT);
    this.lastT = t;
    this.drawBackground();

    // Job channel — cinders + landing frames render independent of voice.
    if (this.config.showFramesOn)
      drawFrames(this.ctx, this.frames, t, this.config.cinderConfig);
    if (this.cindersEnabled()) {
      if (this.config.jobState === "sketching")
        this.updateSketchSpawning(t, dt);
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
      drawCinders(this.ctx, this.cinders, this.dustPuffs, this.getOrigin(), t);
    }

    // Voice channel — always renders, regardless of job state.
    this.drawVoiceLayer(t, dt);
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
    this.mql.removeEventListener("change", this.onMqlChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.disableRealMic();
  }
}

export { MARKS, MARK_BY_ID };
