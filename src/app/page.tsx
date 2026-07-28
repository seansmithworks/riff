"use client";

import { useEffect, useState } from "react";
import { Header, RiffLogo, ChatButton } from "@/components/Header";
import { ArtifactCanvas } from "@/components/ArtifactCanvas";
import { ConversationPanel } from "@/components/ConversationPanel";
import { CopilotPanel } from "@/components/CopilotPanel";
import { useStore } from "@/lib/store";

export default function Home() {
  const [chatOpen, setChatOpen] = useState(false);

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
      <ChatButton open={chatOpen} onClick={() => setChatOpen((o) => !o)} />
      <main className="flex-1 overflow-hidden">
        <ArtifactCanvas />
      </main>
      <ConversationPanel />
      <CopilotPanel open={chatOpen} onOpenChange={setChatOpen} />
    </div>
  );
}
