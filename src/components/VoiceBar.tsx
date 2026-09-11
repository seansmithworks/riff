"use client";

import { useRef } from "react";
import { Keyboard, Mic, PencilLine, X } from "lucide-react";
import { LevelMeter } from "./LevelMeter";
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
    <div className="mx-0.5 h-5 w-px shrink-0 bg-zinc-200" aria-hidden="true" />
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
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-zinc-100 ${
        active ? "bg-zinc-100 text-[#3FBA6A]" : "text-zinc-600"
      }`}
    >
      {children}
    </button>
  );
}

function SketchChip({ job }: { job: JobChip }) {
  const trackClass =
    job.status === "done"
      ? "scale-x-100 transition-transform duration-150"
      : "riff-track-fill";

  return (
    <div className="flex min-w-0 flex-col gap-1 px-2 motion-safe:animate-[riff-chip-in_260ms_cubic-bezier(0.16,1,0.3,1)]">
      <div className="flex items-center gap-1.5">
        <PencilLine
          className="h-[14px] w-[14px] shrink-0 text-zinc-500"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span className="whitespace-nowrap text-sm/[20px] font-medium text-zinc-500">
          {job.status === "failed"
            ? "Couldn't sketch that — try again."
            : job.label}
        </span>
      </div>
      {job.status !== "failed" && (
        <div className="h-[2px] w-full overflow-hidden rounded-full bg-[#e4e4e7]">
          <div
            className={`h-full w-full origin-left rounded-full bg-[#3FBA6A] ${trackClass}`}
          />
        </div>
      )}
    </div>
  );
}

function Caption({ text, tone }: { text: string; tone: "user" | "agent" }) {
  return (
    <div
      className={`line-clamp-2 rounded-lg bg-white/80 px-3 py-1.5 text-center text-sm/[20px] backdrop-blur-sm ${
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
              transition: right 260ms cubic-bezier(0.16, 1, 0.3, 1);
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

          <div className="flex h-14 items-center gap-1 rounded-full border border-zinc-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm">
            {layout === "idle" ? (
              <button
                type="button"
                onClick={onStart}
                aria-label={label}
                className="flex h-11 items-center rounded-full transition-transform hover:scale-105 active:scale-95"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#3FBA6A] text-white">
                  <Mic
                    className="h-[18px] w-[18px]"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </span>
                {!hideLabel && (
                  <span className="px-2 text-sm/[20px] font-medium text-zinc-900">
                    {label}
                  </span>
                )}
              </button>
            ) : (
              <div className="flex h-11 items-center">
                <div
                  ref={layout === "live" ? haloRef : undefined}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                    layout === "dark" ? "bg-[#18181b]" : "bg-[#3FBA6A]"
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
                  aria-live="polite"
                  className={`px-2 text-sm/[20px] font-medium text-zinc-900 ${
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

            <Segment show={job !== null}>
              <div className="flex items-center">
                <Divider />
                {job && <SketchChip job={job} />}
              </div>
            </Segment>

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
