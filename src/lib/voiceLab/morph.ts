// Shared motion layer for the voice-lab morph lab (docs/voice-lab-morph-spec.md
// §2/§4). Every visual property that today steps discretely (alpha, scale,
// ray length, reveal) becomes a spring or envelope stepped once per frame on
// one clock here. The 5 Morph styles below are choreographies on this layer,
// not easing swaps — Off never touches this file at all (engine.ts keeps its
// original tween path for Off, per spec §2 F1 "Off").
import type { MorphDials, Role } from "./types";

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
    // response is the undamped period in ms; guard it against 0 before the
    // ms → s conversion (guarding after clamped every period to ≥1s).
    const wn = (2 * Math.PI) / (Math.max(1, s.response) / 1000); // rad/s
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

// What the motion layer reads from the engine every frame. The engine passes
// its own config object (never replaced), so every dial drag is live on the
// next frame with no copying and no per-frame allocation.
export type MorphHost = { morph: MorphDials; centerCircleOn: boolean };

export type MotionState = {
  presence: Record<Role, Spring>;
  talk: Record<Role, Spring>; // talk: 0 silence-mode .. 1 talking-mode
  morph: Spring; // 0 human form .. 1 riff form (Shapeshift)
  morphRest: number; // Shapeshift's form outside a backchannel window
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
  // Ink & Wash wet bloom (spec §4.4): added to the wash edge amount.
  bloom: Envelope;
  // Wash envelope target override for this frame (Relay's hold); −1 = none.
  washHold: number;
  relay: RelayState;
  host: MorphHost;
};

// Relay's handoff timeline (spec §4.3). "pass" = A gathers into the bead and
// B releases out of it; "rest" = no incoming speaker, every role follows its
// presence target (a silence holder coils, the rest gather away).
export type RelayState = {
  kind: "rest" | "pass";
  from: Role | null; // A — whoever was visibly holding the floor
  to: Role | null; // B
  at: number;
  released: boolean;
  scale: Record<Role, Spring>;
  alpha: Record<Role, Envelope>;
  gatherSpec: Record<Role, SpringSpec>;
  beadMix: number; // bead color 0 = A .. 1 = B
  bc: Spring; // backchannel bead offset 0..1
  land: {
    on: boolean;
    at: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
};

export function createMotionState(host: MorphHost): MotionState {
  const m: MotionState = {
    presence: { human: new Spring(), riff: new Spring() },
    talk: { human: new Spring(), riff: new Spring() },
    morph: new Spring(),
    morphRest: 0,
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
    bloom: new Envelope(),
    washHold: -1,
    relay: {
      kind: "rest",
      from: null,
      to: null,
      at: 0,
      released: true,
      scale: { human: new Spring(), riff: new Spring() },
      alpha: { human: new Envelope(), riff: new Envelope() },
      gatherSpec: {
        human: { response: 185, damping: 1 },
        riff: { response: 119, damping: 1 },
      },
      beadMix: 0,
      bc: new Spring(),
      land: { on: false, at: 0, x0: 0, y0: 0, x1: 0, y1: 0 },
    },
    host,
  };
  m.relay.scale.human.set(0.08);
  m.relay.scale.riff.set(0.08);
  m.body.radial.set(1);
  m.body.scale.set(1);
  m.jobOut.set(1);
  return m;
}

// Global dials (spec §4 preamble): Speed divides every r and ms — the engine
// steps springs/envelopes on dt × speed, and timeline code divides its ms by
// dialSpeed(); Intensity multiplies every spatial amount.
export function dialSpeed(m: MotionState): number {
  return Math.max(0.05, m.host.morph.speed);
}

function dialIntensity(m: MotionState): number {
  return Math.max(0, m.host.morph.intensity);
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
  // Style-owned springs/timelines, stepped once per frame after the shared
  // layer. dtMs is already speed-scaled; `now` is the frame clock.
  step?(m: MotionState, now: number, dtMs: number): void;
  onHandoff?(
    m: MotionState,
    from: Role | null,
    to: Role | null,
    now: number,
  ): void;
  onBackchannel?(m: MotionState, amount: number, ms: number, now: number): void;
  onLanding?(m: MotionState, now: number): void;
  // Seeds style-owned state from the current presence when the style is
  // switched to mid-loop, so nothing jumps.
  onEnter?(m: MotionState, now: number): void;
};

// Reduced motion (spec §2 "Reduced motion (toggle or OS), every style"):
// scale/sx/sy/radial pinned to 1, reveal to 1, bead to 0; presence springs
// swap to a shared ~250ms critically-damped spec; wash stays as-is; clear
// becomes a 400ms alpha fade.
export const REDUCED_MOTION_PRESENCE: SpringSpec = {
  response: 330,
  damping: 1,
};

// One reusable pose per role: pose() runs for every role every frame, so it
// writes into these instead of allocating. Callers read it before the next
// pose() call for the same role.
const POSE: Record<Role, RolePose> = { human: restPose(), riff: restPose() };

function writePose(
  role: Role,
  alpha: number,
  scale = 1,
  sx = 1,
  sy = 1,
  radial = 1,
  reveal = 1,
  lineMul = 1,
  pivot?: { x: number; y: number },
): RolePose {
  const p = POSE[role];
  p.alpha = alpha;
  p.scale = scale;
  p.sx = sx;
  p.sy = sy;
  p.radial = radial;
  p.reveal = reveal;
  p.lineMul = lineMul;
  p.pivot = pivot;
  return p;
}

function reducedPose(role: Role, alpha: number): RolePose {
  return writePose(role, alpha);
}

// ---- 1 · Still Breath (quiet) ----------------------------------------
// The old mark exhales and shrinks away while the new one inhales in; the
// watercolor just changes tint.
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
    if (reducedActive) return reducedPose(role, m.presence[role].value);
    const presence = clamp01(m.presence[role].value);
    // Spec §4.1: the backchannel nod is Amoeba's (+3%), not Burst's.
    const bc = role === "human" ? backchannelEnvelope(m, now) : 0;
    // Breath scale S (dial); Intensity scales the shrink depth 1 − S.
    const S = 1 - (1 - m.host.morph.breath.scale) * dialIntensity(m);
    const scale = S + (1 - S) * presence;
    return writePose(role, presence, scale * (1 + 0.03 * bc));
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
  const speed = dialSpeed(m);
  const attack = 120 / speed;
  const release = 300 / speed;
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
    if (reducedActive) return reducedPose(role, presence);
    const revealMs = (role === "human" ? 140 : 280) / dialSpeed(m);
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
    return writePose(
      role,
      alpha,
      1,
      1,
      1,
      1,
      Math.max(reveal, presence > 0.95 ? 1 : reveal),
      lineMul,
    );
  },
  // Wet bloom (dial, spec §4.4): on each handoff the wash edge swells by an
  // Envelope (attack 80, release 500) that targets the dial for 150ms.
  step(m, now, dt) {
    const d = m.host.morph;
    const open = m.handoff.at > 0 && (now - m.handoff.at) * dialSpeed(m) < 150;
    m.bloom.step(dt, open ? d.inkwash.wetBloom : 0, 80, 500);
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
// Handoff timeline A → B from handoff.at (spec §4.3), stepped on the frame
// clock (no timers):
//   gather   A's scale → 0.08 via {gatherMs/0.755, 1}; alpha =
//            smoothstep(0.1, 0.35, scale); pivot = bead anchor (o.x,
//            o.y − 15), or o when the disc is on
//   bead     springs to 1 from 60% of gather {120, .7}, to 0 at release
//            {120, 1}; color lerps A → B
//   hold     holdMs; both wash envelopes target 0.5 (brand green)
//   release  B's scale 0.08 → 1 via {360, .65} (Riff) / {240, .75} (human),
//            alpha 0 → 1 over its first 60ms, onset.trigger(releasePunch)
// you → riff uses the gatherMs/holdMs dials; riff → you and loop wrap gather
// 90 and release at 60; idle → you releases at 60 out of the squiggle.
const ROLES: Role[] = ["human", "riff"];
const PIVOT_BEAD = { x: 0, y: -15 };
const PIVOT_ORIGIN = { x: 0, y: 0 };
const RELAY_RELEASE: Record<Role, SpringSpec> = {
  riff: { response: 360, damping: 0.65 }, // 7% overshoot
  human: { response: 240, damping: 0.75 },
};
const RELAY_COIL: SpringSpec = { response: 400, damping: 1 };
const RELAY_BEAD_UP: SpringSpec = { response: 120, damping: 0.7 };
const RELAY_BEAD_DOWN: SpringSpec = { response: 120, damping: 1 };
const RELAY_BC: SpringSpec = { response: 260, damping: 0.5 };

function relayGatherMs(m: MotionState, role: Role | null): number {
  if (role === "human") return m.host.morph.relay.gatherMs;
  return role === "riff" ? 90 : 60; // null = the idle squiggle
}

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
    void now;
    const presence = clamp01(m.presence[role].value);
    if (reducedActive) return reducedPose(role, presence);
    const r = m.relay;
    return writePose(
      role,
      clamp01(r.alpha[role].value),
      Math.max(0, r.scale[role].value),
      1,
      1,
      1,
      1,
      1,
      m.host.centerCircleOn ? PIVOT_ORIGIN : PIVOT_BEAD,
    );
  },
  step(m, now, dt) {
    const r = m.relay;
    const e = (now - r.at) * dialSpeed(m);
    const A = r.from;
    const B = r.to;
    const pass = r.kind === "pass";
    const gatherMs = relayGatherMs(m, A);
    const releaseAt = !pass
      ? Infinity
      : A === "human"
        ? gatherMs + m.host.morph.relay.holdMs
        : 60;
    for (const role of ROLES) {
      const sc = r.scale[role];
      const al = r.alpha[role];
      const holdTarget = m.presence[role].target;
      let spec: SpringSpec;
      let alphaTarget: number;
      if (pass && role === B && e >= releaseAt) {
        if (!r.released) {
          r.released = true;
          if (al.value < 0.01) sc.set(0.08);
          if (!reducedActive)
            m.onset[role].trigger(
              m.host.morph.relay.releasePunch * dialIntensity(m),
            );
        }
        sc.target = 1;
        spec = RELAY_RELEASE[role];
        alphaTarget = 1;
      } else if (!pass && holdTarget > 0.01) {
        // Holds the floor with no incoming speaker: a silence holder coils.
        sc.target = holdTarget >= 1 ? 1 : 0.55;
        spec = RELAY_COIL;
        alphaTarget = holdTarget;
      } else {
        // Gather into the bead: A, a not-yet-released B, or a bystander.
        // A role that is already invisible parks at bead size silently.
        if (al.value < 0.01 && sc.value > 0.08) sc.set(0.08);
        spec = r.gatherSpec[role];
        spec.response = relayGatherMs(m, role) / 0.755;
        sc.target = 0.08;
        alphaTarget = smoothstep(0.1, 0.35, sc.value);
      }
      sc.step(dt, spec);
      // Attack tc 20ms ≈ the spec's 60ms alpha ramp; release follows the
      // gather's smoothstep closely.
      al.step(dt, alphaTarget, 20, 12);
    }

    // Bead: from 60% of the gather until release (a gather with nobody
    // incoming just ends at the gather's end).
    const beadEnd = pass ? releaseAt : A ? gatherMs : -1;
    const beadTarget =
      !reducedActive && e >= 0.6 * gatherMs && e < beadEnd ? 1 : 0;
    m.bead.target = beadTarget;
    m.bead.step(
      dt,
      beadTarget > m.bead.value ? RELAY_BEAD_UP : RELAY_BEAD_DOWN,
    );
    r.beadMix = pass
      ? clamp01((e - 0.6 * gatherMs) / Math.max(1, releaseAt - 0.6 * gatherMs))
      : 0;
    // Hold: both washes → 0.5 so the pigment mix reads brand green.
    m.washHold = pass && e >= gatherMs && e < releaseAt ? 0.5 : -1;

    // Backchannel bead: out for the first ~half period, then springs back.
    const bc = m.backchannel;
    r.bc.target =
      bc.amount > 0 && now >= bc.at && (now - bc.at) * dialSpeed(m) < 130
        ? 1
        : 0;
    r.bc.step(dt, RELAY_BC);
  },
  onHandoff(m, from, to, now) {
    m.handoff = { from, to, at: now };
    const r = m.relay;
    r.at = now;
    r.to = to;
    // Loop wrap (silence → you) has no talking "from", but the coiled Burst
    // is still on screen: it is A.
    r.from =
      from ??
      (to !== "riff" && m.presence.riff.value > 0.05
        ? "riff"
        : to !== "human" && m.presence.human.value > 0.05
          ? "human"
          : null);
    r.kind = to ? "pass" : "rest";
    r.released = false;
  },
  onBackchannel(m, amount, ms, now) {
    m.backchannel = { at: now, until: now + ms, amount };
  },
  // Landing bead (dial): the coiled bead travels to the nearest frame; the
  // engine fills in the path and fires the tip sparks on arrival.
  onLanding(m, now) {
    m.relay.land.on = m.host.morph.relay.landingBead && !reducedActive;
    m.relay.land.at = now;
  },
  onEnter(m, now) {
    const r = m.relay;
    r.kind = "rest";
    r.from = null;
    r.to = null;
    r.at = now - 10000;
    r.released = true;
    for (const role of ROLES) {
      const target = m.presence[role].target;
      r.scale[role].set(target > 0.01 ? (target >= 1 ? 1 : 0.55) : 0.08);
      r.alpha[role].value = clamp01(m.presence[role].value);
    }
    m.bead.set(0);
    r.bc.set(0);
    r.land.on = false;
  },
};

// ---- 5 · Elastic (expressive) -------------------------------------------
// Body springs settle with the Wobble dial as ζ (spec §4.5); one scratch spec
// mutated per frame so the dial is live without allocating.
const ELASTIC_BODY: SpringSpec = { response: 300, damping: 0.45 };
const ELASTIC_SCALE: SpringSpec = { response: 200, damping: 0.8 };

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
    void now;
    const presence = clamp01(m.presence[role].value);
    if (reducedActive) return reducedPose(role, presence);
    const aspect = m.body.aspect.value;
    if (role === "human") {
      // Amoeba: aspect squash (sy = 1+a, sx = 1/(1+a)), volume-preserving.
      const sy = 1 + aspect;
      const sx = 1 / Math.max(0.4, sy);
      return writePose(role, presence, m.body.scale.value, sx, sy);
    }
    return writePose(
      role,
      presence,
      1,
      1,
      1,
      Math.max(0.1, m.body.radial.value),
    );
  },
  step(m, now, dt) {
    void now;
    ELASTIC_BODY.damping = m.host.morph.elastic.wobble;
    m.body.aspect.step(dt, ELASTIC_BODY);
    m.body.radial.step(dt, ELASTIC_BODY);
    m.body.scale.step(dt, ELASTIC_SCALE);
  },
  onHandoff(m, from, to, now) {
    m.handoff = { from, to, at: now };
    const windupMs = (from && to ? 90 : 50) / dialSpeed(m);
    const squash = m.host.morph.elastic.squash * dialIntensity(m);
    if (from === "human") m.body.aspect.target = -squash;
    else if (from === "riff") m.body.radial.target = 1 - 1.4 * squash;
    setTimeout(() => {
      m.body.aspect.target = 0;
      m.body.radial.target = 1;
    }, windupMs);
  },
  onBackchannel(m, amount, ms, now) {
    m.backchannel = { at: now, until: now + ms, amount };
    m.body.aspect.velocity += 0.003 * ms * dialIntensity(m);
  },
  onLanding(m, now) {
    m.body.radial.velocity += 0.006 * 100 * dialIntensity(m);
    void now;
  },
};

// ---- 2 · Shapeshift (continuous morph) ----------------------------------
// Human = Amoeba / Riff = Burst only (spec §4.2): marks.ts's
// drawShapeshiftBody draws one body on shared K angular slots, driven by the
// morph spring (0 human form .. 1 riff form). The engine falls back to Still
// Breath poses for any other pairing, and under reduced motion (the body's
// geometry would move; only opacity may).
const SHAPESHIFT_TO_RIFF: SpringSpec = { response: 420, damping: 0.9 }; // ≈290ms, ~0% overshoot
const SHAPESHIFT_TO_HUMAN: SpringSpec = { response: 180, damping: 1 }; // ≈135ms

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
  // The shared body's pose (the engine draws it once, from the human pass):
  // alpha never vanishes mid-handoff — max of both presences. Geometry
  // comes from m.morph, not scale/radial, so those stay at rest.
  pose(role, m, now) {
    void now;
    const alpha = Math.max(m.presence.human.value, m.presence.riff.value);
    if (reducedActive)
      return reducedPose(role, clamp01(m.presence[role].value));
    return writePose(role, clamp01(alpha));
  },
  // Frame-driven morph target (no setTimeout): rest form from the last
  // handoff, raised to the Backchannel sprout dial for the backchannel window.
  step(m, now, dt) {
    const bc = m.backchannel;
    const inWindow = bc.amount > 0 && now >= bc.at && now <= bc.until;
    const sprout = Math.min(
      1,
      m.host.morph.shapeshift.backchannelSprout * dialIntensity(m),
    );
    m.morph.target = inWindow ? Math.max(m.morphRest, sprout) : m.morphRest;
    m.morph.step(
      dt,
      m.morph.target > m.morph.value ? SHAPESHIFT_TO_RIFF : SHAPESHIFT_TO_HUMAN,
    );
    // m clamped to [0, 1.04] (spec §4.2).
    if (m.morph.value > 1.04) {
      m.morph.value = 1.04;
      m.morph.velocity = Math.min(0, m.morph.velocity);
    } else if (m.morph.value < 0) {
      m.morph.value = 0;
      m.morph.velocity = Math.max(0, m.morph.velocity);
    }
  },
  // Morph target: you → 0; riff → 1; silence keeps the last form (holder
  // riff stays open at 1).
  onHandoff(m, from, to, now) {
    m.handoff = { from, to, at: now };
    if (to === "riff") m.morphRest = 1;
    else if (to === "human") m.morphRest = 0;
  },
  onBackchannel(m, amount, ms, now) {
    m.backchannel = { at: now, until: now + ms, amount };
  },
};

// Ray sprout for drawShapeshiftBody: smoothstep(Sprout delay, 1, m) (spec
// §4.2). A backchannel parks m at the Backchannel sprout value, below the
// delay, where that smoothstep is ~0 — so inside the backchannel envelope the
// spokes grow with m itself ("3-4 short green spokes, then reabsorbed").
export function shapeshiftSprout(m: MotionState, now: number): number {
  const mv = clamp01(m.morph.value);
  const handoff = smoothstep(m.host.morph.shapeshift.sproutDelay, 1, mv);
  const bc = m.backchannel.amount;
  const bcEnv = bc > 0 ? backchannelEnvelope(m, now) / bc : 0;
  return Math.max(handoff, bcEnv * mv);
}

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
