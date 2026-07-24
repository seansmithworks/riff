"use client";

import { useState } from "react";
import { APP_NAME, TAGLINE } from "@/lib/config";
import { useStore } from "@/lib/store";
import { SAMPLE_WIREFRAME, SAMPLE_FLOW } from "@/lib/samples";

type ShareState = "idle" | "loading" | "success" | "error";

// Turns the current artifact into a live Daytona URL, on demand. Additive to
// the voice/generation path — reads the artifact from the store, never
// writes to it.
function ShareButton() {
  const artifact = useStore((s) => s.artifact);
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    if (!artifact) return;
    setShareState("loading");
    setShareError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifact }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Share failed");
      }
      setShareUrl(data.url);
      setShareState("success");
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Share failed");
      setShareState("error");
    }
  }

  async function handleCopy() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDismiss() {
    setShareState("idle");
    setShareUrl(null);
    setShareError(null);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleShare}
        disabled={!artifact || shareState === "loading"}
        className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
          !artifact
            ? "cursor-not-allowed border-zinc-800 text-zinc-600"
            : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
        }`}
      >
        {shareState === "loading" ? (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ff6b4a] motion-safe:animate-pulse" />
            Sharing&hellip;
          </span>
        ) : (
          "Hand off to build"
        )}
      </button>

      {shareState === "success" && shareUrl && (
        <div className="absolute top-full right-0 z-20 mt-2 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-lg">
          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            className="max-w-[220px] truncate text-xs text-zinc-200 underline decoration-zinc-600 underline-offset-2 hover:text-white"
          >
            {shareUrl}
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-300 hover:border-zinc-500 hover:text-white"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="shrink-0 text-zinc-500 hover:text-white"
          >
            &times;
          </button>
        </div>
      )}

      {shareState === "error" && (
        <div className="absolute top-full right-0 z-20 mt-2 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-lg">
          <span className="max-w-[220px] text-xs text-red-400">
            {shareError}
          </span>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="shrink-0 text-zinc-500 hover:text-white"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}

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
        <ShareButton />
      </div>
    </header>
  );
}
