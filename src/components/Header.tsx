"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { SAMPLE_WIREFRAME, SAMPLE_FLOW } from "@/lib/samples";

// Shared "has the session started" flag: mic tap, sent text, or a loaded
// artifact all dock the logo (and, once docked, keep the empty-state canvas
// out of hero-reserved spacing) — and it never un-docks for the rest of the
// session, even if status returns to idle. Exported so ArtifactCanvas can
// read the same latch instead of re-deriving a second one that could drift.
export function useSessionActive(): boolean {
  const status = useStore((s) => s.status);
  const jobsLength = useStore((s) => s.jobs.length);
  const hasArtifact = useStore((s) => s.artifact !== null);
  const isActiveNow = status !== "idle" || jobsLength > 0 || hasArtifact;
  const [active, setActive] = useState(isActiveNow);
  useEffect(() => {
    if (isActiveNow) setActive(true);
  }, [isActiveNow]);
  return active;
}

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

// Riff logo. Starts large and centered as the hero mark over the empty
// canvas; docks to the current top-left corner position/size the moment the
// session goes active (mic tap, sent text, or a loaded artifact — see
// useSessionActive) and stays docked for the rest of the session. One
// element, one transform: `top`/`left` reposition the (always 160px-wide)
// box, `scale` grows it from a `top left` origin so hero and docked are the
// same element moving, not a crossfade. The source SVG has a pale mint
// background baked in; multiply-blending it against the light canvas
// removes the visible rectangle without needing a separate asset.
//
// STRAWMAN — first-load intro. On mount, if the session hasn't already gone
// active and the user hasn't asked for reduced motion, plays a short clip of
// the logo being hand-drawn (in the same 160px hero box, same green as the
// SVG's baked-in background) once, then crossfades into the static logo,
// which docks exactly as it always has. Any failure mode (reduced motion,
// video error, autoplay blocked) collapses immediately to today's behavior
// — the static logo never stays hidden waiting on the clip.
function LogoIntro({ onDone }: { onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const doneRef = useRef(false);

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }

  useEffect(() => {
    // Safety net: if `ended`/`error` never fire (stalled load, blocked
    // autoplay), don't strand the hero on a frozen video forever.
    const t = setTimeout(finish, 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-lg"
      style={{ backgroundColor: "#45F5A2" }}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        autoPlay
        muted
        playsInline
        onEnded={finish}
        onError={finish}
        poster="/riff-logo-draw-poster.png"
      >
        <source src="/riff-logo-draw.webm" type="video/webm" />
        <source src="/riff-logo-draw.mp4" type="video/mp4" />
      </video>
    </div>
  );
}

export function RiffLogo() {
  const docked = useSessionActive();
  // Starts false on both server and client to keep first paint identical
  // (avoids a hydration mismatch) — flips true in an effect right after
  // mount, client-only, once we know reduced-motion and whether the session
  // was already active before the intro could even start.
  const [showIntro, setShowIntro] = useState(false);
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    if (docked) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    setShowIntro(true);
    // Only ever decided once, from the state at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the session goes active mid-clip, cut straight to the static logo
  // rather than let a playing (and about-to-shrink) video dock alongside it.
  useEffect(() => {
    if (docked && showIntro && !introDone) setIntroDone(true);
  }, [docked, showIntro, introDone]);

  const introVisible = showIntro && !introDone;

  return (
    <div
      className="pointer-events-none fixed z-30 transition-[top,left,transform] duration-[600ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
      style={{
        top: docked ? 24 : 96,
        left: docked ? 24 : "calc(50% - 160px)",
        transform: docked ? "scale(1)" : "scale(2)",
        transformOrigin: "top left",
      }}
    >
      {/* Box matches the static SVG's own aspect ratio (225x150 viewBox,
          160px wide -> 106.67px tall) so the intro tile is exactly the
          static logo's footprint — no layout shift into the headline below
          when it crossfades. */}
      <div
        className="relative"
        style={{ width: 160, height: 160 / (225 / 150) }}
      >
        {introVisible && <LogoIntro onDone={() => setIntroDone(true)} />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/riff-logo.svg"
          alt="Riff"
          className="absolute top-0 left-0 transition-opacity duration-300"
          style={{
            width: 160,
            height: "auto",
            opacity: introVisible ? 0 : 1,
          }}
        />
      </div>
    </div>
  );
}

// Dev-only affordance for seeding the canvas without a live voice/text
// session. Deliberately NOT styled like the view controls next to it — text
// label (not an icon), muted color, dashed chip — so it can't be mistaken
// for a "switch view" toggle. Hidden entirely in production builds.
function SampleLoaderButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Dev only — injects sample content onto the canvas (${label})`}
      className="rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-[10px] font-medium whitespace-nowrap text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600"
    >
      {label}
    </button>
  );
}

// Floating toolbar, top-right — hand-off in production; sample loaders too
// in non-production builds (see SampleLoaderButton). Every icon control has
// an aria-label + title tooltip so the demo doesn't depend on remembering
// positions. The chat entry point is a separate floating button (see
// ChatButton below), not part of this pill.
export function Header() {
  const setArtifact = useStore((s) => s.setArtifact);

  return (
    <div className="fixed top-6 right-6 z-30 flex items-center gap-1 rounded-full border border-zinc-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm">
      {process.env.NODE_ENV !== "production" && (
        <>
          <div className="flex items-center gap-1 pl-1">
            <SampleLoaderButton
              label="Load sample wireframe"
              onClick={() => setArtifact(SAMPLE_WIREFRAME)}
            />
            <SampleLoaderButton
              label="Load sample flow"
              onClick={() => setArtifact(SAMPLE_FLOW)}
            />
          </div>
          <div className="mx-0.5 h-5 w-px bg-zinc-200" aria-hidden="true" />
        </>
      )}

      <ShareButton />
    </div>
  );
}

// Single chat entry point — independently floating (not part of the pill)
// so it reads as its own surface. Bottom-right keeps it clear of the
// top-right pill, the top-left logo, and the bottom-center mic.
//
// Stays mounted while the panel is open (unmounting would kill the morph
// animation) but fades/scales out and goes non-interactive as the panel
// grows from this exact spot — see CopilotPanel.tsx's `.copilotKitWindow`
// overrides, which are inset/anchored to line up with this button's
// bottom-right corner so the panel reads as this button expanding, not two
// separate objects. `disabled` + `aria-hidden` guarantee it's unreachable
// (not just visually gone) for the whole time the panel is open, matching
// the z-index finding from the previous pass: CopilotKit's window paints on
// top of this button at equal z-index, so open state must never rely on the
// button being visually covered alone.
export function ChatButton({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={open}
      aria-label={open ? "Close chat" : "Open chat"}
      aria-pressed={open}
      aria-hidden={open}
      tabIndex={open ? -1 : 0}
      title={open ? "Close chat" : "Open chat"}
      className={`fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 bg-white/95 shadow-lg backdrop-blur-sm transition-[opacity,transform] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-150 motion-reduce:ease-out ${
        open
          ? "pointer-events-none scale-75 opacity-0 motion-reduce:scale-100"
          : "scale-100 opacity-100 hover:bg-zinc-50"
      } ${open ? "text-[#1F7A4D]" : "text-zinc-600"}`}
    >
      <svg
        width="20"
        height="20"
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
    </button>
  );
}
