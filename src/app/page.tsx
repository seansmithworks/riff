"use client";

import { useEffect, useState } from "react";
import { Header, RiffLogo } from "@/components/Header";
import { ArtifactCanvas } from "@/components/ArtifactCanvas";
import { ConversationPanel } from "@/components/ConversationPanel";
import { CopilotPanel } from "@/components/CopilotPanel";
import { HackathonFootnote } from "@/components/HackathonFootnote";
import { useStore } from "@/lib/store";

// The chat panel refit: mirrors CopilotPanel's `min(30rem, 100vw - 3rem)`
// at `right: 1.5rem` (see CopilotPanel.tsx's @media (min-width:640px)
// block) — 480/48/24 are that same 30rem/3rem/1.5rem math in px. Only the
// fitView padding changes; the canvas container itself never shrinks (see
// WireframeCanvas.tsx / FlowCanvas.tsx).
//
// The bar itself only has room to recenter (VoiceBar.tsx pins its wrapper
// to `left: 346px` once rightInset > 0, clearing HackathonFootnote and the
// zoom controls) when there's still >= 360px left for it between that
// 346px left edge and the panel's left edge. Below that — reviewer-found
// collision at ~1100px and an off-screen bar at 768px — chatInset stays 0
// so the chat panel simply overlays the (unrefit, still-centered) canvas
// and bar, the same tradeoff already made on phone.
function useChatInset(open: boolean): number {
  const [vw, setVw] = useState(0);

  useEffect(() => {
    function update() {
      setVw(window.innerWidth);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  if (!open || vw < 640) return 0;
  const chatInset = Math.min(480, vw - 48) + 24;
  return vw - chatInset - 346 >= 360 ? chatInset : 0;
}

export default function Home() {
  const [chatOpen, setChatOpen] = useState(false);
  const rightInset = useChatInset(chatOpen);

  // Dev-only hook so Playwright/E2E scripts can seed store.messages without
  // a live voice session. No-op in production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __riffStore?: typeof useStore }).__riffStore =
      useStore;
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col bg-[#f4f4f5]">
      <RiffLogo />
      <Header />
      {/* Isolated so the voice wash can sit under the canvas content: the
          slot is the background layer (VoiceStage.tsx portals the wash into
          it), and the canvas, its nodes and its dot grid paint above it. */}
      <main className="relative isolate flex-1 overflow-hidden">
        <div
          id="riff-voice-wash-slot"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        />
        <div className="relative z-10 h-full w-full">
          <ArtifactCanvas
            onOpenChat={() => setChatOpen(true)}
            rightInset={rightInset}
          />
        </div>
      </main>
      <ConversationPanel
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((o) => !o)}
        onOpenChat={() => setChatOpen(true)}
        rightInset={rightInset}
      />
      <CopilotPanel open={chatOpen} onOpenChange={setChatOpen} />
      <HackathonFootnote />
    </div>
  );
}
