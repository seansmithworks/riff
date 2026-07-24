"use client";

import { useStore } from "@/lib/store";

const STATUS_LABEL: Record<string, string> = {
  idle: "Tap to speak",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

export function ConversationPanel() {
  const messages = useStore((s) => s.messages);
  const status = useStore((s) => s.status);

  return (
    <div className="flex h-full w-full flex-col border-t border-zinc-800 bg-zinc-950 md:w-[340px] md:border-t-0 md:border-l">
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-zinc-600">
            Your conversation will show up here.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((message, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "ml-auto bg-[#ff6b4a] text-white"
                    : "bg-zinc-900 text-zinc-200"
                }`}
              >
                {message.text}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-3 border-t border-zinc-800 px-5 py-8">
        <button
          type="button"
          aria-label="Toggle microphone"
          className="flex h-20 w-20 items-center justify-center rounded-full bg-[#ff6b4a] text-white shadow-[0_0_0_6px_rgba(255,107,74,0.12)] transition-transform hover:scale-105 active:scale-95"
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="9"
              y="2"
              width="6"
              height="12"
              rx="3"
              fill="currentColor"
            />
            <path
              d="M5 11a7 7 0 0 0 14 0M12 18v3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <span className="text-xs font-medium tracking-wide text-zinc-500">
          {STATUS_LABEL[status] ?? STATUS_LABEL.idle}
        </span>
      </div>
    </div>
  );
}
