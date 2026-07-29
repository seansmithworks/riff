"use client";

import { useEffect, useRef } from "react";
import "@copilotkit/react-ui/styles.css";
import {
  CopilotPopup,
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

// Bridges the panel's internal open state to Header's floating chat button.
// Rendered as a child of CopilotPopup so it can reach useChatContext();
// pushes our externally-controlled `open` boolean into CopilotKit whenever
// it changes.
function ChatOpenSync({ open }: { open: boolean }) {
  const { setOpen } = useChatContext();
  useEffect(() => {
    setOpen(open);
  }, [open, setOpen]);
  return null;
}

// Mirrors voice-originated turns (from useVoice.ts / ElevenLabs, tracked in
// the zustand store) into CopilotKit's own message list, so this panel is
// the single surface showing both voice and typed turns in one thread.
// appendMessage(..., { followUp: false }) adds the message to the visible
// thread without triggering a chat completion — voice turns never go through
// the CopilotKit runtime. Only appends messages not yet synced, so a user's
// typed conversation is never clobbered.
//
// Gated on isAvailable and only advances syncedCount AFTER a successful
// append: appendMessage no-ops if the underlying agent hasn't connected yet
// (useCopilotChatInternal's sendMessage early-returns `if (!agent) return`),
// so a turn arriving before connectAgent() resolves must stay unsynced and
// retried on the next store update rather than being marked synced and lost.
function VoiceTranscriptSync() {
  const storeMessages = useStore((s) => s.messages);
  const { appendMessage, isAvailable } = useCopilotChat();
  const syncedCount = useRef(0);

  useEffect(() => {
    if (!isAvailable) return;
    if (storeMessages.length <= syncedCount.current) return;
    const newMessages = storeMessages.slice(syncedCount.current);
    newMessages.forEach((message) => {
      appendMessage(
        new TextMessage({
          role: message.role === "user" ? Role.User : Role.Assistant,
          content: message.text,
        }),
        { followUp: false },
      );
    });
    syncedCount.current = storeMessages.length;
  }, [storeMessages, appendMessage, isAvailable]);

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
      {/*
        CopilotPopup over CopilotSidebar: the sidebar is a full-bleed,
        full-height rail welded to the viewport edge — fighting its fixed
        inset:0/height:100% layout with overrides to make it "float" means
        overriding nearly every positioning rule it sets. CopilotPopup's
        `.copilotKitWindow` (the non-sidebar variant) is ALREADY a floating,
        inset, rounded, shadowed card that toggles a `.open` class rather
        than mounting/unmounting — exactly the shape and the "always
        mounted, transform+opacity driven" behavior the morph needs, so it's
        the correct base to extend rather than re-fight.

        The rules below do two things:
        1. Resize/reposition `.copilotKitWindow` into the large, all-sides-
           inset floating panel Sean asked for (DESIGN.md rounded-lg = 12px,
           the token used for cards elsewhere in the app).
        2. Replace CopilotKit's default (barely-there) open/close transform
           with a stronger scale + border-radius morph anchored at
           `transform-origin: bottom right`, positioned so that corner lines
           up with ChatButton's own bottom-right corner (both inset 1.5rem
           from the viewport edge) — so the panel visually grows out of the
           button instead of appearing as a second, unrelated object.
           Content (header + chat body, the window's only two direct
           children) fades in on a short delay after the container has
           mostly settled, and fades out immediately on close, so it's never
           visibly stretched/squashed mid-morph. `prefers-reduced-motion`
           strips the transform/radius animation down to a plain opacity
           fade per the accessibility requirement.
      */}
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

        .copilotKitPopup .copilotKitWindow {
          border: 1px solid #d4d4d8;
          border-radius: 9999px;
          box-shadow:
            0 25px 50px -12px rgba(0, 0, 0, 0.25),
            0 10px 15px -3px rgba(0, 0, 0, 0.1);
          transform-origin: bottom right;
          transform: scale(0.06);
          opacity: 0;
          transition:
            transform 260ms cubic-bezier(0.16, 1, 0.3, 1),
            border-radius 260ms cubic-bezier(0.16, 1, 0.3, 1),
            opacity 160ms ease-out;
        }
        .copilotKitPopup .copilotKitWindow.open {
          border-radius: 12px;
          transform: scale(1);
          opacity: 1;
        }
        .copilotKitPopup .copilotKitWindow > .copilotKitHeader,
        .copilotKitPopup .copilotKitWindow > .copilotKitChatBody {
          opacity: 0;
          transition: opacity 160ms ease-out;
        }
        .copilotKitPopup .copilotKitWindow.open > .copilotKitHeader,
        .copilotKitPopup .copilotKitWindow.open > .copilotKitChatBody {
          opacity: 1;
          transition-delay: 140ms;
        }

        @media (min-width: 640px) {
          .copilotKitPopup .copilotKitWindow {
            top: 1.5rem;
            right: 1.5rem;
            bottom: 1.5rem;
            left: auto;
            margin-bottom: 0;
            width: min(30rem, calc(100vw - 3rem));
            height: auto;
            min-height: 0;
            max-height: none;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .copilotKitPopup .copilotKitWindow {
            transform: none !important;
            border-radius: 12px !important;
            transition: opacity 150ms ease-out !important;
          }
          .copilotKitPopup .copilotKitWindow > .copilotKitHeader,
          .copilotKitPopup .copilotKitWindow > .copilotKitChatBody {
            transition: opacity 150ms ease-out !important;
            transition-delay: 0ms !important;
          }
        }
      `}</style>
      <CopilotPopup
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
      </CopilotPopup>
    </div>
  );
}
