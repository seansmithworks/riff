"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Calibrated 2026-09-11 against a real speech clip and a quiet (~-65dB)
// clip via `?voiceState=` fake-audio sessions (see the build report). If
// calibration couldn't run these stay at the spec's starting values and
// are uncalibrated.
export const SILENCE_LEVEL = 0.02;
export const SPEAKING_LEVEL = 0.06;

const SAMPLE_MS = 100;
const VERIFIED_SPEAKING_MS = 300;
const UNVERIFIED_TIMEOUT_MS = 4000;
const VERIFIED_TIMEOUT_MS = 10000;

// Tracks whether the mic is silently failing while the SDK thinks the user
// is listening — the direct fix for the silent-mic bug. Samples
// getInputVolume() (the SDK's own analyser, no second getUserMedia) every
// 100ms while connected+listening only.
export function useMicSilence({
  status,
  mode,
  getInputVolume,
  userTurnCount,
}: {
  status: string;
  mode: "speaking" | "listening";
  getInputVolume: () => number;
  userTurnCount: number;
}) {
  const [silent, setSilent] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const windowStartRef = useRef(Date.now());
  const lastAboveSilenceRef = useRef(Date.now());
  const speakingAccumRef = useRef(0);
  const verifiedRef = useRef(false);
  const lastSampleAtRef = useRef(Date.now());
  const prevStatusRef = useRef(status);
  const prevModeRef = useRef(mode);

  const resetWindow = useCallback(() => {
    const now = Date.now();
    windowStartRef.current = now;
    lastAboveSilenceRef.current = now;
    speakingAccumRef.current = 0;
    verifiedRef.current = false;
    setSilent(false);
  }, []);

  // The window resets on connect...
  useEffect(() => {
    if (status === "connected" && prevStatusRef.current !== "connected") {
      resetWindow();
    }
    if (status !== "connected") {
      setSilent(false);
    }
    prevStatusRef.current = status;
  }, [status, resetWindow]);

  // ...and every time mode flips from speaking to listening. Speaking
  // itself always clears the hint (nothing to nag about mid-reply).
  useEffect(() => {
    if (mode === "listening" && prevModeRef.current === "speaking") {
      resetWindow();
    }
    if (mode === "speaking") {
      setSilent(false);
    }
    prevModeRef.current = mode;
  }, [mode, resetWindow]);

  // A user transcript with a letter in it verifies the mic immediately.
  useEffect(() => {
    if (userTurnCount > 0) {
      verifiedRef.current = true;
    }
  }, [userTurnCount]);

  useEffect(() => {
    if (!(status === "connected" && mode === "listening")) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastSampleAtRef.current;
      lastSampleAtRef.current = now;
      const level = getInputVolume();

      if (level >= SPEAKING_LEVEL) {
        speakingAccumRef.current += elapsed;
        if (speakingAccumRef.current >= VERIFIED_SPEAKING_MS) {
          verifiedRef.current = true;
          setSilent(false);
          setDismissed(false);
        }
      } else {
        speakingAccumRef.current = 0;
      }

      if (level >= SILENCE_LEVEL) {
        lastAboveSilenceRef.current = now;
      }

      const timeout = verifiedRef.current
        ? VERIFIED_TIMEOUT_MS
        : UNVERIFIED_TIMEOUT_MS;
      const quietFor =
        now - Math.max(windowStartRef.current, lastAboveSilenceRef.current);
      if (quietFor >= timeout) {
        setSilent(true);
      }
    }, SAMPLE_MS);

    return () => clearInterval(interval);
  }, [status, mode, getInputVolume]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { silent: silent && !dismissed, dismiss };
}
