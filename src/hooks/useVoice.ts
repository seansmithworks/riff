"use client";

import { useCallback } from "react";
import { useConversation } from "@elevenlabs/react";
import { useStore } from "@/lib/store";
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

// Wraps ElevenLabs' useConversation with the render_artifact client tool and
// keeps the zustand store (messages, status) in sync with the session.
// Must be rendered inside a <ConversationProvider>.
export function useVoice() {
  const setArtifact = useStore((s) => s.setArtifact);
  const addMessage = useStore((s) => s.addMessage);
  const setStatus = useStore((s) => s.setStatus);

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
      render_artifact: async ({
        brief,
        artifact_kind,
      }: {
        brief: string;
        artifact_kind: "wireframe" | "flow";
      }) => {
        setStatus("thinking");
        try {
          const currentArtifact = useStore.getState().artifact;
          const res = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              brief: `${brief}\n\nRender this as a ${artifact_kind}.`,
              currentArtifact,
            }),
          });

          if (!res.ok) {
            setStatus("listening");
            return "The canvas failed to update — continue the conversation and try again after the next answer.";
          }

          const { artifact } = (await res.json()) as { artifact: Artifact };
          setArtifact(artifact);
          setStatus("listening");
          return artifactSummary(artifact);
        } catch {
          setStatus("listening");
          return "The canvas failed to update — continue the conversation and try again after the next answer.";
        }
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
