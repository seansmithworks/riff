"use client";

import { useEffect, useRef, useState } from "react";
import { useDialKit } from "dialkit";
import { useEngine, type EngineHandle } from "./EngineContext";
import { MARKS } from "@/lib/voiceLab/marks";
import { VOICE_STATE_LABELS } from "@/lib/voiceLab/types";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// ---- Voice channel: idle / you-talking / riff-talking / silence / dead-mic
function VoicePanel() {
  const handle = useEngine();
  const raw = useDialKit("Voice", {
    state: {
      type: "select",
      options: Object.entries(VOICE_STATE_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
      default: "idle",
    },
    autoplay: false,
  });
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
    },
  );
  return null;
}

function TogglesPanel({
  onMarkChange,
}: {
  onMarkChange: (id: string) => void;
}) {
  const handle = useEngine();
  const raw = useDialKit("Toggles", {
    mark: {
      type: "select",
      options: MARKS.map((m) => ({
        value: m.id,
        label: `${pad(m.num)} — ${m.name}`,
      })),
      default: "burst",
    },
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
    colorMode: {
      type: "select",
      options: [
        { value: "ink", label: "Ink" },
        { value: "green", label: "Green" },
      ],
      default: "ink",
    },
    ambientGlow: true,
    cinders: true,
    showFrames: true,
    realMic: false,
    reducedMotion: false,
  });

  const mark = raw.mark as string;
  const origin = raw.origin as "center" | "right";
  const centerCircle = raw.centerCircle as boolean;
  const onsetRings = raw.onsetRings as boolean;
  const colorMode = raw.colorMode as "ink" | "green";
  const ambientGlow = raw.ambientGlow as boolean;
  const cinders = raw.cinders as boolean;
  const showFrames = raw.showFrames as boolean;
  const realMic = raw.realMic as boolean;
  const reducedMotion = raw.reducedMotion as boolean;

  useEffect(() => {
    onMarkChange(mark);
    if (handle) handle.engine.config.currentMarkId = mark;
  }, [mark, handle, onMarkChange]);

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
    handle.engine.config.colorMode = colorMode;
  }, [handle, colorMode]);

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.ambientGlowOn = ambientGlow;
  }, [handle, ambientGlow]);

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

function SelectedMarkPanel({ markId }: { markId: string }) {
  const handle = useEngine();
  const mark = MARKS.find((m) => m.id === markId) ?? MARKS[0];
  const config = Object.fromEntries(
    mark.params.map((p) => [
      p.key,
      [p.def, p.min, p.max, p.step] as [number, number, number, number],
    ]),
  );
  const raw = useDialKit(`${pad(mark.num)} — ${mark.name}`, config, {
    id: `mark-${mark.id}`,
  });

  useEffect(() => {
    if (!handle) return;
    for (const p of mark.params) {
      handle.engine.config.markConfigs[mark.id][p.key] = raw[p.key] as number;
    }
  }, [handle, mark, raw]);

  return null;
}

function RiffPanel() {
  const handle = useEngine();
  const raw = useDialKit("Riff voice", {
    arcCount: [3, 1, 5, 1],
    baseRadius: [34, 20, 70, 1],
    radiusStep: [20, 0, 40, 1],
    amplitude: [5, 0, 20, 1],
    thickness: [1.5, 0.5, 3, 0.1],
  });

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.riffConfig = {
      arcCount: raw.arcCount as number,
      baseRadius: raw.baseRadius as number,
      radiusStep: raw.radiusStep as number,
      amplitude: raw.amplitude as number,
      thickness: raw.thickness as number,
    };
  }, [handle, raw]);

  return null;
}

function CinderPanel() {
  const handle = useEngine();
  const raw = useDialKit("Cinders & land", {
    cinderCap: [500, 100, 800, 25],
    windStrength: [1.0, 0, 3, 0.1],
    burstSize: [40, 0, 120, 5],
    landDurationMs: [900, 400, 1800, 50],
  });

  useEffect(() => {
    if (!handle) return;
    handle.engine.config.cinderConfig = {
      cinderCap: raw.cinderCap as number,
      windStrength: raw.windStrength as number,
      burstSize: raw.burstSize as number,
      landDurationMs: raw.landDurationMs as number,
    };
  }, [handle, raw]);

  return null;
}

export default function VoiceLabPanels() {
  const [markId, setMarkId] = useState("burst");
  return (
    <>
      <VoicePanel />
      <JobPanel />
      <TogglesPanel onMarkChange={setMarkId} />
      <SelectedMarkPanel markId={markId} />
      <RiffPanel />
      <CinderPanel />
    </>
  );
}
