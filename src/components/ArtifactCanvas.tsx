"use client";

import { useStore } from "@/lib/store";
import { WireframeCanvas } from "./WireframeCanvas";
import { FlowCanvas } from "./FlowCanvas";
import { WireframeSkeleton } from "./CanvasSkeleton";
import { SAMPLE_WIREFRAME } from "@/lib/samples";
import { useSessionActive } from "./Header";

// Always-available entry point (not gated on NODE_ENV, unlike Header's
// sample loaders) — this is the one no-mic path a recruiter without mic
// access can use to see the product actually do something.
export function ArtifactCanvas({
  onOpenChat,
  rightInset,
}: {
  onOpenChat: () => void;
  rightInset: number;
}) {
  const artifact = useStore((s) => s.artifact);
  const setArtifact = useStore((s) => s.setArtifact);
  const jobs = useStore((s) => s.jobs);
  const isGenerating = jobs.some((job) => job.status === "sketching");
  // Reserve room above the empty-state block for the hero logo (fixed,
  // rendered by RiffLogo) so headline/actions read as centered under it
  // rather than under a taller-than-usual empty top. Once the session goes
  // active the logo has docked to the corner, so this padding drops away.
  const sessionActive = useSessionActive();

  if (!artifact) {
    if (isGenerating) {
      return <WireframeSkeleton />;
    }
    return (
      <div
        className={`flex h-full w-full flex-col items-center justify-center gap-6 px-8 text-center ${
          sessionActive ? "" : "pt-[280px]"
        }`}
      >
        <div className="flex max-w-md flex-col gap-3">
          <h1 className="text-2xl font-semibold text-zinc-900">
            Design with conversation
          </h1>
          <p className="text-sm text-zinc-500">
            Talk to Riff about what you want to create, and sketch out and edit
            the screens and flows together as you keep talking.
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
      {artifact.kind === "wireframe" ? (
        <WireframeCanvas
          screens={artifact.screens}
          platform={artifact.platform}
          rightInset={rightInset}
        />
      ) : (
        <FlowCanvas
          nodes={artifact.nodes}
          edges={artifact.edges}
          rightInset={rightInset}
        />
      )}
    </div>
  );
}
