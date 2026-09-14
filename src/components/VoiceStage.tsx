"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { VoiceLabEngine, type LevelBuffer } from "@/lib/voiceLab/engine";
import { W, H } from "@/lib/voiceLab/constants";
import { FLUID_W, FLUID_H } from "@/lib/voiceLab/fluidGlow";
import { buildGlow } from "@/lib/voiceLab/glowMask";
import {
  REDUCED_MOTION_PRESET,
  SEQUENCE_BY_ID,
} from "@/lib/voiceLab/sequences";
import { TUNED } from "@/lib/voiceLab/tuning";
import type { Role } from "@/lib/voiceLab/types";
import {
  MARKS_ABOVE,
  MARKS_BELOW,
  MARKS_GAP,
  engineVoiceState,
  inputLevel,
  stageLayout,
  stepTalkGate,
  type TalkGate,
} from "@/lib/voiceStage";
import type { VoiceState } from "./VoiceBar";
import { VoiceDials } from "./VoiceDials";
import {
  createDevState,
  feedFrame,
  installDevTools,
  readVoice,
  updateReadout,
} from "./voiceStageDev";

// Every dev tool below sits behind this: `?dials=1`, the window hooks, feeds
// and the readout never run in a production build.
const DEV = process.env.NODE_ENV !== "production";

// The bar's chat-open slide (VoiceBar.tsx, 260ms) plus a frame of margin.
const SLIDE_FOLLOW_MS = 320;
// How often the listening gate samples the input level.
const GATE_SAMPLE_MS = 50;

// The lab's edge mask, so the wash fades out before the stage's bounds.
const WASH_MASK = buildGlow(
  TUNED.toggles.origin === "center" ? "center" : "right",
  {
    strength: TUNED.glow.strength,
    size: TUNED.glow.size,
    height: TUNED.glow.height,
    colorMix: TUNED.glow.colorMix,
    edgeSoftness: TUNED.glow.edgeSoftness,
  },
).mask;

// The real app's voice layer: the lab engine in host mode, driven by the
// live ElevenLabs session. The engine runs in the lab's fixed 1440x900 stage,
// anchored so its mark origin sits over the bar and scaled to the viewport
// width. Two layers, neither taking pointer events: the wash is portaled
// into page.tsx's slot under the canvas content (React Flow's dot grid
// paints over it), and the marks sit above the sketch, below the bar and
// caption. Everything per-frame happens inside the engine; React only
// forwards state changes.
export function VoiceStage({
  voiceState,
  fixture,
  getInputData,
  getOutputData,
  userTurnCount,
  barRef,
  rightInset,
  onCaptionLift,
}: {
  voiceState: VoiceState;
  // A dev ?voiceState= fixture: no session, synthetic levels.
  fixture: boolean;
  getInputData: () => Uint8Array;
  getOutputData: () => Uint8Array;
  userTurnCount: number;
  barRef: RefObject<HTMLDivElement | null>;
  rightInset: number;
  onCaptionLift: (px: number) => void;
}) {
  const marksStageRef = useRef<HTMLDivElement | null>(null);
  const marksRef = useRef<HTMLCanvasElement | null>(null);
  const washStageRef = useRef<HTMLDivElement | null>(null);
  const washRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<VoiceLabEngine | null>(null);
  const followRef = useRef<(ms: number) => void>(() => {});
  const gateRef = useRef<TalkGate>({ talking: false, lastAboveAt: 0 });
  const devRef = useRef(createDevState());

  // Latest session inputs, read inside the engine frame and the gate timer.
  const inputs = useRef({ voiceState, getInputData, getOutputData });
  const onCaptionLiftRef = useRef(onCaptionLift);
  useEffect(() => {
    inputs.current = { voiceState, getInputData, getOutputData };
    onCaptionLiftRef.current = onCaptionLift;
  });

  const [washSlot, setWashSlot] = useState<HTMLElement | null>(null);
  const [dialsEngine, setDialsEngine] = useState<VoiceLabEngine | null>(null);

  function humanData(): LevelBuffer | null {
    return (
      (DEV && feedFrame(devRef.current, "human")) ||
      inputs.current.getInputData()
    );
  }

  function riffData(): LevelBuffer | null {
    const fed = DEV && feedFrame(devRef.current, "riff");
    if (fed) return fed;
    // Riff's level follows the session's speaking mode, not the audio: the
    // SDK fades interrupted speech out over 2s, and the mark shouldn't.
    return inputs.current.voiceState === "speaking"
      ? inputs.current.getOutputData()
      : null;
  }

  function tap(role: Role, buf: LevelBuffer | null): LevelBuffer | null {
    const engine = engineRef.current;
    if (DEV && engine)
      updateReadout(
        devRef.current,
        role,
        buf,
        engine.config.levelCalibration[role],
      );
    return buf;
  }

  useEffect(() => {
    setWashSlot(document.getElementById("riff-voice-wash-slot"));
  }, []);

  useEffect(() => {
    const marks = marksRef.current;
    const wash = washRef.current;
    const marksStage = marksStageRef.current;
    const washStage = washStageRef.current;
    const bar = barRef.current;
    if (!washSlot || !marks || !wash || !marksStage || !washStage || !bar)
      return;

    const engine = new VoiceLabEngine(marks, undefined, { host: true });
    engineRef.current = engine;
    engine.attachGlowFluid(wash);
    engine.setLevelSource("human", () => tap("human", humanData()));
    engine.setLevelSource("riff", () => tap("riff", riffData()));

    // The anchor is read on resize and during the chat slide only, never
    // blind every frame; the stages move by transform.
    let scale = 0;
    const place = () => {
      const r = bar.getBoundingClientRect();
      if (r.width === 0) return;
      const layout = stageLayout({
        bar: r,
        viewportW: window.innerWidth,
        stageW: W,
        stageH: H,
        origin: engine.getOrigin(),
        marksBelow: MARKS_BELOW,
        marksAbove: MARKS_ABOVE,
        gap: MARKS_GAP,
      });
      if (layout.scale !== scale) {
        scale = layout.scale;
        for (const el of [marksStage, washStage]) {
          el.style.width = `${layout.width}px`;
          el.style.height = `${layout.height}px`;
        }
        engine.resize(layout.width, layout.height);
        onCaptionLiftRef.current(layout.captionLift);
      }
      const slot = washSlot.getBoundingClientRect();
      marksStage.style.transform = `translate3d(${layout.left}px, ${layout.top}px, 0)`;
      washStage.style.transform = `translate3d(${layout.left - slot.left}px, ${layout.top - slot.top}px, 0)`;
    };

    let followId: number | null = null;
    followRef.current = (ms) => {
      const until = performance.now() + ms;
      if (followId !== null) cancelAnimationFrame(followId);
      const step = (t: number) => {
        place();
        followId = t < until ? requestAnimationFrame(step) : null;
      };
      followId = requestAnimationFrame(step);
    };

    place();
    const ro = new ResizeObserver(place);
    ro.observe(bar);
    window.addEventListener("resize", place);
    engine.scheduleLoop();

    const removeDevTools = DEV
      ? installDevTools(engine, devRef.current, gateRef.current)
      : () => {};
    if (DEV && new URLSearchParams(window.location.search).get("dials") === "1")
      setDialsEngine(engine);

    return () => {
      removeDevTools();
      ro.disconnect();
      window.removeEventListener("resize", place);
      if (followId !== null) cancelAnimationFrame(followId);
      followRef.current = () => {};
      engine.destroy();
      engineRef.current = null;
      setDialsEngine(null);
    };
    // humanData/riffData/tap only read refs, so the first closures stay current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [washSlot, barRef]);

  // The bar slides when the chat panel opens or closes.
  useEffect(() => {
    followRef.current(SLIDE_FOLLOW_MS);
  }, [rightInset]);

  // Session state -> engine state. While listening, a timer gates Amoeba on
  // the input level; every other state sets the engine once.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const gate = gateRef.current;
    const apply = () =>
      engine.setVoiceState(
        engineVoiceState(voiceState, { fixture, talking: gate.talking }),
      );
    const gated =
      !fixture && (voiceState === "listening" || voiceState === "silence");
    if (!gated) {
      gate.talking = false;
      apply();
      return;
    }
    const id = setInterval(() => {
      stepTalkGate(
        gate,
        inputLevel(humanData()),
        performance.now(),
        TUNED.listening,
      );
      apply();
    }, GATE_SAMPLE_MS);
    apply();
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState, fixture, washSlot]);

  // The yield squash fires on the server's end of the user's turn (a new
  // user transcript), not on every pause in speech.
  const turnsRef = useRef(userTurnCount);
  useEffect(() => {
    if (userTurnCount === turnsRef.current) return;
    turnsRef.current = userTurnCount;
    const engine = engineRef.current;
    if (!engine) return;
    const preset = engine.reducedMotionActive()
      ? REDUCED_MOTION_PRESET
      : SEQUENCE_BY_ID[engine.getActiveSequenceId()];
    engine.triggerAnticipation(
      preset.anticipation.depth,
      preset.anticipation.ms,
    );
  }, [userTurnCount]);

  return (
    <>
      <div
        ref={marksStageRef}
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 z-10"
      >
        <canvas
          ref={marksRef}
          id="riff-voice-marks"
          className="absolute inset-0 block h-full w-full"
        />
      </div>
      {washSlot &&
        createPortal(
          <div ref={washStageRef} className="absolute top-0 left-0">
            {/* Mask wrapper: never animates; the engine writes only the
                canvas's opacity and transform. */}
            <div
              className="absolute inset-0"
              style={{
                maskImage: WASH_MASK,
                WebkitMaskImage: WASH_MASK,
                maskComposite: "intersect",
                WebkitMaskComposite: "source-in",
              }}
            >
              <canvas
                ref={washRef}
                id="riff-voice-wash"
                width={FLUID_W}
                height={FLUID_H}
                className="absolute inset-0 h-full w-full"
                style={{ opacity: 0 }}
              />
            </div>
          </div>,
          washSlot,
        )}
      {DEV && dialsEngine && (
        <VoiceDials
          engine={dialsEngine}
          read={() => readVoice(dialsEngine, devRef.current, gateRef.current)}
        />
      )}
    </>
  );
}
