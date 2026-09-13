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
  // Morph layer additions (docs/voice-lab-morph-spec.md §2 F2/F4): continuous
  // 0..1 talk-mode blend (undefined when Morph is Off, so marks fall back to
  // the discrete `mode` string), a 0..1 draw-on fraction for Ink & Wash, and
  // a ray-length multiplier for Elastic/Shapeshift. Both default to "no
  // effect" when absent/1 so every mark's Off behavior is unchanged.
  talk?: number;
  reveal?: number;
  radial?: number;
};

// Sparks-build-the-sketch dials (build-plan.md §4, dotgrid addendum §3).
export type BuildConfig = {
  flightSpeed: number; // 0.5-2, divides the base flight duration
  arc: number; // 0-0.5, arc bow as a fraction of chord length
  densityFrame: number; // particles per 100px, tier 0 (outline)
  densityBlocks: number; // tier 1 (rect/circle)
  densityDetails: number; // tier 2 (line/cross)
  tierGapMs: number; // -200..300, gap (negative = overlap) between tiers
  speculativeFrame: "off" | "construction" | "full";
  guideDots: "off" | "dots" | "dotsLines";
  arrival: "dotsLead" | "comet";
  snapToGrid: boolean;
  dotPop: number; // 0-1
  waitEmberRate: number; // sparks/sec floor during a long pre-landing hold
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
  // Fluid "shader" glow (Canvas2D, no WebGL) — a CPU density field per role,
  // pigment-mixed (not additive) so overlap reads green. "classic" keeps the
  // original two-gradient wash. "fluid" (labeled "Wash" in Panels.tsx) paints
  // the field itself; "dots" tints/brightens dot-grid paper in the field's
  // footprint without drawing the wash canvas; "both" (default) does both.
  // See docs/voice-lab-sequences.md "Fluid glow" and voice-lab-dotgrid-
  // addendum.md §2.
  glowStyle: "fluid" | "dots" | "both" | "classic";
  glowHumanColor: string;
  glowRiffColor: string;
  glowMixSoftness: number;
  glowFlowSpeed: number;
  glowBlobScale: number;
  glowBlobCount: number;
  // Ink-and-wash dials (voice-lab-dotgrid-addendum.md §4).
  glowEdgeAmount: number;
  glowGrainAmount: number;
  glowLayers: number;
  // Role-color dominance dial (addendum §3) — 0-1, default 0.8. Scaled by
  // the active preset's hueBias only when the preset explicitly sets one;
  // BASE ("no opinion") leaves the dial untouched. See
  // engine.ts#roleColorDominance.
  glowRoleColor: number;
  // Stroke-bleed dial (addendum §4 "ties to the drawing elements") — 0-1,
  // default 0.5. Consumed by frames.ts's ink-reveal bleed hook.
  glowBleedAmount: number;
  // Dot-grid paper (addendum §1).
  paperOn: boolean;
  paperPitch: number;
  paperDotSize: number;
  paperBaseOpacity: number;
  // Sparks-build-the-sketch dials (voice-lab-build-plan.md §4 / dotgrid
  // addendum §3). Consumed by build.ts's planBuild/updateBuild.
  buildConfig: BuildConfig;
  // Disc squash & stretch (Disney squash-and-stretch): target aspect comes
  // from role presence (human -> vertical, riff -> horizontal), reached via
  // an overshooting spring, composed multiplicatively with the existing
  // anticipation squash and idle/silence breathe.
  discStretchAmount: number;
  discSquishBounce: number;
  discWobble: number;
  // Morph lab dials (docs/voice-lab-morph-spec.md §5) — style selection lives
  // on the engine (setMorph/getMorph), not here, since it drives its own
  // spring retargeting on change; this only holds the per-style tuner values
  // the MorphPanel exposes.
  morph: {
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
    inkwash: {
      stagger: number;
      stain: number;
      wetBloom: number;
      nib: boolean;
    };
    elastic: { squash: number; wobble: number };
  };
};
