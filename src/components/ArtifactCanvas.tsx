"use client";

import { useStore } from "@/lib/store";
import { WireframeCanvas } from "./WireframeCanvas";
import { FlowCanvas } from "./FlowCanvas";
import { WireframeSkeleton, GeneratingIndicator } from "./CanvasSkeleton";
import { SAMPLE_WIREFRAME } from "@/lib/samples";

// Always-available entry point (not gated on NODE_ENV, unlike Header's
// sample loaders) — this is the one no-mic path a recruiter without mic
// access can use to see the product actually do something.
export function ArtifactCanvas({ onOpenChat }: { onOpenChat: () => void }) {
  const artifact = useStore((s) => s.artifact);
  const setArtifact = useStore((s) => s.setArtifact);
  const jobs = useStore((s) => s.jobs);
  const isGenerating = jobs.some((job) => job.status === "sketching");

  if (!artifact) {
    if (isGenerating) {
      return <WireframeSkeleton />;
    }
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-6 px-8 text-center">
        <div className="flex max-w-md flex-col gap-3">
          <h1 className="text-2xl font-semibold text-zinc-900">
            Design out loud.
          </h1>
          <p className="text-sm text-zinc-500">
            Describe an app or a screen. Riff sketches wireframes and user flows
            on the canvas as you talk — and revises them as you keep going.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={onOpenChat}
            className="font-medium text-[#1F7A4D] hover:underline"
          >
            or type it
          </button>
          <span className="text-zinc-300" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            onClick={() => setArtifact(SAMPLE_WIREFRAME)}
            className="text-zinc-500 hover:text-zinc-700 hover:underline"
          >
            See an example
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {isGenerating && <GeneratingIndicator />}
      {artifact.kind === "wireframe" ? (
        <WireframeCanvas screens={artifact.screens} />
      ) : (
        <FlowCanvas nodes={artifact.nodes} edges={artifact.edges} />
      )}
    </div>
  );
}
