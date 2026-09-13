// Shared motion layer for the voice-lab morph lab (docs/voice-lab-morph-spec.md
// §2/§4). Every visual property that today steps discretely (alpha, scale,
// ray length, reveal) becomes a spring or envelope stepped once per frame on
// one clock here. The 5 Morph styles below are choreographies on this layer,
// not easing swaps — Off never touches this file at all (engine.ts keeps its
// original tween path for Off, per spec §2 F1 "Off").
import type { Role } from "./types";

// ---- Primitives -----------------------------------------------------------

export type SpringSpec = { response: number; damping: number }; // response = undamped period ms (ω=2π/response), damping = ζ

// Semi-implicit Euler in substeps of <=4ms (spec §2 F1 "Integration"), so a
// spring always continues from its current value+velocity — an interrupted
// retarget (e.g. barge-in mid-handoff) never jumps.
export class Spring {
  value = 0;
  velocity = 0;
  target = 0;

  set(v: number) {
    this.value = v;
    this.velocity = 0;
    this.target = v;
  }

  step(dtMs: number, s: SpringSpec) {
    const steps = Math.max(1, Math.ceil(dtMs / 4));
    const h = dtMs / steps / 1000; // seconds per substep
    const wn = (2 * Math.PI) / Math.max(1, s.response / 1000); // rad/s
    const zeta = s.damping;
    for (let i = 0; i < steps; i++) {
      const accel =
        -wn * wn * (this.value - this.target) - 2 * zeta * wn * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
  }
}

// One-pole follower — same shape as engine.ts's existing glowFollower, lifted
// here so every style's wash/energy tracking shares one implementation.
export class Envelope {
  value = 0;
  step(dtMs: number, target: number, attackMs: number, releaseMs: number) {
    const tc = target > this.value ? attackMs : releaseMs;
    if (tc <= 0) {
      this.value = target;
      return;
    }
    const alpha = 1 - Math.exp(-dtMs / tc);
    this.value += (target - this.value) * alpha;
  }
}

// Linear rise over attackMs, then the same x0.86-per-16.7ms decay every onset
// pulse already used (marks previously stepped this by hand). attackMs 0
// reproduces today's instant step.
export class Pulse {
  value = 0;
  private peak = 0;
  private rising = false;

  trigger(peak: number) {
    this.peak = Math.max(peak, this.value, this.peak * 0);
    this.peak = Math.max(peak, this.value);
    this.rising = true;
  }

  step(dtMs: number, attackMs: number) {
    if (this.rising) {
      if (attackMs <= 0) {
        this.value = this.peak;
        this.rising = false;
      } else {
        this.value += ((this.peak - this.value) * dtMs) / attackMs;
        if (this.value >= this.peak - 0.001) {
          this.value = this.peak;
          this.rising = false;
        }
      }
    } else if (this.value > 0.0005) {
      this.value *= Math.pow(0.86, dtMs / 16.7);
    } else {
      this.value = 0;
    }
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function easeInOutCubic(t: number): number {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

// ---- Types ------------------------------------------------------------

export type MorphId =
  "off" | "breath" | "shapeshift" | "relay" | "inkwash" | "elastic";

export const MORPH_IDS: MorphId[] = [
  "off",
  "breath",
  "shapeshift",
  "relay",
  "inkwash",
  "elastic",
];

export const MORPH_LABELS: Record<MorphId, string> = {
  off: "Off (current)",
  breath: "1 · Still Breath",
  shapeshift: "2 · Shapeshift",
  relay: "3 · Relay",
  inkwash: "4 · Ink & Wash",
  elastic: "5 · Elastic",
};

export type RolePose = {
  alpha: number;
  scale: number;
  sx: number;
  sy: number; // sx/sy only ever applied to Amoeba
  radial: number; // Burst ray-length multiplier (Elastic, Shapeshift)
  reveal: number; // 0..1 draw-on (Ink & Wash); 1 = full
  lineMul: number; // stroke width multiplier
  pivot?: { x: number; y: number }; // default = mark's own visual center
};

export function restPose(alpha = 1): RolePose {
  return { alpha, scale: 1, sx: 1, sy: 1, radial: 1, reveal: 1, lineMul: 1 };
}

export type MotionState = {
  presence: Record<Role, Spring>;
  talk: Record<Role, Spring>; // talk: 0 silence-mode .. 1 talking-mode
  morph: Spring; // 0 human form .. 1 riff form (Shapeshift)
  body: { aspect: Spring; radial: Spring; scale: Spring }; // one shared body (Elastic, Breath scale)
  bead: Spring; // Relay
  wash: Record<Role, Envelope>;
  energy: Record<Role, Envelope>;
  onset: Record<Role, Pulse>;
  handoff: { from: Role | null; to: Role | null; at: number };
  backchannel: { at: number; until: number; amount: number };
  jobOut: Spring; // 1 visible .. 0 cleared
  // Non-spec bookkeeping the engine needs to drive retargeting without
  // re-deriving "which SpringSpec currently governs this role" every frame.
  presenceSpec: Record<Role, SpringSpec>;
};

export function createMotionState(): MotionState {
  const m: MotionState = {
    presence: { human: new Spring(), riff: new Spring() },
    talk: { human: new Spring(), riff: new Spring() },
    morph: new Spring(),
    body: { aspect: new Spring(), radial: new Spring(), scale: new Spring() },
    bead: new Spring(),
    wash: { human: new Envelope(), riff: new Envelope() },
    energy: { human: new Envelope(), riff: new Envelope() },
    onset: { human: new Pulse(), riff: new Pulse() },
    handoff: { from: null, to: null, at: 0 },
    backchannel: { at: 0, until: 0, amount: 0 },
    jobOut: new Spring(),
    presenceSpec: {
      human: { response: 200, damping: 1 },
      riff: { response: 200, damping: 1 },
    },
  };
  m.body.radial.set(1);
  m.body.scale.set(1);
  m.jobOut.set(1);
  return m;
}

export type MorphStyle = {
  id: MorphId;
  label: string;
  humanIn: SpringSpec;
  humanOut: SpringSpec;
  riffIn: SpringSpec;
  riffOut: SpringSpec;
  talk: SpringSpec;
  wash: { attackMs: number; releaseMs: number; overlap: number };
  onsetAttackMs: number;
  onsetScale: number;
  clearMs: number;
  cinderDieMs: number;
  pose(role: Role, m: MotionState, now: number): RolePose;
  onHandoff?(
    m: MotionState,
    from: Role | null,
    to: Role | null,
    now: number,
  ): void;
  onBackchannel?(m: MotionState, amount: number, ms: number, now: number): void;
  onLanding?(m: MotionState, now: number): void;
};

// Reduced motion (spec §2 "Reduced motion (toggle or OS), every style"):
// scale/sx/sy/radial pinned to 1, reveal to 1, bead to 0; presence springs
// swap to a shared ~250ms critically-damped spec; wash stays as-is; clear
// becomes a 400ms alpha fade.
export const REDUCED_MOTION_PRESENCE: SpringSpec = {
  response: 330,
  damping: 1,
};

function reducedPose(alpha: number): RolePose {
  return { alpha, scale: 1, sx: 1, sy: 1, radial: 1, reveal: 1, lineMul: 1 };
}

// ---- 1 · Still Breath (quiet) ----------------------------------------
// The old mark exhales and shrinks away while the new one inhales in; the
// watercolor just changes tint.
const BREATH_SCALE = 0.88; // dial: breath.scale

const stillBreath: MorphStyle = {
  id: "breath",
  label: MORPH_LABELS.breath,
  humanIn: { response: 190, damping: 1 },
  humanOut: { response: 480, damping: 1 },
  riffIn: { response: 400, damping: 1 },
  riffOut: { response: 185, damping: 1 },
  talk: { response: 350, damping: 1 },
  wash: { attackMs: 350, releaseMs: 800, overlap: 0.6 },
  onsetAttackMs: 60,
  onsetScale: 0.6,
  clearMs: 600,
  cinderDieMs: 400,
  pose(role, m, now) {
    if (reducedActive) return reducedPose(m.presence[role].value);
    const presence = clamp01(m.presence[role].value);
    const bc = role === "riff" ? backchannelEnvelope(m, now) : 0;
    const scale = BREATH_SCALE + (1 - BREATH_SCALE) * presence;
    return {
      alpha: presence,
      scale: scale * (1 + 0.03 * bc),
      sx: 1,
      sy: 1,
      radial: 1,
      reveal: 1,
      lineMul: 1,
    };
  },
  onBackchannel(m, amount, ms, now) {
    m.backchannel = { at: now, until: now + ms, amount };
  },
};

// A tiny helper shared by styles that need "how far into the backchannel
// window are we" as a 0..1 envelope-shaped value (attack 120/release 300, per
// Still Breath's spec entry) without a dedicated Envelope instance per style.
function backchannelEnvelope(m: MotionState, now: number): number {
  const { at, until, amount } = m.backchannel;
  if (amount <= 0 || now < at) return 0;
  const attack = 120;
  const release = 300;
  if (now <= at + attack) return clamp01((now - at) / attack) * amount;
  if (now <= until) return amount;
  if (now <= until + release)
    return (1 - clamp01((now - until) / release)) * amount;
  return 0;
}

// ---- 4 · Ink & Wash (ink metaphor) — default --------------------------
const EASE_PEN = easeInOutCubic; // bezier(0.33,0,0.2,1) approximated by an inout cubic — see EASE_PEN export below.

const inkWash: MorphStyle = {
  id: "inkwash",
  label: MORPH_LABELS.inkwash,
  humanIn: { response: 145, damping: 1 }, // reveal carries the "draw-on" read; presence just needs to not clip
  humanOut: { response: 420, damping: 1 },
  riffIn: { response: 300, damping: 1 },
  riffOut: { response: 185, damping: 1 },
  talk: { response: 300, damping: 1 },
  wash: { attackMs: 300, releaseMs: 700, overlap: 0.4 },
  onsetAttackMs: 45,
  onsetScale: 1,
  clearMs: 700,
  cinderDieMs: 400,
  pose(role, m, now) {
    const presence = clamp01(m.presence[role].value);
    if (reducedActive) return reducedPose(presence);
    const revealMs = role === "human" ? 140 : 280;
    const at = m.handoff.to === role ? m.handoff.at : 0;
    const reveal = at
      ? EASE_PEN(clamp01((now - at) / revealMs))
      : presence > 0.5
        ? 1
        : 0;
    // Incoming ink is opaque immediately; outgoing fades+bleeds via presence.
    const incoming = m.handoff.to === role;
    const alpha = incoming ? Math.max(presence, reveal) : presence;
    const lineMul = 1 + 0.35 * (1 - presence);
    return {
      alpha,
      scale: 1,
      sx: 1,
      sy: 1,
      radial: 1,
      reveal: Math.max(reveal, presence > 0.95 ? 1 : reveal),
      lineMul,
    };
  },
  onHandoff(m, from, to, now) {
    m.handoff = { from, to, at: now };
  },
  onBackchannel(m, amount, ms, now) {
    m.backchannel = { at: now, until: now + ms, amount };
  },
  onLanding(m, now) {
    m.backchannel = { at: now, until: now + 150, amount: 0.5 };
  },
};

// ---- 3 · Relay (handoff) -----------------------------------------------
const relay: MorphStyle = {
  id: "relay",
  label: MORPH_LABELS.relay,
  humanIn: { response: 240, damping: 0.75 },
  humanOut: { response: 373, damping: 1 }, // gatherMs 140 / 0.755
  riffIn: { response: 360, damping: 0.65 }, // ~7% overshoot release
  riffOut: { response: 119, damping: 1 }, // gather 90 / 0.755
  talk: { response: 260, damping: 1 },
  wash: { attackMs: 180, releaseMs: 500, overlap: 0.5 },
  onsetAttackMs: 35,
  onsetScale: 1,
  clearMs: 450,
  cinderDieMs: 400,
  pose(role, m, now) {
    const presence = clamp01(m.presence[role].value);
    if (reducedActive) return reducedPose(presence);
    const gathering = m.handoff.from === role && now - m.handoff.at < 400;
    const scale = gathering
      ? Math.max(0.08, presence)
      : Math.max(0.08, presence);
    return {
      alpha: presence,
      scale,
      sx: 1,
      sy: 1,
      radial: 1,
      reveal: 1,
      lineMul: 1,
      pivot: { x: 0, y: -15 },
    };
  },
  onHandoff(m, from, to, now) {
    m.handoff = { from, to, at: now };
    m.bead.target = 1;
    m.bead.step(0, { response: 120, damping: 0.7 });
    setTimeout(
      () => {
        m.bead.target = 0;
      },
      from && to ? 200 : 60,
    );
  },
  onBackchannel(m, amount, ms, now) {
    m.backchannel = { at: now, until: now + ms, amount };
    m.bead.target = Math.min(0.85, amount * 2.4);
    setTimeout(() => {
      m.bead.target = 0;
    }, 200);
  },
};

// ---- 5 · Elastic (expressive) -------------------------------------------
const SQUASH = 0.18; // dial: elastic.squash
const WOBBLE_ZETA = 0.45; // dial: elastic.wobble

const elastic: MorphStyle = {
  id: "elastic",
  label: MORPH_LABELS.elastic,
  humanIn: { response: 140, damping: 0.7 },
  humanOut: { response: 120, damping: 1 },
  riffIn: { response: 140, damping: 0.7 },
  riffOut: { response: 120, damping: 1 },
  talk: { response: 200, damping: 1 },
  wash: { attackMs: 120, releaseMs: 450, overlap: 0.5 },
  onsetAttackMs: 30,
  onsetScale: 1,
  clearMs: 350,
  cinderDieMs: 250,
  pose(role, m, now) {
    const presence = clamp01(m.presence[role].value);
    if (reducedActive) return reducedPose(presence);
    const aspect = m.body.aspect.value;
    const radial = 1 + m.body.radial.value - 1;
    if (role === "human") {
      // Amoeba: aspect squash (sy = 1+a, sx = 1/(1+a)), volume-preserving.
      const sy = 1 + aspect;
      const sx = 1 / Math.max(0.4, sy);
      return {
        alpha: presence,
        scale: m.body.scale.value,
        sx,
        sy,
        radial: 1,
        reveal: 1,
        lineMul: 1,
      };
    }
    return {
      alpha: presence,
      scale: 1,
      sx: 1,
      sy: 1,
      radial: Math.max(0.1, m.body.radial.value),
      reveal: 1,
      lineMul: 1,
    };
  },
  onHandoff(m, from, to, now) {
    m.handoff = { from, to, at: now };
    const windupMs = from && to ? 90 : 50;
    const settleZeta = from && to ? WOBBLE_ZETA : WOBBLE_ZETA + 0.05;
    if (from === "human") m.body.aspect.target = -SQUASH;
    else if (from === "riff") m.body.radial.target = 1 - 1.4 * SQUASH;
    setTimeout(() => {
      m.body.aspect.target = 0;
      m.body.radial.target = 1;
      // Re-express settle damping by nudging velocity toward the wobble
      // spec's overshoot character (damping itself is passed in per-step by
      // the engine from this style's springs, so we only need the target).
      void settleZeta;
    }, windupMs);
  },
  onBackchannel(m, amount, ms, now) {
    m.backchannel = { at: now, until: now + ms, amount };
    m.body.aspect.velocity += 0.003 * ms;
  },
  onLanding(m, now) {
    m.body.radial.velocity += 0.006 * 100;
    void now;
  },
};

// ---- 2 · Shapeshift (continuous morph) ----------------------------------
// Only reads as a true continuous morph when human=Amoeba/riff=Burst — the
// engine falls back to Still Breath's pose for any other mark pairing (spec
// §4.2). The morph spring (0 human .. 1 riff) drives marks.ts's
// drawRadialMorph; this style's own pose() only needs to keep alpha/scale
// sane for that fallback path.
const shapeshift: MorphStyle = {
  id: "shapeshift",
  label: MORPH_LABELS.shapeshift,
  humanIn: { response: 180, damping: 1 },
  humanOut: { response: 190, damping: 1 },
  riffIn: { response: 420, damping: 0.9 },
  riffOut: { response: 185, damping: 1 },
  talk: { response: 300, damping: 1 },
  wash: { attackMs: 250, releaseMs: 600, overlap: 0.8 },
  onsetAttackMs: 40,
  onsetScale: 1,
  clearMs: 450,
  cinderDieMs: 400,
  pose(role, m, now) {
    void now;
    // Alpha never fully vanishes mid-handoff (spec: max of both presences),
    // so the shared body always has *something* on screen while morphing.
    const alpha = Math.max(m.presence.human.value, m.presence.riff.value);
    if (reducedActive) return reducedPose(role === "human" ? alpha : 0);
    return {
      alpha: role === "human" ? alpha : 0, // Burst is drawn by drawRadialMorph, not drawRole, when the pairing applies
      scale: 1,
      sx: 1,
      sy: 1,
      radial: 1,
      reveal: 1,
      lineMul: 1,
    };
  },
  onHandoff(m, from, to, now) {
    m.handoff = { from, to, at: now };
    m.morph.target = to === "riff" ? 1 : to === "human" ? 0 : m.morph.target;
  },
  onBackchannel(m, amount, ms, now) {
    m.backchannel = { at: now, until: now + ms, amount };
    const sprout = 0.18; // dial: shapeshift.backchannelSprout
    const prevTarget = m.morph.target;
    m.morph.target = Math.min(1, m.morph.target + sprout);
    setTimeout(() => {
      m.morph.target = prevTarget;
    }, ms);
  },
};

export const MORPH_STYLES: Record<Exclude<MorphId, "off">, MorphStyle> = {
  breath: stillBreath,
  shapeshift,
  relay,
  inkwash: inkWash,
  elastic,
};

// Module-level reduced-motion flag: every style's pose() reads it so
// engine.ts only has to set it once per frame rather than threading it
// through every call. Not part of the spec'd MorphStyle surface, but keeps
// each pose() honest about "only opacity and color move" without a bespoke
// reduced-motion branch duplicated 5 times at the call site.
let reducedActive = false;
export function setMorphReducedMotion(on: boolean) {
  reducedActive = on;
}

export { smoothstep, easeInOutCubic, EASE_PEN };
