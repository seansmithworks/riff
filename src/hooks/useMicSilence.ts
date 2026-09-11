"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// UNCALIBRATED — these are still the spec's starting values. Calibration
// via `?voiceState=` fake-audio sessions (Chrome's
// --use-file-for-fake-audio-capture) was attempted 2026-09-11 but produced
// silence in this headless-Chrome environment (confirmed independent of
// this app with a raw getUserMedia -> AnalyserNode probe), so no real
// speech/quiet samples were ever captured.
//
// To calibrate with a real mic: open the app, start a session, and in the
// console sample `window.__riffVoice.getInputVolume()` every 100ms for 10s
// each while (a) speaking normally and (b) staying quiet. Record p50 and
// max for each clip, then set SPEAKING_LEVEL = speech p50 / 2 and
// SILENCE_LEVEL = sqrt(quiet max * speech p50). If quiet max >=
// SPEAKING_LEVEL, the two don't separate — keep these starting values.
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

  // Per-turn reset: only the quiet-window clock. Runs on every
  // speaking->listening flip. Does NOT touch verifiedRef — a mic that's
  // already proven itself this session must keep its 10s (verified)
  // timeout through every normal thinking pause after a Riff reply, not
  // drop back to the 4s (unverified) timeout each turn.
  const resetTurnWindow = useCallback(() => {
    const now = Date.now();
    windowStartRef.current = now;
    lastAboveSilenceRef.current = now;
    speakingAccumRef.current = 0;
    setSilent(false);
  }, []);

  // Per-session reset: the turn window plus verifiedRef itself. Runs once,
  // on connect — a new session hasn't proven its mic yet.
  const resetSession = useCallback(() => {
    resetTurnWindow();
    verifiedRef.current = false;
  }, [resetTurnWindow]);

  // The session resets on connect...
  useEffect(() => {
    if (status === "connected" && prevStatusRef.current !== "connected") {
      resetSession();
    }
    if (status !== "connected") {
      setSilent(false);
    }
    prevStatusRef.current = status;
  }, [status, resetSession]);

  // ...and the turn window (only) resets every time mode flips from
  // speaking to listening. Speaking itself always clears the hint (nothing
  // to nag about mid-reply).
  useEffect(() => {
    if (mode === "listening" && prevModeRef.current === "speaking") {
      resetTurnWindow();
    }
    if (mode === "speaking") {
      setSilent(false);
    }
    prevModeRef.current = mode;
  }, [mode, resetTurnWindow]);

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
