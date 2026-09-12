"use client";

import { useEffect, useRef, useState } from "react";
import { VoiceLabEngine, type EngineStatus } from "@/lib/voiceLab/engine";
import { Autoplay } from "@/lib/voiceLab/autoplay";
import { W, H, GLOW_TOTAL_BASE } from "@/lib/voiceLab/constants";
import { EngineContext, type EngineHandle } from "./EngineContext";
import { VOICE_STATES, VOICE_STATE_LABELS } from "@/lib/voiceLab/types";

type GlowOrigin = "center" | "right";

type GlowParams = {
  strength: number;
  size: number;
  height: number;
  colorMix: number;
  edgeSoftness: number;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// Ellipse shapes at size 1 — unaffected by strength/height/colorMix/softness.
const GLOW_SHAPES: Record<
  GlowOrigin,
  { x: number; rx: number; ry: number; cut: number; hue: "cyan" | "green" }[]
> = {
  center: [
    { x: 50, rx: 55, ry: 60, cut: 55, hue: "cyan" },
    { x: 60, rx: 45, ry: 50, cut: 60, hue: "green" },
  ],
  right: [
    { x: 88, rx: 40, ry: 55, cut: 55, hue: "cyan" },
    { x: 94, rx: 32, ry: 45, cut: 60, hue: "green" },
  ],
};

// Single source of truth for the glow's background gradients AND its
// clipping mask — both are a function of the same param set, so they can
// never fork into a second copy that drifts out of sync.
//
// The mask, not the gradients' own geometry, is what guarantees the glow
// clears every edge: its bands always land on an explicit 0%/100%
// transparent stop, independent of size/height/strength, so retuning those
// can never reintroduce a hard line.
function buildGlow(origin: GlowOrigin, p: GlowParams) {
  const cyanAlpha = clamp(GLOW_TOTAL_BASE * p.colorMix * p.strength, 0, 1);
  const greenAlpha = clamp(
    GLOW_TOTAL_BASE * (1 - p.colorMix) * p.strength,
    0,
    1,
  );
  const hueColor = {
    cyan: `rgba(0,245,241,${cyanAlpha})`,
    green: `rgba(183,255,0,${greenAlpha})`,
  };
  const background = GLOW_SHAPES[origin]
    .map(
      (s) =>
        `radial-gradient(ellipse ${s.rx * p.size}% ${s.ry * p.size}% at ${s.x}% ${p.height}%, ${hueColor[s.hue]}, transparent ${s.cut}%)`,
    )
    .join(", ");

  const bottomBand = clamp(25 * p.edgeSoftness, 1, 45);
  const topBand = clamp(10 * p.edgeSoftness, 0.5, 45);
  const sideBand = clamp(6 * p.edgeSoftness, 0.5, 45);
  const mask = `linear-gradient(to top, transparent 0%, black ${bottomBand}%, black ${100 - topBand}%, transparent 100%), linear-gradient(to right, transparent 0%, black ${sideBand}%, black ${100 - sideBand}%, transparent 100%)`;

  return { background, mask };
}

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
    const { background, mask } = buildGlow(
      status.originSide === "center" ? "center" : "right",
      {
        strength: status.glowStrength,
        size: status.glowSize,
        height: status.glowHeight,
        colorMix: status.glowColorMix,
        edgeSoftness: status.glowEdgeSoftness,
      },
    );
    glowRef.current.style.background = background;
    glowRef.current.style.maskImage = mask;
    glowRef.current.style.setProperty("-webkit-mask-image", mask);
  }, [
    status?.originSide,
    status?.glowStrength,
    status?.glowSize,
    status?.glowHeight,
    status?.glowColorMix,
    status?.glowEdgeSoftness,
  ]);

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
