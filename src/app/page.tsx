"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { ArtifactCanvas } from "@/components/ArtifactCanvas";
import { ConversationPanel } from "@/components/ConversationPanel";
import { CopilotPanel } from "@/components/CopilotPanel";
import { useStore } from "@/lib/store";

export default function Home() {
  const [presentation, setPresentation] = useState(false);

  useEffect(() => {
    if (!presentation) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPresentation(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presentation]);

  // Dev-only hook so Playwright/E2E scripts can seed store.messages without
  // a live voice session. No-op in production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __riffStore?: typeof useStore }).__riffStore =
      useStore;
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col bg-[#f4f4f5]">
      <Header
        presentation={presentation}
        onTogglePresentation={() => setPresentation((p) => !p)}
      />
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <main className="flex-1 overflow-hidden">
          <ArtifactCanvas />
        </main>
        <ConversationPanel presentation={presentation} />
      </div>
      <CopilotPanel />
    </div>
  );
}
