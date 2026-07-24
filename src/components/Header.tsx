"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { SAMPLE_WIREFRAME, SAMPLE_FLOW } from "@/lib/samples";

type ShareState = "idle" | "loading" | "success" | "error";

function IconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        disabled
          ? "cursor-not-allowed text-zinc-300"
          : active
            ? "text-[#3FBA6A] hover:bg-zinc-100"
            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
      }`}
    >
      {children}
    </button>
  );
}

// Hands the current artifact off to a live Daytona sandbox, on demand.
// Additive to the voice/generation path — reads the artifact from the
// store, never writes to it.
function ShareButton() {
  const artifact = useStore((s) => s.artifact);
  const messages = useStore((s) => s.messages);
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
        body: JSON.stringify({ artifact, messages }),
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
      <IconButton
        label={shareState === "loading" ? "Sharing…" : "Hand off to build"}
        disabled={!artifact || shareState === "loading"}
        onClick={handleShare}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={
            shareState === "loading" ? "motion-safe:animate-pulse" : ""
          }
        >
          <path
            d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </IconButton>

      {shareState === "success" && shareUrl && (
        <div className="absolute top-full right-0 z-20 mt-2 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-lg">
          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            className="max-w-[220px] truncate text-xs text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
          >
            {shareUrl}
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-[10px] font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="shrink-0 text-zinc-400 hover:text-zinc-900"
          >
            &times;
          </button>
        </div>
      )}

      {shareState === "error" && (
        <div className="absolute top-full right-0 z-20 mt-2 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-lg">
          <span className="max-w-[220px] text-xs text-red-500">
            {shareError}
          </span>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="shrink-0 text-zinc-400 hover:text-zinc-900"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}

// Riff logo, floating top-left over the canvas. The source SVG has a pale
// mint background baked in; multiply-blending it against the light canvas
// removes the visible rectangle without needing a separate asset.
export function RiffLogo() {
  return (
    <div className="pointer-events-none fixed top-6 left-6 z-30">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/riff-logo.svg"
        alt="Riff"
        style={{ width: 160, height: "auto" }}
      />
    </div>
  );
}

// Floating icon toolbar — the only chrome over the full-canvas artifact
// surface. Every control is icon-only with an aria-label + title tooltip so
// the demo doesn't depend on remembering positions.
export function Header({ onOpenChat }: { onOpenChat: () => void }) {
  const setArtifact = useStore((s) => s.setArtifact);

  return (
    <div className="fixed top-6 right-6 z-30 flex items-center gap-1 rounded-full border border-zinc-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm">
      <div className="flex items-center gap-0.5">
        <IconButton
          label="Wireframe"
          onClick={() => setArtifact(SAMPLE_WIREFRAME)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="4"
              width="8"
              height="16"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <rect
              x="13"
              y="4"
              width="8"
              height="10"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
        </IconButton>

        <IconButton label="Flow" onClick={() => setArtifact(SAMPLE_FLOW)}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="5"
              cy="6"
              r="2.3"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle
              cx="19"
              cy="6"
              r="2.3"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle
              cx="19"
              cy="18"
              r="2.3"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="M7.3 6h9.4M17 8.3v7.4a2 2 0 0 1-2 2H9"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </IconButton>
      </div>

      <div className="mx-0.5 h-5 w-px bg-zinc-200" aria-hidden="true" />

      <ShareButton />

      <div className="mx-0.5 h-5 w-px bg-zinc-200" aria-hidden="true" />

      <IconButton label="Open text rail" onClick={onOpenChat}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 12.5v-7Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </IconButton>
    </div>
  );
}
