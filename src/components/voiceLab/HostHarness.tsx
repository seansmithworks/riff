"use client";

import { useEffect, useRef } from "react";
import { VoiceLabEngine, type LevelBuffer } from "@/lib/voiceLab/engine";
import { W, H } from "@/lib/voiceLab/constants";
import { FLUID_W, FLUID_H } from "@/lib/voiceLab/fluidGlow";
import type { Role } from "@/lib/voiceLab/types";

// Dev-only host-mode harness (/voice-lab/host). Stacks the engine's two
// layers the way a real app would: the wash canvas under a stand-in sketch
// card, the transparent marks canvas above it, over a CSS dot lattice
// standing in for React Flow's <Background>. Drive it from the console:
// __riffHostEngine.setVoiceState("riff-talking"),
// __riffLabLevel("riff", new Uint8Array(1024).fill(200)).
export default function HostHarness() {
  const marksRef = useRef<HTMLCanvasElement | null>(null);
  const washRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const marks = marksRef.current;
    const wash = washRef.current;
    if (!marks || !wash) return;
    const engine = new VoiceLabEngine(marks, undefined, { host: true });
    engine.attachGlowFluid(wash);
    engine.resize(W, H);
    engine.scheduleLoop();
    const w = window as unknown as {
      __riffHostEngine?: VoiceLabEngine;
      __riffLabLevel?: (role: Role, data: LevelBuffer | null) => void;
    };
    w.__riffHostEngine = engine;
    w.__riffLabLevel = (role, data) =>
      engine.setLevelSource(role, data ? () => data : null);
    return () => {
      engine.destroy();
      delete w.__riffHostEngine;
      delete w.__riffLabLevel;
    };
  }, []);

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: W,
        height: H,
        backgroundColor: "#f4f4f5",
        backgroundImage:
          "radial-gradient(rgba(113,113,122,0.45) 1px, transparent 1px)",
        backgroundSize: "12px 12px",
      }}
    >
      <canvas
        ref={washRef}
        id="riff-wash-layer"
        width={FLUID_W}
        height={FLUID_H}
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      />
      <div
        id="riff-sketch-stand-in"
        className="absolute z-10 rounded-lg border border-[#d4d4d8] bg-white"
        style={{ left: 520, top: 560, width: 400, height: 200 }}
      />
      <canvas
        ref={marksRef}
        id="riff-marks-layer"
        className="pointer-events-none absolute inset-0 z-20"
        style={{ width: W, height: H }}
      />
    </div>
  );
}
