"use client";

import { useEffect, useRef } from "react";

// Calibrated 2026-09-11 against a real speech clip and a quiet (~-65dB)
// clip via `?voiceState=` fake-audio sessions (see the build report) —
// tuned so speech bars peak at 0.8-1.0. If calibration couldn't run this
// stays at the spec's starting value and is uncalibrated.
const GAIN = 2.5;

// First 410 of 1024 bins ≈ 100-3.3kHz of the analyser's 100-8000Hz range.
const BIN_COUNT = 410;
const SLICE_COUNT = 5;
const SLICE_LEN = Math.floor(BIN_COUNT / SLICE_COUNT);
// Loudest slice sits in the visual center: [b3, b1, b0, b2, b4].
const BAR_ORDER = [3, 1, 0, 2, 4];

// rAF-driven mic/output level meter. Writes directly to bar + halo DOM refs
// every frame (no React state per frame) so the 60fps loop never triggers a
// re-render. `getData` reads whatever the ElevenLabs SDK analyser is
// currently exposing (input or output bins) — there is no separate
// getUserMedia call here, per the spec's "no Web Audio fallback" decision.
export function LevelMeter({
  getData,
  tone,
  haloRef,
}: {
  getData: () => Uint8Array;
  tone: "user" | "agent";
  haloRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const shownRef = useRef<number[]>([0.2, 0.2, 0.2, 0.2, 0.2]);

  useEffect(() => {
    let raf = 0;

    const loop = () => {
      const data = getData();

      if (data.length === 0) {
        // No active session — every bar rests at the floor.
        shownRef.current = [0.2, 0.2, 0.2, 0.2, 0.2];
      } else {
        const next: number[] = [];
        for (let i = 0; i < SLICE_COUNT; i++) {
          let sum = 0;
          const start = i * SLICE_LEN;
          for (let j = start; j < start + SLICE_LEN; j++) {
            sum += data[j] ?? 0;
          }
          const v = Math.min(1, Math.max(0, (sum / SLICE_LEN / 255) * GAIN));
          next.push(v);
        }
        shownRef.current = shownRef.current.map(
          (prev, i) => prev * 0.6 + next[i] * 0.4,
        );
      }

      const shown = shownRef.current;
      BAR_ORDER.forEach((sliceIndex, barIndex) => {
        const el = barRefs.current[barIndex];
        if (el) {
          el.style.transform = `scaleY(${Math.max(0.2, shown[sliceIndex])})`;
        }
      });

      if (haloRef?.current) {
        const level = shown.reduce((a, b) => a + b, 0) / shown.length;
        haloRef.current.style.boxShadow = `0 0 0 ${2 + 4 * level}px rgba(63,186,106,0.18)`;
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getData, haloRef]);

  return (
    <div
      className="flex items-center gap-[3px]"
      aria-hidden="true"
      data-tone={tone}
    >
      {BAR_ORDER.map((_, i) => (
        <div
          key={i}
          ref={(el) => {
            barRefs.current[i] = el;
          }}
          className="h-5 w-[3px] origin-center rounded-full bg-white"
          style={{ transform: "scaleY(0.2)" }}
        />
      ))}
    </div>
  );
}
