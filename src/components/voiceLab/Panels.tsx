"use client";

import { useEffect, useRef } from "react";
import { useDialKit, useDialKitController } from "dialkit";
import { useEngine, type EngineHandle } from "./EngineContext";
import { MARKS } from "@/lib/voiceLab/marks";
import {
  INK,
  RIFF_GREEN,
  GLOW_DEFAULT_STRENGTH,
  GLOW_DEFAULT_SIZE,
  GLOW_DEFAULT_HEIGHT,
  GLOW_DEFAULT_COLOR_MIX,
  GLOW_DEFAULT_EDGE_SOFTNESS,
} from "@/lib/voiceLab/constants";
import { VOICE_STATE_LABELS, type Role } from "@/lib/voiceLab/types";
import { SEQUENCE_PRESETS } from "@/lib/voiceLab/sequences";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Every panel persists to localStorage under its own stable key, and pushes
// its (possibly restored) values into the engine on first mount via the
// same effects that handle later changes — there's no second code path.
function persistKey(key: string) {
  return { key: `voiceLab.${key}`, storage: "localStorage" as const };
}

// One-time, version-gated migration: Amoeba replaces Ripple as the default
// human mark (ask 3). Sean's saved DialKit state persists as
// `{version:1, values:{mark,color}, baseValues:{...}, ...}` under
// `voiceLab.voiceRole.human` (DialKit's own persistPanel/loadPersistedPanel,
// node_modules/dialkit/dist/index.js). If he'd pinned it to the old default
// ("ripple"), flip only `values.mark` (and `baseValues.mark`, kept in sync
// so the panel doesn't show a false "modified" diff) to "amoeba" — every
// other stored field, including his Ripple tuner values under
// `voiceLab.mark.human.ripple` and the Riff mark/tuning, is untouched. Runs
// once ever, gated by its own key, at module load — before RoleVoicePanel's
// useDialKit reads persisted state on mount.
function migrateHumanMarkToAmoeba() {
  if (typeof window === "undefined") return;
  const GATE_KEY = "voiceLab.migration.humanMarkAmoebaV1";
  try {
    if (window.localStorage.getItem(GATE_KEY)) return;
    const raw = window.localStorage.getItem("voiceLab.voiceRole.human");
    if (raw) {
      const parsed = JSON.parse(raw) as {
        version?: number;
        values?: { mark?: string };
        baseValues?: { mark?: string };
      };
      if (parsed?.version === 1 && parsed.values?.mark === "ripple") {
        parsed.values.mark = "amoeba";
        if (parsed.baseValues?.mark === "ripple")
          parsed.baseValues.mark = "amoeba";
        window.localStorage.setItem(
          "voiceLab.voiceRole.human",
          JSON.stringify(parsed),
        );
      }
    }
  } catch {
    // Corrupt/unavailable storage — leave it alone; DialKit's own default
    // (now Amoeba) applies to a fresh panel.
  } finally {
    window.localStorage.setItem(GATE_KEY, "1");
  }
}
migrateHumanMarkToAmoeba();

// New SequencePanel (spec §5) first — hotkeys 1-9/0 select + reset + play
// from 0 also drive this same select/play pair, so the panel and keyboard
// never fall out of sync.
function SequencePanel() {
  const handle = useEngine();
  // Controller (not the plain useDialKit values) because this is the one
  // sanctioned setValue use in the file: hotkeys, `, and Z drive the engine
  // directly, and this panel must mirror that back into the Preset select
  // and Play toggle so they never fall out of sync (spec §5).
  const controller = useDialKitController(
    "Sequence",
    {
      preset: {
        type: "select",
        options: SEQUENCE_PRESETS.map((p) => ({
          value: p.id,
          label: `${p.hotkey} · ${p.name}`,
        })),
        // Fresh install (no persisted Sequence value) opens on the Blend
        // strawman — the orchestrator's recommended combination — not the
        // Hard Cut control (spec §4 row 11).
        default: "blend",
      },
      play: true,
    },
    { persist: persistKey("sequence") },
  );
  const preset = controller.values.preset as string;
  const play = controller.values.play as boolean;

  // Latest controller for the status-sync effect below, which must only
  // subscribe once (not resubscribe on every value change). The controller
  // itself is stable across renders; its `getValues()` always reads the
  // live DialKit store, so this never goes stale the way a plain ref keyed
  // off a closed-over value would.
  const controllerRef = useRef(controller);
  useEffect(() => {
    controllerRef.current = controller;
  }, [controller]);

  // Idempotent against engine truth: only reselect when the DialKit pick
  // actually differs from what the engine already has active. This is what
  // stops an engine→DialKit status sync from re-triggering selectSequence
  // (which always restarts the loop) — no separate "skip" flag needed, and
  // it can't go stale the way a ref keyed off a render could.
  useEffect(() => {
    if (!handle) return;
    if (preset === handle.engine.getActiveSequenceId()) return;
    handle.engine.selectSequence(preset);
  }, [handle, preset]);

  useEffect(() => {
    if (!handle) return;
    if (play) handle.autoplay.start();
    else handle.autoplay.stop();
  }, [handle, play]);

  useEffect(() => {
    if (!handle) return;
    return handle.engine.onStatusChange((status) => {
      const c = controllerRef.current;
      const live = c.getValues();
      if (status.sequenceId !== live.preset) {
        c.setValue("preset", status.sequenceId);
      }
      if (status.sequencePlaying !== live.play) {
        c.setValue("play", status.sequencePlaying);
      }
    });
  }, [handle]);

  return null;
}

// Morph lab (docs/voice-lab-morph-spec.md §5) — style select + hotkey sync,
// same idempotent pattern as SequencePanel above so a keyboard cycle (M /
// Shift+M) and this select never fall out of sync. Dial values are pushed
// straight into engine.config.morph; only `style` round-trips through
// setMorph/getMorph, since that's the one call with side effects (spring
// retargeting).
function MorphPanel() {
  const handle = useEngine();
  const controller = useDialKitController(
    "Morph",
    {
      style: {
        type: "select",
        options: [
          { value: "off", label: "Off (current)" },
          { value: "breath", label: "1 · Still Breath" },
          { value: "shapeshift", label: "2 · Shapeshift" },
          { value: "relay", label: "3 · Relay" },
          { value: "inkwash", label: "4 · Ink & Wash" },
          { value: "elastic", label: "5 · Elastic" },
        ],
        default: "inkwash",
      },
      speed: [1, 0.5, 2, 0.05],
      intensity: [1, 0, 1.5, 0.05],
      breath: { _collapsed: true, scale: [0.88, 0.7, 1, 0.01] },
      shapeshift: {
        _collapsed: true,
        sproutDelay: [0.15, 0, 0.6, 0.05],
        backchannelSprout: [0.18, 0, 0.5, 0.02],
      },
      relay: {
        _collapsed: true,
        gatherMs: [140, 60, 300, 10],
        holdMs: [60, 0, 200, 10],
        releasePunch: [0.6, 0, 1.5, 0.05],
        landingBead: true,
      },
      inkwash: {
        _collapsed: true,
        stagger: [0.6, 0, 1.5, 0.05],
        stain: [0.6, 0, 1, 0.05],
        wetBloom: [0.15, 0, 0.4, 0.01],
        nib: true,
      },
      elastic: {
        _collapsed: true,
        squash: [0.18, 0, 0.4, 0.01],
        wobble: [0.45, 0.2, 1, 0.05],
      },
    },
    { persist: persistKey("morph") },
  );

  const controllerRef = useRef(controller);
  useEffect(() => {
    controllerRef.current = controller;
  }, [controller]);

  const style = controller.values.style as string;
  useEffect(() => {
    if (!handle) return;
    if (style === handle.engine.getMorph()) return;
    handle.engine.setMorph(style as never);
  }, [handle, style]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.morph = {
      speed: controller.values.speed as number,
      intensity: controller.values.intensity as number,
      breath: {
        scale: (controller.values.breath as { scale: number }).scale,
      },
      shapeshift: controller.values.shapeshift as {
        sproutDelay: number;
        backchannelSprout: number;
      },
      relay: controller.values.relay as {
        gatherMs: number;
        holdMs: number;
        releasePunch: number;
        landingBead: boolean;
      },
      inkwash: controller.values.inkwash as {
        stagger: number;
        stain: number;
        wetBloom: number;
        nib: boolean;
      },
      elastic: controller.values.elastic as { squash: number; wobble: number },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    handle,
    controller.values.speed,
    controller.values.intensity,
    controller.values.breath,
    controller.values.shapeshift,
    controller.values.relay,
    controller.values.inkwash,
    controller.values.elastic,
  ]);

  // Engine → DialKit sync, so the `M`/`Shift+M` hotkey (Stage.tsx) keeps this
  // select in lockstep, same as SequencePanel's preset/play sync.
  useEffect(() => {
    if (!handle) return;
    return handle.engine.onStatusChange((status) => {
      const c = controllerRef.current;
      if (status.morphId !== c.getValues().style) {
        c.setValue("style", status.morphId);
      }
    });
  }, [handle]);

  return null;
}

// Stream prototype (src/lib/voiceLab/stream.ts): batch (today) vs stream
// (A+B), steady pen vs bursts, and the arrival dials (ms after job start; the
// lab has two frames). Same idempotent select<->engine sync as MorphPanel, so
// the T / Shift+T hotkeys and __voiceLabEngine evals keep the selects in
// step. Everything applies from the next job (the engine latches at start).
function StreamPanel() {
  const handle = useEngine();
  const controller = useDialKitController(
    "Stream",
    {
      mode: {
        type: "select",
        options: [
          { value: "batch", label: "Batch (today)" },
          { value: "stream", label: "Stream (A+B)" },
        ],
        default: "stream",
      },
      pace: {
        type: "select",
        options: [
          { value: "steady", label: "Steady pen" },
          { value: "bursts", label: "Bursts" },
        ],
        default: "steady",
      },
      bufferMs: [1500, 0, 4000, 100],
      outlineMs: [1500, 0, 6000, 100],
      frame1Ms: [2000, 0, 9000, 100],
      frame2Ms: [5500, 0, 9000, 100],
    },
    { persist: persistKey("stream") },
  );

  const controllerRef = useRef(controller);
  useEffect(() => {
    controllerRef.current = controller;
  }, [controller]);

  const mode = controller.values.mode as string;
  const pace = controller.values.pace as string;
  useEffect(() => {
    if (!handle) return;
    if (mode === handle.engine.getStreamMode()) return;
    handle.engine.setStreamMode(mode as never);
  }, [handle, mode]);

  useEffect(() => {
    if (!handle) return;
    if (pace === handle.engine.getStreamPace()) return;
    handle.engine.setStreamPace(pace as never);
  }, [handle, pace]);

  const bufferMs = controller.values.bufferMs as number;
  const outlineMs = controller.values.outlineMs as number;
  const frame1Ms = controller.values.frame1Ms as number;
  const frame2Ms = controller.values.frame2Ms as number;
  useEffect(() => {
    if (!handle) return;
    const s = handle.engine.config.stream;
    s.bufferMs = bufferMs;
    s.outlineMs = outlineMs;
    s.arriveMs = [frame1Ms, frame2Ms];
  }, [handle, bufferMs, outlineMs, frame1Ms, frame2Ms]);

  useEffect(() => {
    if (!handle) return;
    return handle.engine.onStatusChange((status) => {
      const c = controllerRef.current;
      const live = c.getValues();
      if (status.streamMode !== live.mode) c.setValue("mode", status.streamMode);
      if (status.streamPace !== live.pace) c.setValue("pace", status.streamPace);
    });
  }, [handle]);

  return null;
}

// ---- Voice channel: idle / you-talking / riff-talking / silence / dead-mic
// `autoplay` used to live here; it's now the Sequence panel's `play` toggle
// above (spec §5) — everything else about manual voice-state selection is
// unchanged.
function VoicePanel() {
  const handle = useEngine();
  const raw = useDialKit(
    "Voice",
    {
      state: {
        type: "select",
        options: Object.entries(VOICE_STATE_LABELS).map(([value, label]) => ({
          value,
          label,
        })),
        default: "idle",
      },
    },
    { persist: persistKey("voice") },
  );
  const state = raw.state as string;

  useEffect(() => {
    if (!handle) return;
    handle.autoplay.stop();
    handle.engine.setVoiceState(state as never);
  }, [handle, state]);

  return null;
}

// ---- Job channel: independent of voice, drives cinders + landing frames.
function JobPanel() {
  const handle = useEngine();
  // DialKit captures `onAction` once at panel registration, so a plain
  // closure over `handle` would go stale from the first (handle === null)
  // render. Route through a ref that always holds the latest handle.
  const handleRef = useRef<EngineHandle | null>(handle);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle]);

  useDialKit(
    "Sketch job",
    {
      startSketch: { type: "action" },
      landNow: { type: "action" },
    },
    {
      onAction: (path: string) => {
        const h = handleRef.current;
        if (!h) return;
        if (path === "startSketch") h.engine.startSketch();
        if (path === "landNow") h.engine.landNow();
      },
      persist: persistKey("sketchJob"),
    },
  );
  return null;
}

function TogglesPanel() {
  const handle = useEngine();
  const raw = useDialKit(
    "Toggles",
    {
      origin: {
        type: "select",
        options: [
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ],
        default: "center",
      },
      centerCircle: false,
      onsetRings: false,
      cinders: true,
      showFrames: true,
      realMic: false,
      reducedMotion: false,
    },
    { persist: persistKey("toggles") },
  );

  const origin = raw.origin as "center" | "right";
  const centerCircle = raw.centerCircle as boolean;
  const onsetRings = raw.onsetRings as boolean;
  const cinders = raw.cinders as boolean;
  const showFrames = raw.showFrames as boolean;
  const realMic = raw.realMic as boolean;
  const reducedMotion = raw.reducedMotion as boolean;

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.originSide = origin;
  }, [handle, origin]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.centerCircleOn = centerCircle;
  }, [handle, centerCircle]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.onsetRingsOn = onsetRings;
  }, [handle, onsetRings]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.cindersOn = cinders;
  }, [handle, cinders]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.showFramesOn = showFrames;
  }, [handle, showFrames]);

  useEffect(() => {
    if (!handle) return;
    if (realMic) handle.engine.enableRealMic();
    else handle.engine.disableRealMic();
  }, [handle, realMic]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.setReducedMotion(reducedMotion);
  }, [handle, reducedMotion]);

  return null;
}

// Ambient glow: on/off plus every tuner Stage's buildGlow() consumes. Each
// default reproduces today's fixed look exactly.
function GlowPanel() {
  const handle = useEngine();
  const raw = useDialKit(
    "Glow",
    {
      ambientGlow: true,
      strength: [GLOW_DEFAULT_STRENGTH, 0, 3, 0.1],
      size: [GLOW_DEFAULT_SIZE, 0.5, 2, 0.05],
      height: [GLOW_DEFAULT_HEIGHT, 60, 130, 5],
      colorMix: [GLOW_DEFAULT_COLOR_MIX, 0, 1, 0.01],
      edgeSoftness: [GLOW_DEFAULT_EDGE_SOFTNESS, 0.3, 2, 0.1],
      // Fluid "shader" glow (ask 1) — new fields appended after the
      // existing classic ones so persisted values for those never move or
      // reset; DialKit reconciles missing keys against these defaults.
      // "fluid" keeps its stored value (relabeled "Wash" — voice-lab-
      // dotgrid-addendum.md §2) so a previously-saved selection stays valid;
      // "dots" and "both" are new options, "both" is the new default for
      // fresh installs only.
      style: {
        type: "select",
        options: [
          { value: "fluid", label: "Wash" },
          { value: "dots", label: "Dots" },
          { value: "both", label: "Both" },
          { value: "classic", label: "Classic" },
        ],
        default: "both",
      },
      fluidHumanColor: "#2F6FED",
      fluidRiffColor: "#F5C518",
      fluidMixSoftness: [0.6, 0, 1, 0.05],
      fluidFlowSpeed: [1.1, 0, 2, 0.05],
      fluidBlobScale: [1.25, 0.5, 2, 0.05],
      fluidBlobCount: [3, 1, 4, 1],
      // Ink-and-wash dials (addendum §4).
      fluidEdge: [0.7, 0, 1, 0.05],
      fluidGrain: [0.6, 0, 1, 0.05],
      fluidLayers: [3, 1, 3, 1],
      // Role-color dominance (addendum §3).
      roleColor: [0.75, 0, 1, 0.05],
      // Stroke-bleed (addendum §4 "ties to the drawing elements").
      bleedAmount: [0.6, 0, 1, 0.05],
    },
    { id: "glow", persist: persistKey("glow") },
  );

  const ambientGlow = raw.ambientGlow as boolean;
  const strength = raw.strength as number;
  const size = raw.size as number;
  const height = raw.height as number;
  const colorMix = raw.colorMix as number;
  const edgeSoftness = raw.edgeSoftness as number;
  const style = raw.style as "fluid" | "classic";
  const fluidHumanColor = raw.fluidHumanColor as string;
  const fluidRiffColor = raw.fluidRiffColor as string;
  const fluidMixSoftness = raw.fluidMixSoftness as number;
  const fluidFlowSpeed = raw.fluidFlowSpeed as number;
  const fluidBlobScale = raw.fluidBlobScale as number;
  const fluidBlobCount = raw.fluidBlobCount as number;
  const fluidEdge = raw.fluidEdge as number;
  const fluidGrain = raw.fluidGrain as number;
  const fluidLayers = raw.fluidLayers as number;
  const roleColor = raw.roleColor as number;
  const bleedAmount = raw.bleedAmount as number;

  useEffect(() => {
    if (!handle) return;
    handle.engine.setAmbientGlow(ambientGlow);
  }, [handle, ambientGlow]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.setGlowStrength(strength);
  }, [handle, strength]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.setGlowSize(size);
  }, [handle, size]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.setGlowHeight(height);
  }, [handle, height]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.setGlowColorMix(colorMix);
  }, [handle, colorMix]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.setGlowEdgeSoftness(edgeSoftness);
  }, [handle, edgeSoftness]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.glowStyle = style;
  }, [handle, style]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.glowHumanColor = fluidHumanColor;
  }, [handle, fluidHumanColor]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.glowRiffColor = fluidRiffColor;
  }, [handle, fluidRiffColor]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.glowMixSoftness = fluidMixSoftness;
  }, [handle, fluidMixSoftness]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.glowFlowSpeed = fluidFlowSpeed;
  }, [handle, fluidFlowSpeed]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.glowBlobScale = fluidBlobScale;
  }, [handle, fluidBlobScale]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.glowBlobCount = fluidBlobCount;
  }, [handle, fluidBlobCount]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.glowEdgeAmount = fluidEdge;
  }, [handle, fluidEdge]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.glowGrainAmount = fluidGrain;
  }, [handle, fluidGrain]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.glowLayers = fluidLayers;
  }, [handle, fluidLayers]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.glowRoleColor = roleColor;
  }, [handle, roleColor]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.glowBleedAmount = bleedAmount;
  }, [handle, bleedAmount]);

  return null;
}

// Dot-grid sketchbook paper (voice-lab-dotgrid-addendum.md §1).
function PaperPanel() {
  const handle = useEngine();
  const raw = useDialKit(
    "Paper",
    {
      paperOn: true,
      pitch: [16, 12, 24, 1],
      dotSize: [0.9, 0.6, 1.6, 0.05],
      baseOpacity: [0.5, 0.1, 1, 0.05],
    },
    { persist: persistKey("paper") },
  );

  const paperOn = raw.paperOn as boolean;
  const pitch = raw.pitch as number;
  const dotSize = raw.dotSize as number;
  const baseOpacity = raw.baseOpacity as number;

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.paperOn = paperOn;
  }, [handle, paperOn]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.setPaperParams(pitch, dotSize, baseOpacity);
  }, [handle, pitch, dotSize, baseOpacity]);

  return null;
}

// Disc squash & stretch (ask 4) — target aspect from role presence, reached
// via an overshooting spring; dials only, the spring itself lives in the
// engine (computeDiscSquash).
function DiscPanel() {
  const handle = useEngine();
  const raw = useDialKit(
    "Disc squash & stretch",
    {
      stretchAmount: [0.35, 0, 1, 0.05],
      squishBounce: [0.35, 0, 0.9, 0.05],
      wobble: [0.15, 0, 1, 0.05],
    },
    { persist: persistKey("disc") },
  );

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.discStretchAmount = raw.stretchAmount as number;
  }, [handle, raw.stretchAmount]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.discSquishBounce = raw.squishBounce as number;
  }, [handle, raw.squishBounce]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.discWobble = raw.wobble as number;
  }, [handle, raw.wobble]);

  return null;
}

// Per-role tuners for whichever mark that role currently has assigned.
// Keyed by role + markId so each role keeps independent values even when
// both roles pick the same mark.
function RoleMarkTunerPanel({ role, markId }: { role: Role; markId: string }) {
  const handle = useEngine();
  const mark = MARKS.find((m) => m.id === markId) ?? MARKS[0];
  const config = Object.fromEntries(
    mark.params.map((p) => [
      p.key,
      [p.def, p.min, p.max, p.step] as [number, number, number, number],
    ]),
  );
  const roleLabel = role === "human" ? "Human" : "Riff";
  const raw = useDialKit(
    `${roleLabel}: ${pad(mark.num)} — ${mark.name}`,
    config,
    {
      id: `${role}-mark-${mark.id}`,
      persist: persistKey(`mark.${role}.${mark.id}`),
    },
  );

  useEffect(() => {
    if (!handle) return;
    for (const p of mark.params) {
      handle.engine.config.markConfigsByRole[role][mark.id][p.key] = raw[
        p.key
      ] as number;
    }
  }, [handle, role, mark, raw]);

  return null;
}

// Speaker -> mark assignment: each role picks any mark from the shared
// library, plus its own color. The mark's own tuners render underneath.
function RoleVoicePanel({
  role,
  title,
  defaultMarkId,
  defaultColor,
}: {
  role: Role;
  title: string;
  defaultMarkId: string;
  defaultColor: string;
}) {
  const handle = useEngine();
  const raw = useDialKit(
    title,
    {
      mark: {
        type: "select",
        options: MARKS.map((m) => ({
          value: m.id,
          label: `${pad(m.num)} — ${m.name}`,
        })),
        default: defaultMarkId,
      },
      color: defaultColor,
    },
    { id: `${role}-voice`, persist: persistKey(`voiceRole.${role}`) },
  );
  const markId = raw.mark as string;
  const color = raw.color as string;

  useEffect(() => {
    if (!handle) return;
    if (role === "human") handle.engine.config.humanMarkId = markId;
    else handle.engine.config.riffMarkId = markId;
  }, [handle, role, markId]);

  useEffect(() => {
    if (!handle) return;
    if (role === "human") handle.engine.config.humanColor = color;
    else handle.engine.config.riffColor = color;
  }, [handle, role, color]);

  return <RoleMarkTunerPanel role={role} markId={markId} />;
}

function CinderPanel() {
  const handle = useEngine();
  const raw = useDialKit(
    "Cinders & land",
    {
      cinderCap: [800, 100, 800, 25],
      windStrength: [3, 0, 3, 0.1],
      burstSize: [120, 0, 120, 5],
      landDurationMs: [600, 400, 1800, 50],
      tipSparkRate: [1, 0, 1, 0.05],
    },
    { persist: persistKey("cinders") },
  );

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.cinderConfig = {
      cinderCap: raw.cinderCap as number,
      windStrength: raw.windStrength as number,
      burstSize: raw.burstSize as number,
      landDurationMs: raw.landDurationMs as number,
      tipSparkRate: raw.tipSparkRate as number,
    };
  }, [handle, raw]);

  return null;
}

// Sparks-build-the-sketch dials (build-plan.md §4, dotgrid addendum §3) —
// after the Cinder panel, since a build's launch points recruit from the
// same drift cinders that panel tunes.
function BuildPanel() {
  const handle = useEngine();
  const raw = useDialKit(
    "Build",
    {
      flightSpeed: [1.3, 0.5, 2, 0.05],
      arc: [0.27, 0, 0.5, 0.01],
      densityFrame: [3.6, 0.5, 6, 0.1],
      densityBlocks: [3.8, 0.5, 6, 0.1],
      densityDetails: [3.9, 0.5, 6, 0.1],
      tierGapMs: [180, -200, 300, 10],
      speculativeFrame: {
        type: "select",
        options: [
          { value: "off", label: "Off" },
          { value: "construction", label: "Construction" },
          { value: "full", label: "Full ink" },
        ],
        default: "construction",
      },
      guideDots: {
        type: "select",
        options: [
          { value: "off", label: "Off" },
          { value: "dots", label: "Lit dots" },
          { value: "dotsLines", label: "Lit dots + faint lines" },
        ],
        default: "dots",
      },
      arrival: {
        type: "select",
        options: [
          { value: "dotsLead", label: "Dots lead" },
          { value: "comet", label: "Comet" },
        ],
        default: "dotsLead",
      },
      snapToGrid: true,
      dotPop: [0.8, 0, 1, 0.05],
      waitEmberRate: [18, 4, 24, 1],
    },
    { persist: persistKey("build") },
  );

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.buildConfig = {
      flightSpeed: raw.flightSpeed as number,
      arc: raw.arc as number,
      densityFrame: raw.densityFrame as number,
      densityBlocks: raw.densityBlocks as number,
      densityDetails: raw.densityDetails as number,
      tierGapMs: raw.tierGapMs as number,
      speculativeFrame: raw.speculativeFrame as "off" | "construction" | "full",
      guideDots: raw.guideDots as "off" | "dots" | "dotsLines",
      arrival: raw.arrival as "dotsLead" | "comet",
      snapToGrid: raw.snapToGrid as boolean,
      dotPop: raw.dotPop as number,
      waitEmberRate: raw.waitEmberRate as number,
    };
  }, [handle, raw]);

  return null;
}

export default function VoiceLabPanels() {
  return (
    <>
      <SequencePanel />
      <MorphPanel />
      <StreamPanel />
      <VoicePanel />
      <JobPanel />
      <TogglesPanel />
      <PaperPanel />
      <GlowPanel />
      <RoleVoicePanel
        role="human"
        title="Human voice"
        defaultMarkId="amoeba"
        defaultColor={INK}
      />
      <RoleVoicePanel
        role="riff"
        title="Riff voice"
        defaultMarkId="burst"
        defaultColor={RIFF_GREEN}
      />
      <CinderPanel />
      <BuildPanel />
      <DiscPanel />
    </>
  );
}
