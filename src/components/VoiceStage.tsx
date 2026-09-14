"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { VoiceLabEngine } from "@/lib/voiceLab/engine";
import { W, H } from "@/lib/voiceLab/constants";
import { FLUID_W, FLUID_H } from "@/lib/voiceLab/fluidGlow";
import { buildGlow } from "@/lib/voiceLab/glowMask";
import { TUNED } from "@/lib/voiceLab/tuning";
import {
  MARKS_ABOVE,
  MARKS_BELOW,
  MARKS_GAP,
  stageLayout,
} from "@/lib/voiceStage";
import type { VoiceState } from "./VoiceBar";

// The bar's chat-open slide (VoiceBar.tsx, 260ms) plus a frame of margin.
const SLIDE_FOLLOW_MS = 320;

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

// The real app's voice layer: the lab engine in host mode. The engine runs
// in the lab's fixed 1440x900 stage, anchored so its mark origin sits over
// the bar and scaled to the viewport width. Two layers, neither taking
// pointer events: the wash is portaled into page.tsx's slot under the
// canvas content (React Flow's dot grid paints over it), and the marks sit
// above the sketch, below the bar and caption. Everything per-frame happens
// inside the engine; React only forwards changes.
export function VoiceStage({
  getInputData,
  getOutputData,
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
  const followRef = useRef<(ms: number) => void>(() => {});

  // Latest session inputs, read inside the engine frame.
  const inputs = useRef({ getInputData, getOutputData });
  const onCaptionLiftRef = useRef(onCaptionLift);
  useEffect(() => {
    inputs.current = { getInputData, getOutputData };
    onCaptionLiftRef.current = onCaptionLift;
  });

  const [washSlot, setWashSlot] = useState<HTMLElement | null>(null);

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
    engine.attachGlowFluid(wash);
    engine.setLevelSource("human", () => inputs.current.getInputData());
    engine.setLevelSource("riff", () => inputs.current.getOutputData());

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

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      if (followId !== null) cancelAnimationFrame(followId);
      followRef.current = () => {};
      engine.destroy();
    };
  }, [washSlot, barRef]);

  // The bar slides when the chat panel opens or closes.
  useEffect(() => {
    followRef.current(SLIDE_FOLLOW_MS);
  }, [rightInset]);

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
    </>
  );
}
