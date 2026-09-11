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

  return open && vw >= 640 ? Math.min(480, vw - 48) + 24 : 0;
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
      <main className="flex-1 overflow-hidden">
        <ArtifactCanvas
          onOpenChat={() => setChatOpen(true)}
          rightInset={rightInset}
        />
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
