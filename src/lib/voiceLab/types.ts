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
export type ColorMode = "ink" | "green";

export type MarkParam = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
};

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
};

export type RiffConfig = {
  arcCount: number;
  baseRadius: number;
  radiusStep: number;
  amplitude: number;
  thickness: number;
};

export type CinderConfig = {
  cinderCap: number;
  windStrength: number;
  burstSize: number;
  landDurationMs: number;
};

export type EngineConfig = {
  voiceState: VoiceState;
  jobState: JobState;
  originSide: OriginSide;
  colorMode: ColorMode;
  centerCircleOn: boolean;
  onsetRingsOn: boolean;
  ambientGlowOn: boolean;
  cindersOn: boolean;
  showFramesOn: boolean;
  currentMarkId: string;
  markConfigs: Record<string, Record<string, number>>;
  riffConfig: RiffConfig;
  cinderConfig: CinderConfig;
  reducedMotion: boolean;
  realMicEnabled: boolean;
};
