"use client";

import { useCallback, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { useStore } from "@/lib/store";
import { startSketchJob } from "@/lib/sketch-job";
import type { Artifact } from "@/lib/artifact";

function artifactSummary(artifact: Artifact): string {
  if (artifact.kind === "wireframe") {
    const names = artifact.screens.map((s) => s.name).join(", ");
    return `Rendered wireframe: ${names} — ${artifact.screens.length} screen${
      artifact.screens.length === 1 ? "" : "s"
    }`;
  }
  return `Rendered flow: ${artifact.nodes.length} step${
    artifact.nodes.length === 1 ? "" : "s"
  }`;
}

// Module-level so state survives across re-renders of the hook (the
// clientTools object below is recreated every render).
// Newest wins, globally: one canvas shows one stream, so startSketchJob
// (sketch-job.ts) aborts and supersedes whatever job is running when a new
// one starts, whether voice or the text rail started either. A typed request
// supersedes a voice sketch, and a voice call supersedes a typed one.
// inFlightRequests tracks how many voice sketch jobs haven't settled yet.
let inFlightRequests = 0;

export type VoiceIssue = "mic-blocked" | "connect-failed" | "dropped" | null;

// Wraps ElevenLabs' useConversation with the render_artifact client tool and
// keeps the zustand store (messages, status) in sync with the session.
// Must be rendered inside a <ConversationProvider>.
export function useVoice() {
  const addMessage = useStore((s) => s.addMessage);
  const setStatus = useStore((s) => s.setStatus);

  // Additive voice-UI state (VoiceBar/useMicSilence). `phase` covers the
  // signed-url fetch window before the SDK itself reports "connecting".
  // `hasConnectedRef` disambiguates onError before vs. after a successful
  // connect: pre-connect, onError sets mic-blocked or connect-failed;
  // post-connect it sets no issue at all (non-fatal — mute/tool errors),
  // since only onDisconnect(reason: "error") sets "dropped" once a session
  // is live — see the "Error: dropped" row in the spec.
  const [phase, setPhase] = useState<"idle" | "requesting">("idle");
  const [issue, setIssue] = useState<VoiceIssue>(null);
  const [userTurnCount, setUserTurnCount] = useState(0);
  // A fresh object on every non-error disconnect (not just a changed value)
  // so a consumer's effect re-fires even on back-to-back sessions ended the
  // same way (e.g. "user", "user") — see the "Ended" state's 4s caption in
  // ConversationPanel.tsx, which is how that state becomes reachable
  // outside the dev ?voiceState= fixture.
  const [ended, setEnded] = useState<{
    by: "user" | "agent";
    at: number;
  } | null>(null);
  const hasConnectedRef = useRef(false);
  const clearIssue = useCallback(() => setIssue(null), []);
  const clearEnded = useCallback(() => setEnded(null), []);

  const conversation = useConversation({
    onConnect: () => {
      setStatus("listening");
      hasConnectedRef.current = true;
      setIssue(null);
    },
    onDisconnect: (details) => {
      setStatus("idle");
      if (details.reason === "error") {
        setIssue("dropped");
      } else {
        setEnded({ by: details.reason, at: Date.now() });
      }
      hasConnectedRef.current = false;
    },
    onError: (message, context) => {
      addMessage({
        role: "assistant",
        text: `Voice connection error: ${message}`,
      });
      setStatus("idle");
      // onError while already connected is often non-fatal (mute, a tool
      // error like "Server error: permission denied", etc.) and must set no
      // issue — only onDisconnect(reason: "error") does, via the branch
      // above. Without this guard a mid-session error whose message happens
      // to contain "permission" would slap a permanent "Mic access is
      // blocked" card over an otherwise-healthy session.
      if (!hasConnectedRef.current) {
        const err = context as { name?: string } | undefined;
        // NotAllowedError is the SDK's actual permission-denial signal.
        // The /permission/i regex is a pre-connect-only fallback for SDK
        // versions/paths that surface it as plain text instead.
        const isPermissionError =
          err?.name === "NotAllowedError" || /permission/i.test(message);
        setIssue(isPermissionError ? "mic-blocked" : "connect-failed");
      }
    },
    onMessage: ({ message, source }) => {
      addMessage({
        role: source === "user" ? "user" : "assistant",
        text: message,
      });
      // "Verified" per useMicSilence.ts requires a user transcript with a
      // letter in it, not just any source:"user" payload.
      if (source === "user" && /[a-zA-Z]/.test(message)) {
        setUserTurnCount((c) => c + 1);
      }
    },
    onModeChange: ({ mode }) => {
      setStatus(mode === "speaking" ? "speaking" : "listening");
    },
    clientTools: {
      // Starts the sketch job in the background and returns to the agent
      // immediately. Generation takes seconds, and ElevenLabs abandons an
      // in-flight client tool the moment the user speaks again — so this
      // tool must never await the job. The canvas fills in out-of-band as
      // the stream's screens close.
      render_artifact: ({
        brief,
        artifact_kind,
      }: {
        brief: string;
        artifact_kind: "wireframe" | "flow";
      }) => {
        inFlightRequests += 1;
        setStatus("thinking");

        startSketchJob({ brief, artifactKind: artifact_kind, source: "voice" })
          .done.then((result) => {
            if (result.status === "done") {
              addMessage({
                role: "assistant",
                text: artifactSummary(result.artifact),
              });
            } else if (result.status === "failed") {
              addMessage({
                role: "assistant",
                text: "The canvas failed to update — continue the conversation and try again after the next answer.",
              });
            }
          })
          .finally(() => {
            inFlightRequests = Math.max(0, inFlightRequests - 1);
            if (inFlightRequests === 0) {
              setStatus("listening");
            }
          });

        return Promise.resolve(
          "Sketching that now — it'll appear on the canvas in a few seconds.",
        );
      },
    },
  });

  const start = useCallback(async () => {
    setPhase("requesting");
    setIssue(null);
    hasConnectedRef.current = false;
    try {
      const res = await fetch("/api/signed-url");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        addMessage({
          role: "assistant",
          text: `Couldn't start the voice session: ${body.error ?? "signed URL request failed"}`,
        });
        setIssue("connect-failed");
        return;
      }
      const { signedUrl } = (await res.json()) as { signedUrl: string };
      await conversation.startSession({ signedUrl });
    } catch {
      addMessage({
        role: "assistant",
        text: "Couldn't access your microphone. Check your browser's mic permissions and try again.",
      });
      setStatus("idle");
      setIssue("connect-failed");
    } finally {
      setPhase("idle");
    }
  }, [conversation, addMessage, setStatus]);

  const stop = useCallback(() => {
    conversation.endSession();
  }, [conversation]);

  return {
    start,
    stop,
    status: conversation.status,
    mode: conversation.mode,
    phase,
    issue,
    clearIssue,
    ended,
    clearEnded,
    userTurnCount,
    isConnected: conversation.status === "connected",
    isSpeaking: conversation.isSpeaking,
    getInputVolume: conversation.getInputVolume,
    getOutputVolume: conversation.getOutputVolume,
    getInputByteFrequencyData: conversation.getInputByteFrequencyData,
    getOutputByteFrequencyData: conversation.getOutputByteFrequencyData,
    changeInputDevice: conversation.changeInputDevice,
  };
}
