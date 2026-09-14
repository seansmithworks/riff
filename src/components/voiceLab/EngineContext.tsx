"use client";

import { createContext, useContext } from "react";
import type { VoiceLabEngine } from "@/lib/voiceLab/engine";
import type { Autoplay } from "@/lib/voiceLab/autoplay";

export type EngineHandle = {
  engine: VoiceLabEngine;
  autoplay: Autoplay;
};

// Null until the canvas mounts and the engine is constructed. Panels read
// this via useEngine() and write directly into engine.config in effects —
// the render loop itself never touches React state.
export const EngineContext = createContext<EngineHandle | null>(null);

export function useEngine(): EngineHandle | null {
  return useContext(EngineContext);
}
