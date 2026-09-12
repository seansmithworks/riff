// The 10 choreography presets (spec §4), each built from BASE as pure data.
// No engine or player code ever branches on `id`/`hotkey` — every difference
// between presets lives here as numbers.
import type { VoiceState } from "./types";
import {
  EASE_ARRIVE,
  EASE_EASE,
  EASE_INOUT,
  EASE_OUT,
  type Beat,
  type SequencePreset,
} from "./sequence";

const ZERO_TWEEN = { ms: 0, ease: EASE_OUT };

const BASE: Omit<
  SequencePreset,
  "id" | "hotkey" | "name" | "thesis" | "loopMs" | "beats"
> = {
  handoff: {
    style: "cut",
    humanIn: ZERO_TWEEN,
    humanOut: ZERO_TWEEN,
    riffIn: ZERO_TWEEN,
    riffOut: ZERO_TWEEN,
    smearFrames: 0,
    entryPunch: 0,
  },
  anticipation: { depth: 0, ms: 0 },
  backchannel: { presence: 0, ms: 0 },
  silenceHolder: "human",
  breathe: { periodMs: 0, depth: 0 },
  stepFps: 0,
  markPeak: 1,
  envelope: { attackMs: 0, releaseMs: 0 },
  glow: {
    level: {
      idle: 1,
      "you-talking": 1,
      "riff-talking": 1,
      silence: 1,
      "dead-mic": 1,
    },
    hueBias: 0,
    follow: 0,
    swell: 1,
  },
  job: { emit: "stream", duck: 0, burstUnderlay: 0 },
  landing: {
    policy: "immediate",
    maxHoldMs: 0,
    hitStopMs: 0,
    tipBurst: 0,
    riffNod: false,
    inkStaggerMs: 0,
    impact: { kind: "ticks" },
  },
};

function glowLevels(
  idle: number,
  you: number,
  riff: number,
  silence: number,
  dead: number,
): Record<VoiceState, number> {
  return {
    idle,
    "you-talking": you,
    "riff-talking": riff,
    silence,
    "dead-mic": dead,
  };
}

type Overrides = {
  id: string;
  hotkey: SequencePreset["hotkey"];
  name: string;
  thesis: string;
  loopMs: number;
  beats: Beat[];
  handoff?: Partial<SequencePreset["handoff"]>;
  anticipation?: Partial<SequencePreset["anticipation"]>;
  backchannel?: Partial<SequencePreset["backchannel"]>;
  silenceHolder?: SequencePreset["silenceHolder"];
  breathe?: Partial<SequencePreset["breathe"]>;
  stepFps?: number;
  markPeak?: number;
  envelope?: Partial<SequencePreset["envelope"]>;
  glow?: Partial<SequencePreset["glow"]>;
  job?: Partial<SequencePreset["job"]>;
  landing?: Partial<SequencePreset["landing"]> & {
    impact?: SequencePreset["landing"]["impact"];
  };
};

function preset(o: Overrides): SequencePreset {
  return {
    id: o.id,
    hotkey: o.hotkey,
    name: o.name,
    thesis: o.thesis,
    loopMs: o.loopMs,
    beats: o.beats,
    handoff: { ...BASE.handoff, ...o.handoff },
    anticipation: { ...BASE.anticipation, ...o.anticipation },
    backchannel: { ...BASE.backchannel, ...o.backchannel },
    silenceHolder: o.silenceHolder ?? BASE.silenceHolder,
    breathe: { ...BASE.breathe, ...o.breathe },
    stepFps: o.stepFps ?? BASE.stepFps,
    markPeak: o.markPeak ?? BASE.markPeak,
    envelope: { ...BASE.envelope, ...o.envelope },
    glow: {
      level: { ...BASE.glow.level, ...o.glow?.level },
      hueBias: o.glow?.hueBias ?? BASE.glow.hueBias,
      follow: o.glow?.follow ?? BASE.glow.follow,
      swell: o.glow?.swell ?? BASE.glow.swell,
    },
    job: { ...BASE.job, ...o.job },
    landing: { ...BASE.landing, ...o.landing },
  };
}

// Shared beat timeline for presets 1, 2, 3, 5, 7 (spec §4 table row 1).
const STD_BEATS: Beat[] = [
  { at: 800, kind: "voice", state: "you-talking" },
  { at: 2000, kind: "backchannel" },
  { at: 3400, kind: "yield" },
  { at: 3600, kind: "voice", state: "riff-talking" },
  { at: 4400, kind: "job", event: "start" },
  { at: 6400, kind: "voice", state: "you-talking" },
  { at: 8600, kind: "yield" },
  { at: 8800, kind: "voice", state: "riff-talking" },
  { at: 10200, kind: "job", event: "ready" },
  { at: 11400, kind: "voice", state: "silence" },
  { at: 13200, kind: "job", event: "clear" },
];

export const SEQUENCE_PRESETS: SequencePreset[] = [
  preset({
    id: "hard-cut",
    hotkey: "1",
    name: "Hard Cut",
    thesis: "today's lab retimed into the model — the control",
    loopMs: 14000,
    beats: STD_BEATS,
  }),

  preset({
    id: "breath",
    hotkey: "2",
    name: "Breath",
    thesis: "ChatGPT-calm; one soft presence that breathes between turns",
    loopMs: 14000,
    beats: STD_BEATS,
    handoff: {
      style: "crossfade",
      humanIn: { ms: 120, ease: EASE_OUT },
      humanOut: { ms: 220, ease: EASE_OUT },
      riffIn: { ms: 260, ease: EASE_ARRIVE },
      riffOut: { ms: 140, ease: EASE_OUT },
    },
    envelope: { attackMs: 60, releaseMs: 400 },
    glow: {
      level: glowLevels(0.55, 0.8, 1, 0.6, 0.3),
      hueBias: 0.3,
      follow: 0.35,
    },
    breathe: { periodMs: 4500, depth: 0.04 },
  }),

  preset({
    id: "through-the-disc",
    hotkey: "3",
    name: "Through the Disc",
    thesis: "the disc is the mouth; each voice is swallowed and re-emerges",
    loopMs: 14000,
    beats: STD_BEATS,
    handoff: {
      style: "throughDisc",
      humanIn: { ms: 120, ease: EASE_OUT },
      humanOut: { ms: 180, ease: EASE_INOUT },
      riffIn: { ms: 420, ease: { kind: "spring", bounce: 0.2 } },
      riffOut: { ms: 120, ease: EASE_INOUT },
      entryPunch: 0.5,
    },
    anticipation: { depth: 0.1, ms: 160 },
    breathe: { periodMs: 4000, depth: 0.03 },
    envelope: { attackMs: 80, releaseMs: 300 },
    landing: { inkStaggerMs: 30 },
  }),

  preset({
    id: "mm-hm",
    hotkey: "4",
    name: "Mm-hm",
    thesis:
      "turn-taking science made visible: backchannels, overlap, a polite landing",
    loopMs: 15000,
    beats: [
      { at: 600, kind: "voice", state: "you-talking" },
      { at: 1700, kind: "backchannel" },
      { at: 2900, kind: "backchannel" },
      { at: 3800, kind: "yield" },
      { at: 3950, kind: "voice", state: "riff-talking" },
      { at: 4600, kind: "job", event: "start" },
      { at: 6500, kind: "voice", state: "you-talking" },
      { at: 7600, kind: "backchannel" },
      { at: 8700, kind: "yield" },
      { at: 9100, kind: "voice", state: "riff-talking" },
      { at: 9800, kind: "job", event: "ready" },
      { at: 11600, kind: "voice", state: "silence" },
      { at: 14000, kind: "job", event: "clear" },
    ],
    handoff: {
      style: "crossfade",
      humanIn: { ms: 100, ease: EASE_OUT },
      humanOut: { ms: 320, ease: EASE_OUT },
      riffIn: { ms: 200, ease: EASE_OUT },
      riffOut: { ms: 110, ease: EASE_OUT },
    },
    anticipation: { depth: 0.05, ms: 150 },
    backchannel: { presence: 0.35, ms: 260 },
    silenceHolder: "riff",
    envelope: { attackMs: 80, releaseMs: 500 },
    glow: { level: glowLevels(0.6, 0.85, 1, 0.7, 0.3), follow: 0.25 },
    job: { duck: 0.4, burstUnderlay: 0.2, emit: "stream" },
    landing: { policy: "nextGap", maxHoldMs: 2000, riffNod: true },
  }),

  preset({
    id: "sidechain",
    hotkey: "5",
    name: "Sidechain",
    thesis:
      "light carries the turn; voice ducks the sketch like vocals over a bed",
    loopMs: 14000,
    beats: STD_BEATS,
    handoff: {
      style: "crossfade",
      humanIn: { ms: 120, ease: EASE_OUT },
      humanOut: { ms: 200, ease: EASE_OUT },
      riffIn: { ms: 220, ease: EASE_OUT },
      riffOut: { ms: 120, ease: EASE_OUT },
    },
    markPeak: 0.5,
    envelope: { attackMs: 30, releaseMs: 250 },
    glow: {
      level: glowLevels(0.35, 0.9, 1, 0.45, 0.15),
      hueBias: 1,
      follow: 0.9,
      swell: 1.12,
    },
    job: { duck: 0.8, emit: "stream" },
    breathe: { periodMs: 5000, depth: 0.06 },
  }),

  preset({
    id: "call-and-response",
    hotkey: "6",
    name: "Call & Response",
    thesis: "the sketch answers in the rests",
    loopMs: 16000,
    beats: [
      { at: 700, kind: "voice", state: "you-talking" },
      { at: 2700, kind: "yield" },
      { at: 3400, kind: "voice", state: "riff-talking" },
      { at: 4000, kind: "job", event: "start" },
      { at: 5600, kind: "voice", state: "silence" },
      { at: 6300, kind: "voice", state: "you-talking" },
      { at: 8300, kind: "yield" },
      { at: 9000, kind: "voice", state: "riff-talking" },
      { at: 9600, kind: "job", event: "ready" },
      { at: 11000, kind: "voice", state: "silence" },
      { at: 14800, kind: "job", event: "clear" },
    ],
    handoff: {
      style: "throughDisc",
      humanIn: { ms: 120, ease: EASE_OUT },
      humanOut: { ms: 240, ease: EASE_INOUT },
      riffIn: { ms: 380, ease: { kind: "spring", bounce: 0.15 } },
      riffOut: { ms: 140, ease: EASE_INOUT },
    },
    anticipation: { depth: 0.12, ms: 240 },
    silenceHolder: "riff",
    breathe: { periodMs: 3000, depth: 0.05 },
    envelope: { attackMs: 120, releaseMs: 500 },
    glow: { level: glowLevels(0.5, 0.75, 1, 0.9, 0.3) },
    job: { emit: "gaps" },
    landing: {
      policy: "nextGap",
      maxHoldMs: 2500,
      hitStopMs: 70,
      tipBurst: 24,
      riffNod: true,
      inkStaggerMs: 50,
    },
  }),

  preset({
    id: "catch",
    hotkey: "7",
    name: "Catch",
    thesis: "your words become the sparks that become the sketch",
    loopMs: 14000,
    beats: STD_BEATS,
    handoff: {
      style: "crossfade",
      humanIn: { ms: 100, ease: EASE_OUT },
      humanOut: { ms: 200, ease: EASE_OUT },
      riffIn: { ms: 240, ease: EASE_ARRIVE },
      riffOut: { ms: 120, ease: EASE_OUT },
    },
    backchannel: { presence: 0.25, ms: 220 },
    job: { emit: "onsets", burstUnderlay: 0.3 },
    landing: {
      tipBurst: 40,
      riffNod: true,
      impact: { kind: "squash", bounce: 0.2 },
      inkStaggerMs: 40,
    },
  }),

  preset({
    id: "juice",
    hotkey: "8",
    name: "Juice",
    thesis: "manga smash cuts and game hit-feel; the landing is an event",
    loopMs: 11000,
    beats: [
      { at: 500, kind: "voice", state: "you-talking" },
      { at: 1300, kind: "backchannel" },
      { at: 2300, kind: "yield" },
      { at: 2450, kind: "voice", state: "riff-talking" },
      { at: 2900, kind: "job", event: "start" },
      { at: 4600, kind: "voice", state: "you-talking" },
      { at: 6200, kind: "yield" },
      { at: 6350, kind: "voice", state: "riff-talking" },
      { at: 7400, kind: "job", event: "ready" },
      { at: 8600, kind: "voice", state: "silence" },
      { at: 10300, kind: "job", event: "clear" },
    ],
    handoff: {
      style: "cut",
      smearFrames: 2,
      entryPunch: 1.2,
    },
    anticipation: { depth: 0.18, ms: 90 },
    backchannel: { presence: 0.5, ms: 120 },
    envelope: { attackMs: 5, releaseMs: 150 },
    glow: { level: glowLevels(0.5, 0.9, 1, 0.6, 0.2), follow: 0.6, swell: 1.1 },
    job: { emit: "onsets" },
    landing: {
      tipBurst: 60,
      hitStopMs: 100,
      riffNod: true,
      impact: { kind: "squash", bounce: 0.35 },
      inkStaggerMs: 30,
    },
  }),

  preset({
    id: "flipbook",
    hotkey: "9",
    name: "Flipbook",
    thesis:
      "paper stop-motion; marks animate on threes while light stays smooth",
    loopMs: 12000,
    beats: [
      { at: 750, kind: "voice", state: "you-talking" },
      { at: 2000, kind: "backchannel" },
      { at: 3250, kind: "yield" },
      { at: 3625, kind: "voice", state: "riff-talking" },
      { at: 4375, kind: "job", event: "start" },
      { at: 6250, kind: "voice", state: "you-talking" },
      { at: 8000, kind: "yield" },
      { at: 8375, kind: "voice", state: "riff-talking" },
      { at: 9500, kind: "job", event: "ready" },
      { at: 10500, kind: "voice", state: "silence" },
      { at: 11500, kind: "job", event: "clear" },
    ],
    handoff: {
      style: "crossfade",
      humanIn: { ms: 125, ease: { kind: "steps", n: 1 } },
      humanOut: { ms: 250, ease: { kind: "steps", n: 2 } },
      riffIn: { ms: 375, ease: { kind: "steps", n: 3 } },
      riffOut: { ms: 125, ease: { kind: "steps", n: 1 } },
      smearFrames: 1,
      entryPunch: 0.6,
    },
    stepFps: 8,
    breathe: { periodMs: 3000, depth: 0.05 },
    envelope: { attackMs: 100, releaseMs: 400 },
    glow: { level: glowLevels(0.6, 0.9, 1, 0.7, 0.3) },
    landing: { inkStaggerMs: 60 },
  }),

  preset({
    id: "still-water",
    hotkey: "0",
    name: "Still Water",
    thesis:
      "identity through hue and opacity only; nothing travels — reduced-motion by construction",
    loopMs: 14000,
    beats: STD_BEATS,
    handoff: {
      style: "crossfade",
      humanIn: { ms: 150, ease: EASE_EASE },
      humanOut: { ms: 300, ease: EASE_EASE },
      riffIn: { ms: 300, ease: EASE_EASE },
      riffOut: { ms: 150, ease: EASE_EASE },
    },
    markPeak: 0.8,
    stepFps: 3,
    envelope: { attackMs: 300, releaseMs: 600 },
    glow: { level: glowLevels(0.4, 0.8, 0.8, 0.5, 0.2), hueBias: 0.6 },
    job: { emit: "none" },
    landing: { policy: "nextGap", maxHoldMs: 1500, impact: { kind: "none" } },
  }),
];

export const SEQUENCE_BY_ID: Record<string, SequencePreset> =
  Object.fromEntries(SEQUENCE_PRESETS.map((p) => [p.id, p]));
export const SEQUENCE_BY_HOTKEY: Record<string, SequencePreset> =
  Object.fromEntries(SEQUENCE_PRESETS.map((p) => [p.hotkey, p]));

// Preset 10 — reduced motion swaps the active preset's *motion* settings for
// these (spec §5 precedence #3). Beats, glow levels, and hueBias are not
// part of this set; they stay whatever the active preset defines.
export const REDUCED_MOTION_PRESET = SEQUENCE_BY_ID["still-water"];
