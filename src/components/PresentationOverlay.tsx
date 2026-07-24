"use client";

import type { Message, Status } from "@/lib/store";

// Static glow intensity for reduced-motion / idle — animated variants live
// in globals.css as .riff-glow-{status} keyframe classes.
const GLOW_CLASS: Record<Status, string> = {
  idle: "opacity-5",
  listening: "riff-glow-listening",
  thinking: "riff-glow-thinking",
  speaking: "riff-glow-speaking",
};

// Presentation-mode overlay: the "Star Wars crawl" transcript (last two
// messages, feathered out at the top) and the ambient coral glow behind the
// mic. Purely presentational — the mic control itself is passed in as
// children so the single useVoice() call site stays in ConversationPanel.
export function PresentationOverlay({
  messages,
  status,
  children,
}: {
  messages: Message[];
  status: Status;
  children: React.ReactNode;
}) {
  const lastTwo = messages.slice(-2);

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col items-center justify-end gap-6 pb-12">
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-[55vh] origin-bottom transition-opacity duration-700 ${
          GLOW_CLASS[status] ?? GLOW_CLASS.idle
        }`}
        style={{
          background:
            "radial-gradient(ellipse 55% 60% at 50% 100%, rgba(255,107,74,0.55), transparent 72%)",
        }}
      />

      {lastTwo.length > 0 && (
        <div
          className="relative flex max-w-2xl flex-col items-center gap-2 px-6 text-center"
          style={{
            maskImage: "linear-gradient(to top, black 40%, transparent)",
            WebkitMaskImage: "linear-gradient(to top, black 40%, transparent)",
          }}
        >
          {lastTwo.map((message, i) => (
            <p
              key={i}
              className={
                i === lastTwo.length - 1
                  ? "text-lg font-medium leading-snug text-zinc-900"
                  : "text-sm leading-snug text-zinc-500"
              }
            >
              {message.text}
            </p>
          ))}
        </div>
      )}

      <div className="pointer-events-auto relative flex flex-col items-center gap-3">
        {children}
      </div>
    </div>
  );
}
