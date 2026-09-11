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
