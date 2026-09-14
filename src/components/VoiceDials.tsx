"use client";

import { useEffect, useRef, useState } from "react";
import type { VoiceLabEngine } from "@/lib/voiceLab/engine";
import { TUNED, type LevelCalibration } from "@/lib/voiceLab/tuning";
import type { Role } from "@/lib/voiceLab/types";
import type { VoiceReadout } from "@/lib/voiceStage";

// Dev-only panel (?dials=1, mounted by VoiceStage.tsx): calibration for the
// real-audio levels and the listening gate. Edits write the running engine's
// config and tuning.ts's TUNED in memory, so they apply at once and survive
// a remount; nothing persists. Bake the values shown into tuning.ts after a
// live pass.

const CAL_DIALS: {
  key: keyof LevelCalibration;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: "gain", label: "gain", min: 0, max: 4, step: 0.05 },
  { key: "floor", label: "floor", min: 0, max: 0.9, step: 0.01 },
  { key: "curve", label: "curve", min: 0.2, max: 3, step: 0.05 },
];

const ROLES: Role[] = ["human", "riff"];

function snapshot() {
  return {
    calibration: {
      human: { ...TUNED.calibration.human },
      riff: { ...TUNED.calibration.riff },
    },
    listening: { ...TUNED.listening },
  };
}

function formatReadout(r: VoiceReadout): string {
  const role = (name: string, x: VoiceReadout["human"]) =>
    `${name} ${x.live ? "live" : "----"} in ${x.input.toFixed(3)} lvl ${x.level.toFixed(2)} [${x.bands.map((b) => b.toFixed(2)).join(" ")}]`;
  return `${r.state} · gate ${r.talking ? "open" : "shut"}\n${role("you ", r.human)}\n${role("riff", r.riff)}`;
}

function Dial({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
      <span className="w-10 text-right">{value}</span>
    </label>
  );
}

export function VoiceDials({
  engine,
  read,
}: {
  engine: VoiceLabEngine;
  read: () => VoiceReadout;
}) {
  const [values, setValues] = useState(snapshot);
  const readRef = useRef(read);
  const readoutRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    readRef.current = read;
  });

  // The readout polls; it never re-renders the panel.
  useEffect(() => {
    const id = setInterval(() => {
      if (readoutRef.current)
        readoutRef.current.textContent = formatReadout(readRef.current());
    }, 100);
    return () => clearInterval(id);
  }, []);

  const setCal = (role: Role, key: keyof LevelCalibration, v: number) => {
    engine.config.levelCalibration[role][key] = v;
    TUNED.calibration[role][key] = v;
    engine.wake();
    setValues(snapshot());
  };

  const setListening = (key: "threshold" | "releaseMs", v: number) => {
    TUNED.listening[key] = v;
    setValues(snapshot());
  };

  return (
    <div className="fixed top-28 left-4 z-40 flex w-72 flex-col gap-2 rounded-lg border border-zinc-200 bg-white/95 p-3 font-mono text-[11px]/[16px] text-zinc-700 shadow-lg">
      <div className="font-semibold text-zinc-900">Voice dials (dev)</div>
      {ROLES.map((role) => (
        <div key={role} className="flex flex-col gap-1">
          <div className="text-zinc-500">
            {role === "human" ? "you" : "riff"}
          </div>
          {CAL_DIALS.map((d) => (
            <Dial
              key={d.key}
              label={d.label}
              value={values.calibration[role][d.key]}
              min={d.min}
              max={d.max}
              step={d.step}
              onChange={(v) => setCal(role, d.key, v)}
            />
          ))}
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <div className="text-zinc-500">listening gate</div>
        <Dial
          label="threshold"
          value={values.listening.threshold}
          min={0}
          max={0.3}
          step={0.005}
          onChange={(v) => setListening("threshold", v)}
        />
        <Dial
          label="release"
          value={values.listening.releaseMs}
          min={0}
          max={1000}
          step={10}
          onChange={(v) => setListening("releaseMs", v)}
        />
      </div>
      <pre ref={readoutRef} className="whitespace-pre-wrap text-zinc-500" />
      <pre className="whitespace-pre-wrap rounded bg-zinc-100 p-1.5 select-all">
        {JSON.stringify(values)}
      </pre>
    </div>
  );
}
