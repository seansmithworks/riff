"use client";

import { useStore } from "@/lib/store";
import { WireframeCanvas } from "./WireframeCanvas";
import { FlowCanvas } from "./FlowCanvas";
import { WireframeSkeleton, GeneratingIndicator } from "./CanvasSkeleton";

export function ArtifactCanvas() {
  const artifact = useStore((s) => s.artifact);
  const isThinking = useStore((s) => s.status === "thinking");

  if (!artifact) {
    if (isThinking) {
      return <WireframeSkeleton />;
    }
    return (
      <div className="flex h-full w-full items-center justify-center px-8">
        <p className="max-w-sm text-center text-sm text-zinc-500">
          Tap the mic and start talking about your idea.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {isThinking && <GeneratingIndicator />}
      {artifact.kind === "wireframe" ? (
        <WireframeCanvas screens={artifact.screens} />
      ) : (
        <FlowCanvas nodes={artifact.nodes} edges={artifact.edges} />
      )}
    </div>
  );
}
