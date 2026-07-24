"use client";

import { useCallback } from "react";
import { useConversation } from "@elevenlabs/react";
import { useStore } from "@/lib/store";
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
// requestCounter is a monotonically increasing id for each render_artifact
// call; inFlightRequests tracks how many generations are still pending.
let requestCounter = 0;
let inFlightRequests = 0;

// Wraps ElevenLabs' useConversation with the render_artifact client tool and
// keeps the zustand store (messages, status) in sync with the session.
// Must be rendered inside a <ConversationProvider>.
export function useVoice() {
  const setArtifact = useStore((s) => s.setArtifact);
  const addMessage = useStore((s) => s.addMessage);
  const setStatus = useStore((s) => s.setStatus);
  const addJob = useStore((s) => s.addJob);
  const updateJobStatus = useStore((s) => s.updateJobStatus);

  const conversation = useConversation({
    onConnect: () => setStatus("listening"),
    onDisconnect: () => setStatus("idle"),
    onError: (message) => {
      addMessage({
        role: "assistant",
        text: `Voice connection error: ${message}`,
      });
      setStatus("idle");
    },
    onMessage: ({ message, source }) => {
      addMessage({
        role: source === "user" ? "user" : "assistant",
        text: message,
      });
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
        const requestId = ++requestCounter;
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
            // Ignore this result if a newer render_artifact call has been
            // issued since — the newest request always wins the canvas.
            if (requestId === requestCounter) {
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
            if (requestId === requestCounter) {
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
    try {
      const res = await fetch("/api/signed-url");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        addMessage({
          role: "assistant",
          text: `Couldn't start the voice session: ${body.error ?? "signed URL request failed"}`,
        });
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
    }
  }, [conversation, addMessage, setStatus]);

  const stop = useCallback(() => {
    conversation.endSession();
  }, [conversation]);

  return {
    start,
    stop,
    isConnected: conversation.status === "connected",
    isSpeaking: conversation.isSpeaking,
  };
}
