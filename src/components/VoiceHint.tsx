"use client";

import { useState } from "react";
import { Mic } from "lucide-react";

export type HintKind = "silence" | "mic-blocked" | "connect-failed" | "dropped";

const COPY: Record<
  HintKind,
  { message: string; primary: string; secondary: string }
> = {
  silence: {
    message: "Not hearing anything from your mic.",
    primary: "Switch mic",
    secondary: "Type instead",
  },
  "mic-blocked": {
    message: "Mic access is blocked — allow it in the address bar.",
    primary: "Try again",
    secondary: "Type instead",
  },
  "connect-failed": {
    message: "Couldn't start voice.",
    primary: "Try again",
    secondary: "Type instead",
  },
  dropped: {
    message: "Voice dropped.",
    primary: "Reconnect",
    secondary: "Type instead",
  },
};

// The silence card and the 3 error cards. Owns the Switch-mic <select> of
// audioinput devices — enumerateDevices() is only ever called from inside a
// handler (onMouseDown/onFocus, right before the native dropdown opens),
// never at mount, per the spec.
export function VoiceHint({
  kind,
  onDismiss,
  onPrimary,
  onTypeInstead,
  onSwitchMicDevice,
}: {
  kind: HintKind;
  onDismiss: () => void;
  onPrimary: () => void;
  onTypeInstead: () => void;
  onSwitchMicDevice: (deviceId: string) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const copy = COPY[kind];

  async function loadDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
    } catch {
      // enumerateDevices can throw without mic permission — the select just
      // stays empty, which is fine since Switch mic is only shown once a
      // session (and therefore mic permission) already exists.
    }
  }

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 motion-safe:animate-[riff-hint-in_260ms_cubic-bezier(0.16,1,0.3,1)]"
    >
      <Mic
        className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <div className="flex flex-col gap-1">
        <p aria-live="polite" className="text-sm/[20px] text-zinc-700">
          {copy.message}
        </p>
        <div className="flex items-center gap-1.5 text-sm">
          {kind === "silence" ? (
            <select
              aria-label="Switch microphone"
              defaultValue=""
              onMouseDown={loadDevices}
              onFocus={loadDevices}
              onChange={(e) => {
                if (e.target.value) onSwitchMicDevice(e.target.value);
              }}
              className="appearance-none border-0 bg-transparent p-0 font-medium text-[#1F7A4D] hover:underline focus:outline-none"
            >
              <option value="" disabled>
                {copy.primary}
              </option>
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={onPrimary}
              className="font-medium text-[#1F7A4D] hover:underline"
            >
              {copy.primary}
            </button>
          )}
          <span className="text-zinc-300" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            onClick={onTypeInstead}
            className="font-medium text-[#1F7A4D] hover:underline"
          >
            {copy.secondary}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-auto shrink-0 text-zinc-400 hover:text-zinc-900"
      >
        &times;
      </button>
    </div>
  );
}
