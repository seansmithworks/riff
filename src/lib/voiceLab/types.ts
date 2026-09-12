// Framework-agnostic types for the voice-lab Canvas2D engine.

export type VoiceState =
  "idle" | "you-talking" | "riff-talking" | "silence" | "dead-mic";

export const VOICE_STATES: VoiceState[] = [
  "idle",
  "you-talking",
  "riff-talking",
  "silence",
  "dead-mic",
];

export const VOICE_STATE_LABELS: Record<VoiceState, string> = {
  idle: "Idle",
  "you-talking": "You talking",
  "riff-talking": "Riff talking",
  silence: "Silence",
  "dead-mic": "Dead mic",
};

// Independent job channel — a render/artifact generation is fire-and-forget
// in the real app, so it must never suppress the voice channel above.
export type JobState = "none" | "sketching" | "landing";

export type OriginSide = "center" | "right";

// The mark library is role-agnostic: either speaker can be assigned any
// mark, with its own color and its own tuner values for that mark.
export type Role = "human" | "riff";

export type MarkParam = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
};

export type TipEmitter = { x: number; y: number; angle: number };

export type MarkDrawArgs = {
  o: { x: number; y: number };
  t: number;
  level: number;
  bands: number[];
  onsetPulse: number;
  boilFrame: number;
  color: string;
  cfg: Record<string, number>;
  mode: "talking" | "silence";
  // 0-1 role presence (crossfade/handoff progress) — marks that care can
  // read it directly; most just get faded via marks.ts's alphaMul, which the
  // engine sets from presence × preset.markPeak before each draw call.
  presence?: number;
  // Motion-smear multiplier applied to reach/length during a handoff's
  // smearFrames window (1 = no smear, 1.6 = the spec's incoming reach ×1.6).
  smear?: number;
};

export type MarkDef = {
  id: string;
  num: number;
  name: string;
  params: MarkParam[];
  draw(g: MarkDrawArgs): void;
  // Optional emitter interface: exposes this frame's ray/line tip points in
  // world space so sketch-job cinders can spawn off them instead of the
  // disc origin. Only marks with distinct "tips" (e.g. Burst) implement it.
  getTipEmitters?(g: MarkDrawArgs): TipEmitter[];
};

export type CinderConfig = {
  cinderCap: number;
  windStrength: number;
  burstSize: number;
  landDurationMs: number;
  // Fraction (0-1) of sketch-job spawns that originate from the active
  // speaker mark's ray tips (when it exposes an emitter) instead of the
  // disc origin.
  tipSparkRate: number;
};

export type EngineConfig = {
  voiceState: VoiceState;
  jobState: JobState;
  originSide: OriginSide;
  centerCircleOn: boolean;
  onsetRingsOn: boolean;
  ambientGlowOn: boolean;
  // Ambient glow tuners — all consumed by Stage's single buildGlow() so the
  // gradients/mask never fork into a second copy.
  // Multiplies the glow's color alphas (not CSS opacity, which caps at 1
  // and can't brighten past it).
  glowStrength: number;
  // Scales both ellipse radii together.
  glowSize: number;
  // Vertical position of the gradient centers, % of card height.
  glowHeight: number;
  // Teal (cyan) vs. lime (green) balance, 0-1; weights the two gradients'
  // alphas against their shared total.
  glowColorMix: number;
  // Scales the mask's fade-band widths together; the mask always still
  // lands on an explicit 0%/100% transparent stop, so edges stay clear.
  glowEdgeSoftness: number;
  cindersOn: boolean;
  showFramesOn: boolean;
  // Speaker -> mark assignment. Each role picks any mark from the shared
  // library, with its own color and its own per-mark tuner values.
  humanMarkId: string;
  riffMarkId: string;
  humanColor: string;
  riffColor: string;
  markConfigsByRole: Record<Role, Record<string, Record<string, number>>>;
  cinderConfig: CinderConfig;
  reducedMotion: boolean;
  realMicEnabled: boolean;
};
