"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard, Mic, PencilLine, X } from "lucide-react";
import { LevelMeter } from "./LevelMeter";
import { Tooltip } from "./Tooltip";
import { VoiceHint, type HintKind } from "./VoiceHint";

export type VoiceState =
  | "idle"
  | "connecting"
  | "allow-mic"
  | "listening"
  | "speaking"
  | "silence"
  | "mic-blocked"
  | "connect-failed"
  | "dropped";

export type JobChip = {
  id: number;
  status: "sketching" | "done" | "failed";
  label: string;
};

const LABEL: Record<VoiceState, string> = {
  idle: "Start talking",
  connecting: "Connecting…",
  "allow-mic": "Allow mic access",
  listening: "Listening…",
  silence: "Listening…",
  speaking: "Speaking…",
  "mic-blocked": "Start talking",
  "connect-failed": "Start talking",
  dropped: "Start talking",
};

// The disc/bar visual only cares about 4 layouts — connecting and
// mic-blocked/connect-failed/dropped all "return to idle" per the spec's
// state table, and silence looks exactly like listening (the hint card is
// what changes, not the bar).
type BarLayout = "idle" | "connecting" | "live" | "dark";

const LAYOUT: Record<VoiceState, BarLayout> = {
  idle: "idle",
  connecting: "connecting",
  "allow-mic": "connecting",
  listening: "live",
  silence: "live",
  speaking: "dark",
  "mic-blocked": "idle",
  "connect-failed": "idle",
  dropped: "idle",
};

function Segment({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`grid overflow-hidden transition-[grid-template-columns] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:duration-150 ${
        show ? "grid-cols-[1fr]" : "grid-cols-[0fr]"
      }`}
    >
      <div className="min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}

function Divider() {
  return (
    <div className="mx-1 h-5 w-px shrink-0 bg-zinc-200" aria-hidden="true" />
  );
}

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F7A4D] focus-visible:outline-none ${
          active ? "bg-zinc-100 text-[#1F7A4D]" : "text-zinc-600"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

// Snap-to-1 transition (160ms) then a 600ms linger before the parent
// Segment collapses; failed lingers 6s. Owns its own show/hide timer keyed
// by the parent's `key={job.id}` (a fresh id remounts and resets it) —
// this keeps the Divider it renders with from ever being left on screen
// alone once the chip itself decides to hide.
function SketchChipSegment({ job }: { job: JobChip }) {
  const [show, setShow] = useState(true);

  useEffect(() => {
    setShow(true);
    if (job.status === "done") {
      const t = setTimeout(() => setShow(false), 160 + 600);
      return () => clearTimeout(t);
    }
    if (job.status === "failed") {
      const t = setTimeout(() => setShow(false), 6000);
      return () => clearTimeout(t);
    }
  }, [job.status]);

  const trackClass =
    job.status === "done"
      ? "scale-x-100 transition-transform duration-[160ms]"
      : "riff-track-fill";

  return (
    <Segment show={show}>
      <div className="flex items-center">
        <Divider />
        <div className="relative flex h-11 items-center px-2 motion-safe:animate-[riff-chip-in_260ms_cubic-bezier(0.16,1,0.3,1)]">
          <div className="flex items-center gap-1.5">
            <PencilLine
              className="h-[14px] w-[14px] shrink-0 text-zinc-500"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span
              role="status"
              className="whitespace-nowrap text-sm/[20px] font-medium text-zinc-500"
            >
              {job.status === "failed" ? "Sketch failed" : job.label}
            </span>
          </div>
          {job.status !== "failed" && (
            <div className="absolute inset-x-2 bottom-1 h-[2px] overflow-hidden rounded-full bg-zinc-200">
              <div
                className={`h-full w-full origin-left rounded-full bg-[#3FBA6A] ${trackClass}`}
              />
            </div>
          )}
        </div>
      </div>
    </Segment>
  );
}

function Caption({ text, tone }: { text: string; tone: "user" | "agent" }) {
  return (
    <div
      className={`line-clamp-2 rounded-lg bg-white/90 px-3 py-1.5 text-center text-sm/[20px] backdrop-blur-sm ${
        tone === "user" ? "text-zinc-500" : "text-zinc-900"
      }`}
    >
      {text}
    </div>
  );
}

const GLOW =
  "radial-gradient(ellipse 55% 60% at 50% 100%, rgba(0,245,241,0.35), transparent 55%), radial-gradient(ellipse 45% 50% at 60% 100%, rgba(183,255,0,0.28), transparent 60%)";

// Presentational only — no SDK imports. The single Conversation Bar that
// replaces the green orb, the floating chat button, and the transcript
// crawl. Composition (deriving VoiceState/caption/hint from useVoice +
// useMicSilence) lives in ConversationPanel.
export function VoiceBar({
  voiceState,
  job,
  chatOpen,
  rightInset,
  caption,
  captionTone,
  hintKind,
  getUserData,
  getAgentData,
  onStart,
  onStop,
  onToggleChat,
  onDismissHint,
  onHintPrimary,
  onTypeInstead,
  onSwitchMicDevice,
}: {
  voiceState: VoiceState;
  job: JobChip | null;
  chatOpen: boolean;
  rightInset: number;
  caption: string | null;
  captionTone: "user" | "agent";
  hintKind: HintKind | null;
  getUserData: () => Uint8Array;
  getAgentData: () => Uint8Array;
  onStart: () => void;
  onStop: () => void;
  onToggleChat: () => void;
  onDismissHint: () => void;
  onHintPrimary: () => void;
  onTypeInstead: () => void;
  onSwitchMicDevice: (deviceId: string) => void;
}) {
  const haloRef = useRef<HTMLDivElement | null>(null);
  const layout = LAYOUT[voiceState];
  const label = LABEL[voiceState];
  const hideLabel = voiceState === "idle" && job !== null;
  const showX = layout !== "idle";
  const showCaptionSlot = !chatOpen && (hintKind !== null || caption !== null);

  const glowClass = job
    ? "riff-glow-thinking"
    : voiceState === "listening" || voiceState === "silence"
      ? "riff-glow-listening"
      : voiceState === "speaking"
        ? "riff-glow-speaking"
        : "opacity-5";

  return (
    <>
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-10 h-[55vh] origin-bottom transition-opacity duration-700 ${glowClass}`}
        style={{ background: GLOW }}
      />

      <div className="voice-bar-wrapper pointer-events-none fixed inset-x-3 bottom-14 z-20 flex justify-center sm:inset-x-0 sm:bottom-6 sm:left-0">
        <style jsx>{`
          @media (min-width: 640px) {
            .voice-bar-wrapper {
              right: ${rightInset}px;
              ${rightInset > 0 ? "left: 346px;" : ""}
              transition:
                right 260ms cubic-bezier(0.16, 1, 0.3, 1),
                left 260ms cubic-bezier(0.16, 1, 0.3, 1);
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .voice-bar-wrapper {
              transition: none;
            }
          }
        `}</style>

        <div className="pointer-events-auto relative flex flex-col items-center">
          {showCaptionSlot && (
            <div className="absolute bottom-full mb-2 w-max max-w-[calc(100vw-24px)] sm:max-w-[560px]">
              {hintKind ? (
                <VoiceHint
                  kind={hintKind}
                  onDismiss={onDismissHint}
                  onPrimary={onHintPrimary}
                  onTypeInstead={onTypeInstead}
                  onSwitchMicDevice={onSwitchMicDevice}
                />
              ) : (
                <Caption text={caption ?? ""} tone={captionTone} />
              )}
            </div>
          )}

          <div className="flex h-14 items-center gap-0 rounded-full border border-zinc-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm">
            {layout === "idle" ? (
              <button
                type="button"
                onClick={onStart}
                aria-label={label}
                className="flex h-11 items-center rounded-full transition-transform hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F7A4D] focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#3FBA6A] text-white">
                  <Mic
                    className="h-[18px] w-[18px]"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </span>
                {!hideLabel && (
                  <span
                    key={label}
                    className="min-w-[88px] px-2 text-sm/[20px] font-medium text-zinc-900 motion-safe:animate-[riff-label-in_160ms_ease-out]"
                  >
                    {label}
                  </span>
                )}
              </button>
            ) : (
              <div className="flex h-11 items-center">
                <div
                  ref={layout === "live" ? haloRef : undefined}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    layout === "dark" ? "bg-zinc-900" : "bg-[#3FBA6A]"
                  }`}
                >
                  {layout === "connecting" ? (
                    <div
                      className="flex items-center gap-[3px]"
                      aria-hidden="true"
                    >
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className="h-5 w-[3px] rounded-full bg-white riff-bars-wait"
                          style={{ animationDelay: `${i * 90}ms` }}
                        />
                      ))}
                    </div>
                  ) : (
                    <LevelMeter
                      getData={layout === "dark" ? getAgentData : getUserData}
                      tone={layout === "dark" ? "agent" : "user"}
                      haloRef={layout === "live" ? haloRef : undefined}
                    />
                  )}
                </div>
                <span
                  key={label}
                  aria-live="polite"
                  className={`min-w-[88px] px-2 text-sm/[20px] font-medium text-zinc-900 motion-safe:animate-[riff-label-in_160ms_ease-out] ${
                    job ? "max-sm:hidden" : ""
                  }`}
                >
                  {label}
                </span>
              </div>
            )}

            <Segment show={showX}>
              <div className="flex items-center">
                <Divider />
                <IconButton label="End session" onClick={onStop}>
                  <X
                    className="h-[18px] w-[18px]"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </IconButton>
              </div>
            </Segment>

            {job && <SketchChipSegment key={job.id} job={job} />}

            <Divider />
            <IconButton
              label={chatOpen ? "Close chat" : "Open chat"}
              active={chatOpen}
              onClick={onToggleChat}
            >
              <Keyboard
                className="h-[18px] w-[18px]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </IconButton>
          </div>
        </div>
      </div>
    </>
  );
}
