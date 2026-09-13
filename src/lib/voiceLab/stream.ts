// Stream prototype (progressive-sketch research, options A+B; Sean
// 2026-09-13: steady pen, pencil guesses not yet). Today a sketch job lands
// as one batch: blank, then every frame at once. The stream fakes the
// recommended real pipeline instead: at `outlineMs` every frame shows its
// pencil outline (the outline head, B), then each frame inks when its part
// of the artifact closes (A), in schema order, drawn by one hand.
//
// Pure scheduling math. engine.ts owns the clock, latches this at job start,
// and draws each frame through build.ts's planBuild + mergeBuildPlan.

export type StreamMode = "batch" | "stream";
export type StreamPace = "steady" | "bursts";

export type StreamConfig = {
  mode: StreamMode;
  pace: StreamPace;
  // Steady pen: the longest the pen may sit idle waiting for the next part.
  bufferMs: number;
  // Outline head arrival, ms after job start.
  outlineMs: number;
  // Per-frame arrival (that frame's part closes), ms after job start, in
  // schema order — frames sorted by x, the order planBuild inks them.
  arriveMs: number[];
};

export type StreamSchedule = {
  outlineMs: number;
  // Per frame, schema order: when that frame's part arrives (monotone).
  arriveMs: number[];
  // Per frame, schema order: when that frame's ink starts, ms after job start.
  inkStartMs: number[];
  // Build-timeline multiplier for planBuild (1 = the lab's normal draw speed).
  tempo: number;
};

export function streamLabel(cfg: Pick<StreamConfig, "mode" | "pace">): string {
  return cfg.mode === "batch" ? "batch" : `A+B · ${cfg.pace}`;
}

// `spans`: each frame's own build span at tempo 1 (build.ts#frameBuildMs).
//
// bursts: a frame inks at normal speed the moment its part arrives.
// steady: ink starts at the first arrival and runs at one constant tempo —
//   the fastest (never above normal speed) at which the pen, having drawn
//   frames 0..i, is never idle more than bufferMs before frame i+1 arrives.
//   A frame never starts before it arrives (the pen can't outrun the
//   stream) or before the previous frame finishes (one hand).
// Reduced motion has no pen to pace: frames crossfade in as they arrive.
export function planStreamSchedule(
  cfg: StreamConfig,
  spans: number[],
  reducedMotion: boolean,
): StreamSchedule {
  const n = spans.length;
  // Parts close in schema order, so a later frame can't arrive before an
  // earlier one, whatever the dials say.
  const arrive: number[] = [];
  let prev = 0;
  for (let i = 0; i < n; i++) {
    prev = Math.max(prev, cfg.arriveMs[Math.min(i, cfg.arriveMs.length - 1)] ?? 0);
    arrive.push(prev);
  }
  const outlineMs = n > 0 ? Math.min(cfg.outlineMs, arrive[0]) : cfg.outlineMs;
  if (cfg.pace === "bursts" || reducedMotion || n === 0)
    return { outlineMs, arriveMs: arrive, inkStartMs: [...arrive], tempo: 1 };

  let rate = 1;
  let drawn = 0;
  for (let i = 0; i < n - 1; i++) {
    drawn += spans[i];
    const idleWindow = arrive[i + 1] - arrive[0] - Math.max(0, cfg.bufferMs);
    if (idleWindow > 0 && drawn > 0) rate = Math.min(rate, drawn / idleWindow);
  }
  const tempo = 1 / rate;
  const inkStartMs: number[] = [];
  let penFree = arrive[0];
  for (let i = 0; i < n; i++) {
    const start = Math.max(arrive[i], penFree);
    inkStartMs.push(start);
    penFree = start + spans[i] * tempo;
  }
  return { outlineMs, arriveMs: arrive, inkStartMs, tempo };
}
