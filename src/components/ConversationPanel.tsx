"use client";

import { ConversationProvider } from "@elevenlabs/react";
import { useStore, type Status } from "@/lib/store";
import { useVoice } from "@/hooks/useVoice";
import { PresentationOverlay } from "@/components/PresentationOverlay";

const STATUS_LABEL: Record<string, string> = {
  idle: "Tap to speak",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

// Mic control for the always-on ambient overlay. Backed by the single
// useVoice() call site in ConversationPanelInner.
function MicButton({
  status,
  isConnected,
  onClick,
}: {
  status: Status;
  isConnected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Toggle microphone"
      aria-pressed={isConnected}
      className={`flex h-20 w-20 items-center justify-center rounded-full bg-[#3FBA6A] text-white shadow-[0_0_0_6px_rgba(63,186,106,0.18)] transition-transform hover:scale-105 active:scale-95 ${
        status === "listening" ? "animate-pulse" : ""
      }`}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
        <path
          d="M5 11a7 7 0 0 0 14 0M12 18v3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

export function ConversationPanel() {
  return (
    <ConversationProvider>
      <ConversationPanelInner />
    </ConversationProvider>
  );
}

// Always-on voice UI: the floating mic + ambient "Star Wars crawl" transcript
// preview. The full transcript (voice + typed, in one thread) lives in the
// chat surface (see CopilotPanel) — this overlay is a live preview, not a
// second conversation surface.
function ConversationPanelInner() {
  const messages = useStore((s) => s.messages);
  const status = useStore((s) => s.status);
  const { start, stop, isConnected } = useVoice();

  const handleMicClick = () => {
    if (isConnected) {
      stop();
    } else {
      start();
    }
  };

  return (
    <PresentationOverlay messages={messages} status={status}>
      <MicButton
        status={status}
        isConnected={isConnected}
        onClick={handleMicClick}
      />
      <span className="text-xs font-medium tracking-wide text-zinc-500">
        {STATUS_LABEL[status] ?? STATUS_LABEL.idle}
      </span>
    </PresentationOverlay>
  );
}
