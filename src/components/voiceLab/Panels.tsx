"use client";

import { useEffect, useRef } from "react";
import { useDialKit } from "dialkit";
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

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Every panel persists to localStorage under its own stable key, and pushes
// its (possibly restored) values into the engine on first mount via the
// same effects that handle later changes — there's no second code path.
function persistKey(key: string) {
  return { key: `voiceLab.${key}`, storage: "localStorage" as const };
}

// ---- Voice channel: idle / you-talking / riff-talking / silence / dead-mic
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
      autoplay: false,
    },
    { persist: persistKey("voice") },
  );
  const state = raw.state as string;
  const autoplay = raw.autoplay as boolean;

  useEffect(() => {
    if (!handle) return;
    handle.autoplay.stop();
    handle.engine.setVoiceState(state as never);
  }, [handle, state]);

  useEffect(() => {
    if (!handle) return;
    if (autoplay) handle.autoplay.start();
    else handle.autoplay.stop();
  }, [handle, autoplay]);

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
      centerCircle: true,
      onsetRings: true,
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
    },
    { id: "glow", persist: persistKey("glow") },
  );

  const ambientGlow = raw.ambientGlow as boolean;
  const strength = raw.strength as number;
  const size = raw.size as number;
  const height = raw.height as number;
  const colorMix = raw.colorMix as number;
  const edgeSoftness = raw.edgeSoftness as number;

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
      cinderCap: [500, 100, 800, 25],
      windStrength: [1.0, 0, 3, 0.1],
      burstSize: [40, 0, 120, 5],
      landDurationMs: [900, 400, 1800, 50],
      tipSparkRate: [0.8, 0, 1, 0.05],
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

export default function VoiceLabPanels() {
  return (
    <>
      <VoicePanel />
      <JobPanel />
      <TogglesPanel />
      <GlowPanel />
      <RoleVoicePanel
        role="human"
        title="Human voice"
        defaultMarkId="ripple"
        defaultColor={INK}
      />
      <RoleVoicePanel
        role="riff"
        title="Riff voice"
        defaultMarkId="burst"
        defaultColor={RIFF_GREEN}
      />
      <CinderPanel />
    </>
  );
}
