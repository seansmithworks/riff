"use client";

import { useCallback, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { useStore, nextJobId } from "@/lib/store";
import type { Artifact } from "@/lib/artifact";

function jobLabel(brief: string): string {
  const words = brief.trim().split(/\s+/).slice(0, 6).join(" ");
  return brief.trim().split(/\s+/).length > 6 ? `${words}…` : words;
}

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
// voiceGeneration is a monotonically increasing counter local to the voice
// path, used only to detect whether a newer voice render_artifact call has
// superseded this one by the time its fetch resolves. It's separate from the
// job id (see nextJobId in store.ts, shared with the text path) so that the
// text rail issuing a job id never falsely marks an in-flight voice response
// as stale. inFlightRequests tracks how many generations are still pending.
let voiceGeneration = 0;
let inFlightRequests = 0;

export type VoiceIssue = "mic-blocked" | "connect-failed" | "dropped" | null;

// Wraps ElevenLabs' useConversation with the render_artifact client tool and
// keeps the zustand store (messages, status) in sync with the session.
// Must be rendered inside a <ConversationProvider>.
export function useVoice() {
  const setArtifact = useStore((s) => s.setArtifact);
  const addMessage = useStore((s) => s.addMessage);
  const setStatus = useStore((s) => s.setStatus);
  const addJob = useStore((s) => s.addJob);
  const updateJobStatus = useStore((s) => s.updateJobStatus);

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
      // Fires the generation request in the background and returns to the
      // agent immediately. Generation takes 11-19s, and ElevenLabs abandons
      // an in-flight client tool the moment the user speaks again — so this
      // tool must never await the fetch. The artifact (and status) update
      // later, out-of-band, when the fetch settles.
      render_artifact: ({
        brief,
        artifact_kind,
      }: {
        brief: string;
        artifact_kind: "wireframe" | "flow";
      }) => {
        const generation = ++voiceGeneration;
        const requestId = nextJobId();
        inFlightRequests += 1;
        setStatus("thinking");
        addJob({ id: requestId, label: jobLabel(brief), status: "sketching" });

        const currentArtifact = useStore.getState().artifact;

        fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brief: `${brief}\n\nRender this as a ${artifact_kind}.`,
            currentArtifact,
          }),
        })
          .then(async (res) => {
            if (!res.ok) {
              throw new Error("generate request failed");
            }
            const { artifact } = (await res.json()) as { artifact: Artifact };
            // Ignore this result if a newer voice render_artifact call has
            // been issued since — the newest request always wins the canvas.
            if (generation === voiceGeneration) {
              setArtifact(artifact);
              addMessage({
                role: "assistant",
                text: artifactSummary(artifact),
              });
              updateJobStatus(requestId, "done");
            } else {
              updateJobStatus(requestId, "superseded");
            }
          })
          .catch(() => {
            updateJobStatus(requestId, "failed");
            if (generation === voiceGeneration) {
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
