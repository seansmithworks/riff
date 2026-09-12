"use client";

import { useEffect, useRef, useState } from "react";
import { VoiceLabEngine, type EngineStatus } from "@/lib/voiceLab/engine";
import { Autoplay } from "@/lib/voiceLab/autoplay";
import { W, H } from "@/lib/voiceLab/constants";
import { EngineContext, type EngineHandle } from "./EngineContext";
import { VOICE_STATES, VOICE_STATE_LABELS } from "@/lib/voiceLab/types";

// Base alphas at strength 1. The strength dial (Toggles panel) multiplies
// these — not the layer's CSS opacity, which caps at 1 and can't brighten
// past the mask's attenuation near the disc — so alpha is clamped to 1 here.
const GLOW_CYAN_ALPHA = 0.35;
const GLOW_GREEN_ALPHA = 0.28;

function glowAlpha(base: number, strength: number) {
  return Math.max(0, Math.min(1, base * strength));
}

function buildGlowCenter(strength: number) {
  const cyan = glowAlpha(GLOW_CYAN_ALPHA, strength);
  const green = glowAlpha(GLOW_GREEN_ALPHA, strength);
  return `radial-gradient(ellipse 55% 60% at 50% 100%, rgba(0,245,241,${cyan}), transparent 55%), radial-gradient(ellipse 45% 50% at 60% 100%, rgba(183,255,0,${green}), transparent 60%)`;
}

function buildGlowRight(strength: number) {
  const cyan = glowAlpha(GLOW_CYAN_ALPHA, strength);
  const green = glowAlpha(GLOW_GREEN_ALPHA, strength);
  return `radial-gradient(ellipse 40% 55% at 88% 100%, rgba(0,245,241,${cyan}), transparent 55%), radial-gradient(ellipse 32% 45% at 94% 100%, rgba(183,255,0,${green}), transparent 60%)`;
}

// A mask, not the gradient's own geometry, is what guarantees the glow
// clears every edge — retuning GLOW_CENTER/GLOW_RIGHT's radii or stops can
// never reintroduce the hard line, because the mask's alpha is 0 at each
// edge by construction (transparent at 0%) independent of what the
// background-image underneath does. Vertical fade clears the bottom (and
// top) over a wide band; horizontal fade clears the sides over a narrow one.
const GLOW_MASK =
  "linear-gradient(to top, transparent 0%, black 25%, black 90%, transparent 100%), linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%)";

export default function Stage({ children }: { children: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<VoiceLabEngine | null>(null);
  const [handle, setHandle] = useState<EngineHandle | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  // Displayed (contain-fit) CSS size — the canvas element's own width/height,
  // not the wrapper. Recomputed on every resize; the engine's drawing space
  // stays the logical 1440x900 regardless of these pixel values.
  const [dispSize, setDispSize] = useState({ w: W, h: H });

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new VoiceLabEngine(canvasRef.current);
    engineRef.current = engine;
    const autoplay = new Autoplay(engine);
    engine.onStatusChange(setStatus);
    engine.scheduleLoop();
    const h: EngineHandle = { engine, autoplay };
    setHandle(h);

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;
      const n = Number(e.key);
      if (n >= 1 && n <= 5) {
        autoplay.stop();
        engine.setVoiceState(VOICE_STATES[n - 1]);
      } else if (e.key.toLowerCase() === "s") {
        autoplay.stop();
        engine.startSketch();
      } else if (e.key.toLowerCase() === "l") {
        autoplay.stop();
        engine.landNow();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      autoplay.stop();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Contain-fit the logical 1440x900 stage inside whatever space the
  // available stage area has, on every resize, and push the resulting CSS
  // pixel size to the engine so it can size the canvas backing store.
  useEffect(() => {
    if (!outerRef.current) return;
    const outer = outerRef.current;
    const fit = () => {
      const rect = outer.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scale = Math.min(rect.width / W, rect.height / H);
      const w = Math.max(1, Math.floor(W * scale));
      const h = Math.max(1, Math.floor(H * scale));
      setDispSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      engineRef.current?.resize(w, h);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(outer);
    fit();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!glowRef.current || !status) return;
    glowRef.current.style.background =
      status.originSide === "center"
        ? buildGlowCenter(status.glowStrength)
        : buildGlowRight(status.glowStrength);
  }, [status?.originSide, status?.glowStrength]);

  return (
    <EngineContext.Provider value={handle}>
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
        <div
          ref={outerRef}
          className="relative flex min-h-0 w-full flex-1 items-center justify-center"
        >
          {/* The card hugs the fitted canvas exactly (no letterboxing), so
              its bg/border/shadow bounds match the glow's bounds and there's
              no hard edge where the glow gradient would otherwise end mid-card. */}
          <div
            className="relative overflow-hidden rounded-xl border border-[#d4d4d8] bg-[#f4f4f5] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.06)]"
            style={{ width: dispSize.w, height: dispSize.h }}
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0 block"
              style={{ width: dispSize.w, height: dispSize.h }}
            />
            <div
              ref={glowRef}
              className="pointer-events-none absolute inset-0 transition-opacity duration-200"
              style={{
                opacity:
                  (status?.ambientGlowOn === false ? 0 : 1) *
                  (status?.reducedMotion ? 0.4 : 1),
                maskImage: GLOW_MASK,
                WebkitMaskImage: GLOW_MASK,
                maskComposite: "intersect",
                WebkitMaskComposite: "source-in",
              }}
            />
          </div>
        </div>
        <div className="flex min-h-[44px] shrink-0 items-center rounded-lg border border-[#e4e4e7] bg-white px-2.5 py-2 font-mono text-[11px] text-[#71717a]">
          {status
            ? `voice: ${VOICE_STATE_LABELS[status.voiceState]} — job: ${status.jobState} — mark: ${status.markName} — origin: ${status.originSide}${status.realMic ? " — real mic" : ""}${status.reducedMotion ? " — reduced motion" : ""}`
            : "booting…"}
        </div>
        {children}
      </div>
    </EngineContext.Provider>
  );
}
