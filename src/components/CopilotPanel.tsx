"use client";

import { useEffect, useRef } from "react";
import "@copilotkit/react-ui/styles.css";
import {
  CopilotSidebar,
  useChatContext,
  type CopilotKitCSSProperties,
} from "@copilotkit/react-ui";
import {
  useCopilotAction,
  useCopilotChat,
  useCopilotReadable,
} from "@copilotkit/react-core";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import { useStore, nextJobId } from "@/lib/store";
import type { Artifact } from "@/lib/artifact";

// Matches the treatment in useVoice.ts so both paths look identical in the
// render-queue status strip.
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

// Bridges the sidebar's internal open state to Header's pill icon. Rendered
// as a child of CopilotSidebar so it can reach useChatContext(); pushes our
// externally-controlled `open` boolean into CopilotKit whenever it changes.
function ChatOpenSync({ open }: { open: boolean }) {
  const { setOpen } = useChatContext();
  useEffect(() => {
    setOpen(open);
  }, [open, setOpen]);
  return null;
}

// Mirrors voice-originated turns (from useVoice.ts / ElevenLabs, tracked in
// the zustand store) into CopilotKit's own message list, so this sidebar is
// the single surface showing both voice and typed turns in one thread.
// appendMessage(..., { followUp: false }) adds the message to the visible
// thread without triggering a chat completion — voice turns never go through
// the CopilotKit runtime. Only appends messages not yet synced, so a user's
// typed conversation is never clobbered.
function VoiceTranscriptSync() {
  const storeMessages = useStore((s) => s.messages);
  const { appendMessage } = useCopilotChat();
  const syncedCount = useRef(0);

  useEffect(() => {
    if (storeMessages.length <= syncedCount.current) return;
    const newMessages = storeMessages.slice(syncedCount.current);
    syncedCount.current = storeMessages.length;
    newMessages.forEach((message) => {
      appendMessage(
        new TextMessage({
          role: message.role === "user" ? Role.User : Role.Assistant,
          content: message.text,
        }),
        { followUp: false },
      );
    });
  }, [storeMessages, appendMessage]);

  return null;
}

// The single chat surface: transcript (voice + typed, via VoiceTranscriptSync
// above) and text input in one thread. Drives the same artifact loop as
// voice (POST /api/generate -> setArtifact) via a CopilotKit action, so
// typing works identically to speaking.
export function CopilotPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setArtifact = useStore((s) => s.setArtifact);
  const artifact = useStore((s) => s.artifact);
  const addJob = useStore((s) => s.addJob);
  const updateJobStatus = useStore((s) => s.updateJobStatus);

  useCopilotReadable({
    description:
      "The design artifact (wireframe or flow) currently rendered on the canvas.",
    value: artifact,
  });

  useCopilotAction({
    name: "render_artifact",
    description:
      "Render or evolve the design artifact on the canvas. Use this whenever the user describes an app, feature, or screen to design, or asks to change what's currently on screen. If an artifact is already on screen, this evolves it rather than starting over.",
    parameters: [
      {
        name: "brief",
        type: "string",
        description:
          "What to design and all requirements gathered so far, in plain language.",
        required: true,
      },
      {
        name: "artifact_kind",
        type: "string",
        description: 'Either "wireframe" or "flow".',
        enum: ["wireframe", "flow"],
        required: true,
      },
    ],
    handler: async ({ brief, artifact_kind }) => {
      const currentArtifact = useStore.getState().artifact;
      const jobId = nextJobId();
      addJob({ id: jobId, label: jobLabel(brief), status: "sketching" });

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brief: `${brief}\n\nRender this as a ${artifact_kind}.`,
            currentArtifact,
          }),
        });

        if (!res.ok) {
          updateJobStatus(jobId, "failed");
          return "The canvas failed to update — try rephrasing and asking again.";
        }

        const { artifact: newArtifact } = (await res.json()) as {
          artifact: Artifact;
        };
        setArtifact(newArtifact);
        updateJobStatus(jobId, "done");
        return artifactSummary(newArtifact);
      } catch {
        updateJobStatus(jobId, "failed");
        return "The canvas failed to update — try rephrasing and asking again.";
      }
    },
  });

  const themeVars: CopilotKitCSSProperties = {
    "--copilot-kit-primary-color": "#1F7A4D",
    "--copilot-kit-contrast-color": "#fafafa",
    "--copilot-kit-background-color": "#ffffff",
    "--copilot-kit-input-background-color": "#ffffff",
    "--copilot-kit-secondary-color": "#e4e4e7",
    "--copilot-kit-secondary-contrast-color": "#18181b",
    "--copilot-kit-separator-color": "#e4e4e7",
    "--copilot-kit-muted-color": "#71717a",
  };

  return (
    <div style={themeVars}>
      {/* CopilotKit reuses --copilot-kit-contrast-color for both the header
          background and text-on-accent (e.g. the toggle button icon), so the
          header can't be retinted via CSS vars alone without also breaking
          contrast elsewhere. Scope a small override to match the light shell. */}
      <style jsx global>{`
        .copilotKitHeader {
          background-color: #ffffff;
        }
        .copilotKitHeader > button {
          color: #71717a;
        }
        .copilotKitInput > textarea::placeholder {
          color: #71717a;
        }
        .copilotKitSidebar .copilotKitWindow {
          border-left: 1px solid #e4e4e7;
        }
      `}</style>
      <CopilotSidebar
        defaultOpen={false}
        clickOutsideToClose={false}
        onSetOpen={onOpenChange}
        Button={() => null}
        labels={{
          title: "Riff",
          initial:
            "Describe an app, feature, or screen and I'll render it on the canvas — by voice or by typing here. Your voice conversation shows up in this thread too.",
        }}
        instructions="You are Riff, a senior design partner. When the user describes an app, feature, or screen, call render_artifact with a clear brief and the right artifact_kind (wireframe or flow). If an artifact is already on screen, evolve it rather than starting over. Ask at most one sharp clarifying question at a time; otherwise make a reasonable call and render."
      >
        <ChatOpenSync open={open} />
        <VoiceTranscriptSync />
      </CopilotSidebar>
    </div>
  );
}
