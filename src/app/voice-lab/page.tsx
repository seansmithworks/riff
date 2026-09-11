"use client";

import Stage from "@/components/voiceLab/Stage";
import VoiceLabPanels from "@/components/voiceLab/Panels";
import DialKitRoot from "@/components/voiceLab/DialKitRoot";
import AgentationMount from "@/components/voiceLab/AgentationMount";

export default function VoiceLabPage() {
  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#f4f4f5] p-4 text-[#18181b] sm:p-6">
      <div className="mb-3 flex flex-col gap-0.5">
        <h1 className="m-0 text-lg font-semibold tracking-tight">
          Riff Voice Marks Lab
        </h1>
        <p className="m-0 text-xs text-[#71717a]">
          Tuning bench for Riff&apos;s hand-drawn voice reactivity — voice and
          sketch-job run on independent channels, matching
          render_artifact&apos;s fire-and-forget behavior.
        </p>
      </div>
      <Stage>
        <VoiceLabPanels />
      </Stage>
      <DialKitRoot />
      <AgentationMount />
    </div>
  );
}
