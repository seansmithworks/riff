"use client";

import { APP_NAME, TAGLINE } from "@/lib/config";
import { useStore } from "@/lib/store";
import { SAMPLE_WIREFRAME, SAMPLE_FLOW } from "@/lib/samples";

// Dev-only toggle buttons so the renderers can be demoed before voice/AI
// wiring lands next wave. Safe to delete once generation is live.
export function Header() {
  const setArtifact = useStore((s) => s.setArtifact);

  return (
    <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-50">
          {APP_NAME}
        </h1>
        <span className="text-sm text-zinc-500">{TAGLINE}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
          Dev preview
        </span>
        <button
          type="button"
          onClick={() => setArtifact(SAMPLE_WIREFRAME)}
          className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-white"
        >
          Wireframe
        </button>
        <button
          type="button"
          onClick={() => setArtifact(SAMPLE_FLOW)}
          className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-white"
        >
          Flow
        </button>
        <button
          type="button"
          onClick={() => setArtifact(null)}
          className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-white"
        >
          Empty
        </button>
      </div>
    </header>
  );
}
