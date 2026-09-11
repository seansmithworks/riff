"use client";

import { useEffect, useRef, useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import { useStore } from "@/lib/store";
import { useVoice } from "@/hooks/useVoice";
import { useMicSilence } from "@/hooks/useMicSilence";
import { VoiceBar, type VoiceState, type JobChip } from "@/components/VoiceBar";
import type { HintKind } from "@/components/VoiceHint";

const DEV = process.env.NODE_ENV !== "production";

// The 12 `?voiceState=` fixtures required by Acceptance 3. "sketching" and
// "sketch-failed" combine the "listening" bar layout with a synthetic job
// chip; "ended" collapses to the idle bar with a static "session ended"
// caption — both match how these states actually occur (the job chip and
// the disc state are independent in real usage; see VoiceBar's Segment for
// the chip and LAYOUT for the disc).
const DEV_OVERRIDES = [
  "idle",
  "connecting",
  "allow-mic",
  "listening",
  "speaking",
  "sketching",
  "sketch-failed",
  "silence",
  "mic-blocked",
  "connect-failed",
  "dropped",
  "ended",
] as const;
type DevOverride = (typeof DEV_OVERRIDES)[number];

// Sine-modulated synthetic source so bars aren't flat in dev-override
// screenshots — there's no live session to drive the real
// getInput/OutputByteFrequencyData in that mode.
function synthesizeLevelData(t: number): Uint8Array {
  const data = new Uint8Array(1024);
  for (let i = 0; i < 410; i++) {
    const v = 140 + 90 * Math.sin(t / 220 + i * 0.15);
    data[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return data;
}

export function ConversationPanel({
  chatOpen,
  onToggleChat,
  onOpenChat,
  rightInset,
}: {
  chatOpen: boolean;
  onToggleChat: () => void;
  onOpenChat: () => void;
  rightInset: number;
}) {
  return (
    <ConversationProvider>
      <ConversationPanelInner
        chatOpen={chatOpen}
        onToggleChat={onToggleChat}
        onOpenChat={onOpenChat}
        rightInset={rightInset}
      />
    </ConversationProvider>
  );
}

// Composition root: wires useVoice + useMicSilence into VoiceBar's
// presentational props, and owns the dev-only ?voiceState= override.
function ConversationPanelInner({
  chatOpen,
  onToggleChat,
  onOpenChat,
  rightInset,
}: {
  chatOpen: boolean;
  onToggleChat: () => void;
  onOpenChat: () => void;
  rightInset: number;
}) {
  const messages = useStore((s) => s.messages);
  const artifact = useStore((s) => s.artifact);
  const jobs = useStore((s) => s.jobs);
  const voice = useVoice();

  const silence = useMicSilence({
    status: voice.status,
    mode: voice.mode,
    getInputVolume: voice.getInputVolume,
    userTurnCount: voice.userTurnCount,
  });

  // jobs is the shared queue written by both the voice (useVoice.ts) and
  // text (CopilotPanel.tsx) render paths — reused verbatim from the prior
  // mic-label derivation.
  const isGenerating = jobs.some((job) => job.status === "sketching");
  const lastSettledJob = [...jobs]
    .reverse()
    .find((job) => job.status === "done" || job.status === "failed");
  const showJobError = !isGenerating && lastSettledJob?.status === "failed";
  const job: JobChip | null = isGenerating
    ? { status: "sketching", label: artifact ? "Revising…" : "Sketching…" }
    : showJobError
      ? { status: "failed", label: "" }
      : null;

  // Dev-only ?voiceState= override — inert in production (see NODE_ENV
  // gate above). Read from window.location.search inside a useEffect, not
  // useSearchParams (which needs a Suspense boundary and breaks the build).
  const [devOverride, setDevOverride] = useState<DevOverride | null>(null);
  useEffect(() => {
    if (!DEV) return;
    const value = new URLSearchParams(window.location.search).get("voiceState");
    if ((DEV_OVERRIDES as readonly string[]).includes(value ?? "")) {
      setDevOverride(value as DevOverride);
    }
  }, []);

  // Dev-only escape hatch, next to the existing __riffStore pattern.
  useEffect(() => {
    if (!DEV) return;
    (window as unknown as { __riffVoice?: unknown }).__riffVoice = {
      getInputVolume: voice.getInputVolume,
      getOutputVolume: voice.getOutputVolume,
    };
  }, [voice.getInputVolume, voice.getOutputVolume]);

  const syntheticTimeRef = useRef(0);
  const getSyntheticData = () => {
    syntheticTimeRef.current += 16;
    return synthesizeLevelData(syntheticTimeRef.current);
  };

  // Best-effort mic permission read for the Connecting row's "Allow mic
  // access" copy — degrades silently (stays "Connecting…") in browsers
  // without the Permissions API or a "microphone" descriptor (e.g. Safari).
  const [micPromptState, setMicPromptState] = useState<
    "prompt" | "granted" | "denied" | null
  >(null);
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      return;
    }
    let cancelled = false;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        setMicPromptState(status.state as "prompt" | "granted" | "denied");
        status.onchange = () =>
          setMicPromptState(status.state as "prompt" | "granted" | "denied");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const lastMessage = messages[messages.length - 1] ?? null;

  let voiceState: VoiceState;
  if (devOverride) {
    voiceState =
      devOverride === "sketching" || devOverride === "sketch-failed"
        ? "listening"
        : devOverride === "ended"
          ? "idle"
          : devOverride;
  } else if (voice.issue === "mic-blocked") {
    voiceState = "mic-blocked";
  } else if (voice.issue === "connect-failed") {
    voiceState = "connect-failed";
  } else if (voice.issue === "dropped") {
    voiceState = "dropped";
  } else if (silence.silent) {
    voiceState = "silence";
  } else if (voice.phase === "requesting" || voice.status === "connecting") {
    voiceState = micPromptState === "prompt" ? "allow-mic" : "connecting";
  } else if (voice.status === "connected" && voice.mode === "speaking") {
    voiceState = "speaking";
  } else if (voice.status === "connected") {
    voiceState = "listening";
  } else {
    voiceState = "idle";
  }

  const effectiveJob: JobChip | null = devOverride
    ? devOverride === "sketching"
      ? { status: "sketching", label: "Sketching…" }
      : devOverride === "sketch-failed"
        ? { status: "failed", label: "" }
        : null
    : job;

  const caption = chatOpen
    ? null
    : devOverride === "ended"
      ? "Riff ended the session."
      : voiceState === "listening" ||
          voiceState === "silence" ||
          voiceState === "speaking"
        ? (lastMessage?.text ?? null)
        : null;

  const captionTone: "user" | "agent" =
    lastMessage?.role === "user" ? "user" : "agent";

  const hintKind: HintKind | null =
    !chatOpen &&
    (voiceState === "silence" ||
      voiceState === "mic-blocked" ||
      voiceState === "connect-failed" ||
      voiceState === "dropped")
      ? voiceState
      : null;

  const handleHintPrimary = () => {
    voice.clearIssue();
    voice.start();
  };

  const handleTypeInstead = () => {
    voice.stop();
    onOpenChat();
  };

  return (
    <VoiceBar
      voiceState={voiceState}
      job={effectiveJob}
      chatOpen={chatOpen}
      rightInset={rightInset}
      caption={caption}
      captionTone={captionTone}
      hintKind={hintKind}
      getUserData={
        devOverride ? getSyntheticData : voice.getInputByteFrequencyData
      }
      getAgentData={
        devOverride ? getSyntheticData : voice.getOutputByteFrequencyData
      }
      onStart={voice.start}
      onStop={voice.stop}
      onToggleChat={onToggleChat}
      onDismissHint={silence.dismiss}
      onHintPrimary={handleHintPrimary}
      onTypeInstead={handleTypeInstead}
      onSwitchMicDevice={(deviceId) =>
        voice.changeInputDevice({ inputDeviceId: deviceId })
      }
    />
  );
}
