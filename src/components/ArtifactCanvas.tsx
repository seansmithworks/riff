"use client";

import { useStore } from "@/lib/store";
import { WireframeCanvas } from "./WireframeCanvas";
import { FlowCanvas } from "./FlowCanvas";

export function ArtifactCanvas() {
  const artifact = useStore((s) => s.artifact);

  if (!artifact) {
    return (
      <div className="flex h-full w-full items-center justify-center px-8">
        <p className="max-w-sm text-center text-sm text-zinc-500">
          Tap the mic and start talking about your idea.
        </p>
      </div>
    );
  }

  if (artifact.kind === "wireframe") {
    return <WireframeCanvas screens={artifact.screens} />;
  }

  return <FlowCanvas nodes={artifact.nodes} edges={artifact.edges} />;
}
