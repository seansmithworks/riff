import type { VoiceLabEngine } from "./engine";

// Thin start/stop/onRunningChange wrapper around the engine's own
// SequencePlayer (sequence.ts). This used to run a hardcoded demo script;
// that script is now just "Hard Cut" (preset 1), so the same UI surface
// (Voice/Sequence panel play toggle, S/L manual overrides) keeps working
// unchanged while every preset drives through the same data-driven player.
export class Autoplay {
  running = false;
  private onChange: ((running: boolean) => void) | null = null;

  constructor(private engine: VoiceLabEngine) {}

  onRunningChange(cb: (running: boolean) => void) {
    this.onChange = cb;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.engine.playSequence();
    this.onChange?.(true);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.engine.pauseSequence();
    this.onChange?.(false);
  }
}
