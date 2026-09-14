// Dev-only tools for the real app's voice layer (VoiceStage.tsx). VoiceStage
// calls into this module only behind `process.env.NODE_ENV !== "production"`,
// so in a production build none of it runs and nothing reaches `window`.
//
// window.__riffVoiceEngine: the engine, for evidence evals.
// window.__riffVoiceFeed(frames, { role = "riff", frameMs = 1000/60, hold }):
//   plays 1024-bin frequency frames through a role's level source (and the
//   listening gate, for "human"), one per frameMs; `hold` keeps the last
//   frame until __riffVoiceFeed.stop(role). __riffVoiceFeed.synthetic(s)
//   builds SYNTHETIC speech-like frames (labeled "synthetic").
// window.__riffVoicePerf(ms = 5000, { timing = true }): rAF interval p50/p95,
//   rAF requests made by the page, and how often the engine loop was awake.
//   A headless run is a proxy only. { timing: false } skips the sampler's own
//   rAF loop, for counting idle frames.
// window.__riffVoiceReadout(): what the engine last read per role.
import type { LevelBuffer, VoiceLabEngine } from "@/lib/voiceLab/engine";
import { computeBands } from "@/lib/voiceLab/constants";
import {
  calibrateLevels,
  hasLevels,
  type LevelCalibration,
} from "@/lib/voiceLab/tuning";
import type { Role } from "@/lib/voiceLab/types";
import {
  inputLevel,
  percentile,
  syntheticSpeechFrames,
  toLevelFrame,
  type RoleReadout,
  type TalkGate,
  type VoiceReadout,
} from "@/lib/voiceStage";

type Feed = {
  frames: Uint8Array[];
  start: number;
  frameMs: number;
  hold: boolean;
};

export type DevState = {
  feeds: Record<Role, Feed | null>;
  readout: Record<Role, RoleReadout>;
};

function emptyReadout(): RoleReadout {
  return { live: false, input: 0, level: 0, bands: [0, 0, 0, 0, 0] };
}

export function createDevState(): DevState {
  return {
    feeds: { human: null, riff: null },
    readout: { human: emptyReadout(), riff: emptyReadout() },
  };
}

// The fed frame for a role at this instant, or null once a feed has ended.
export function feedFrame(dev: DevState, role: Role): Uint8Array | null {
  const f = dev.feeds[role];
  if (!f) return null;
  const i = Math.floor((performance.now() - f.start) / f.frameMs);
  if (i < f.frames.length) return f.frames[i];
  if (f.hold) return f.frames[f.frames.length - 1];
  dev.feeds[role] = null;
  return null;
}

const readoutScratch = new Uint8Array(1024);

// Mirrors the engine's level path (calibration, then band smoothing) for the
// readout; the talk blend the engine applies on top is not included.
export function updateReadout(
  dev: DevState,
  role: Role,
  buf: LevelBuffer | null,
  cal: LevelCalibration,
) {
  const r = dev.readout[role];
  if (!hasLevels(buf)) {
    r.live = false;
    return;
  }
  r.live = true;
  r.input = inputLevel(buf);
  r.bands = computeBands(calibrateLevels(buf, readoutScratch, cal), r.bands);
  r.level = r.bands.reduce((a, b) => a + b, 0) / r.bands.length;
}

export function readVoice(
  engine: VoiceLabEngine,
  dev: DevState,
  gate: TalkGate,
): VoiceReadout {
  return {
    human: { ...dev.readout.human, bands: [...dev.readout.human.bands] },
    riff: { ...dev.readout.riff, bands: [...dev.readout.riff.bands] },
    talking: gate.talking,
    state: engine.getVoiceState(),
  };
}

type FeedOptions = { role?: Role; frameMs?: number; hold?: boolean };

type FeedResult = { role: Role; frames: number; label: string };

type PerfReport = {
  label: string;
  ms: number;
  frames: number;
  p50: number;
  p95: number;
  max: number;
  rafRequests: number;
  engineAwakePct: number;
  longTasks: number;
};

type DevWindow = {
  __riffVoiceEngine?: VoiceLabEngine;
  __riffVoiceFeed?: ((
    frames: ArrayLike<ArrayLike<number>> & { label?: string },
    opts?: FeedOptions,
  ) => Promise<FeedResult>) & {
    synthetic: (seconds?: number, seed?: number) => Uint8Array[];
    stop: (role?: Role) => void;
  };
  __riffVoicePerf?: (
    ms?: number,
    opts?: { timing?: boolean },
  ) => Promise<PerfReport>;
  __riffVoiceReadout?: () => VoiceReadout;
};

// Installs the window hooks; returns their cleanup.
export function installDevTools(
  engine: VoiceLabEngine,
  dev: DevState,
  gate: TalkGate,
): () => void {
  const w = window as unknown as DevWindow;
  const feed = Object.assign(
    (
      frames: ArrayLike<ArrayLike<number>> & { label?: string },
      opts: FeedOptions = {},
    ): Promise<FeedResult> => {
      const role = opts.role ?? "riff";
      const list = Array.from(frames, (f) => toLevelFrame(f));
      const frameMs = opts.frameMs ?? 1000 / 60;
      const label = frames.label ?? "injected";
      if (list.length === 0) {
        dev.feeds[role] = null;
        return Promise.resolve({ role, frames: 0, label });
      }
      dev.feeds[role] = {
        frames: list,
        start: performance.now(),
        frameMs,
        hold: !!opts.hold,
      };
      engine.wake();
      const ms = opts.hold ? 0 : list.length * frameMs + 50;
      return new Promise((resolve) =>
        setTimeout(() => resolve({ role, frames: list.length, label }), ms),
      );
    },
    {
      synthetic: (seconds = 4, seed = 1) =>
        Object.assign(syntheticSpeechFrames(seconds, 60, seed), {
          label: "synthetic",
        }),
      stop: (role?: Role) => {
        if (!role || role === "human") dev.feeds.human = null;
        if (!role || role === "riff") dev.feeds.riff = null;
        engine.wake();
      },
    },
  );
  w.__riffVoiceEngine = engine;
  w.__riffVoiceFeed = feed;
  w.__riffVoicePerf = (ms, opts) => samplePerf(engine, ms, opts);
  w.__riffVoiceReadout = () => readVoice(engine, dev, gate);
  return () => {
    delete w.__riffVoiceEngine;
    delete w.__riffVoiceFeed;
    delete w.__riffVoicePerf;
    delete w.__riffVoiceReadout;
    dev.feeds.human = null;
    dev.feeds.riff = null;
  };
}

async function samplePerf(
  engine: VoiceLabEngine,
  ms = 5000,
  opts: { timing?: boolean } = {},
): Promise<PerfReport> {
  const timing = opts.timing ?? true;
  const raf = window.requestAnimationFrame.bind(window);
  let rafRequests = 0;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafRequests++;
    return raf(cb);
  }) as typeof window.requestAnimationFrame;
  let longTasks = 0;
  const po = PerformanceObserver.supportedEntryTypes?.includes("longtask")
    ? new PerformanceObserver((list) => {
        longTasks += list.getEntries().length;
      })
    : null;
  po?.observe({ type: "longtask" });

  const deltas: number[] = [];
  let samples = 0;
  let awake = 0;
  const end = performance.now() + ms;
  try {
    await new Promise<void>((resolve) => {
      if (timing) {
        let last = 0;
        const tick = (t: number) => {
          if (last) deltas.push(t - last);
          last = t;
          samples++;
          if (!engine.isSleeping) awake++;
          if (t < end) raf(tick);
          else resolve();
        };
        raf(tick);
      } else {
        const id = setInterval(() => {
          samples++;
          if (!engine.isSleeping) awake++;
        }, 100);
        setTimeout(() => {
          clearInterval(id);
          resolve();
        }, ms);
      }
    });
  } finally {
    window.requestAnimationFrame = raf;
    po?.disconnect();
  }
  deltas.sort((a, b) => a - b);
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    label: "headless proxy (not Sean's Chrome)",
    ms,
    frames: deltas.length,
    p50: round(percentile(deltas, 0.5)),
    p95: round(percentile(deltas, 0.95)),
    max: round(deltas[deltas.length - 1] ?? 0),
    rafRequests,
    engineAwakePct: Math.round((100 * awake) / Math.max(1, samples)),
    longTasks,
  };
}
