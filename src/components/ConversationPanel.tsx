"use client";

import { ConversationProvider } from "@elevenlabs/react";
import { useStore, type Job } from "@/lib/store";
import { useVoice } from "@/hooks/useVoice";

const STATUS_LABEL: Record<string, string> = {
  idle: "Tap to speak",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

function JobRow({ job }: { job: Job }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
        job.status === "superseded" ? "opacity-40" : ""
      }`}
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {job.status === "sketching" && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff6b4a]" />
        )}
        {job.status === "done" && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M5 13l4 4L19 7"
              stroke="#a1a1aa"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {job.status === "superseded" && (
          <span className="h-2 w-2 rounded-full bg-zinc-600" />
        )}
        {job.status === "failed" && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="#ef4444"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      <span
        className={`truncate ${
          job.status === "superseded"
            ? "text-zinc-600 line-through"
            : job.status === "failed"
              ? "text-red-400"
              : "text-zinc-400"
        }`}
      >
        {job.label}
      </span>
    </div>
  );
}

export function ConversationPanel() {
  return (
    <ConversationProvider>
      <ConversationPanelInner />
    </ConversationProvider>
  );
}

function ConversationPanelInner() {
  const messages = useStore((s) => s.messages);
  const status = useStore((s) => s.status);
  const jobs = useStore((s) => s.jobs);
  const { start, stop, isConnected } = useVoice();

  const handleMicClick = () => {
    if (isConnected) {
      stop();
    } else {
      start();
    }
  };

  const visibleJobs = jobs.slice(-4);

  return (
    <div className="flex h-full w-full flex-col border-t border-zinc-800 bg-zinc-950 md:w-[340px] md:border-t-0 md:border-l">
      {visibleJobs.length > 0 && (
        <div className="flex flex-col gap-0.5 border-b border-zinc-800 px-3 py-2">
          {visibleJobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </div>
      )}
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
          onClick={handleMicClick}
          aria-label="Toggle microphone"
          aria-pressed={isConnected}
          className={`flex h-20 w-20 items-center justify-center rounded-full bg-[#ff6b4a] text-white shadow-[0_0_0_6px_rgba(255,107,74,0.12)] transition-transform hover:scale-105 active:scale-95 ${
            status === "listening" ? "animate-pulse" : ""
          }`}
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
