"use client";

import { useState } from "react";
import Stage from "@/components/voiceLab/Stage";
import VoiceLabPanels from "@/components/voiceLab/Panels";
import DialKitRoot from "@/components/voiceLab/DialKitRoot";
import AgentationMount from "@/components/voiceLab/AgentationMount";

// Two regions, side by side down to 600px, stacked only below that (phones)
// — never overlapping. The stage area shrinks (contain-fit) to make room for
// a fixed-width DialKit sidebar at full window height with its own internal
// scroll, so every panel is reachable at any window size without the canvas
// ever sitting under the panel.
export default function VoiceLabPage() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-dvh w-full max-w-full flex-col overflow-x-hidden bg-[#f4f4f5] text-[#18181b] min-[600px]:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-4 sm:p-6">
        <div className="flex shrink-0 flex-col gap-0.5">
          <h1 className="m-0 text-lg font-semibold tracking-tight">
            Riff Voice Marks Lab
          </h1>
          <p className="m-0 text-xs text-[#71717a]">
            Tuning bench for Riff&apos;s hand-drawn voice reactivity — voice and
            sketch-job run on independent channels, matching
            render_artifact&apos;s fire-and-forget behavior.
          </p>
        </div>
        <div className="min-h-0 flex-1">
          <Stage>
            <VoiceLabPanels />
          </Stage>
        </div>
      </div>

      <aside className="flex flex-none flex-col border-t border-[#e4e4e7] bg-white min-[600px]:h-full min-[600px]:w-[320px] min-[600px]:border-l min-[600px]:border-t-0">
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          className="hidden min-h-[44px] w-full shrink-0 items-center justify-between px-4 text-sm font-medium text-[#18181b] max-[599px]:flex"
        >
          DialKit tuners
          <span aria-hidden="true">{mobileOpen ? "▲" : "▼"}</span>
        </button>
        <div
          className={`overflow-hidden transition-[height] duration-200 min-[600px]:h-full min-[600px]:flex-1 ${
            mobileOpen ? "h-[60vh]" : "h-0"
          }`}
        >
          {/* Bottom padding keeps the last panel reachable above Agentation's
              fixed bottom-right pill, which otherwise sits on top of it. */}
          <div className="h-full overflow-y-auto pb-16 min-[600px]:h-full">
            <DialKitRoot />
          </div>
        </div>
      </aside>

      <AgentationMount />
    </div>
  );
}
