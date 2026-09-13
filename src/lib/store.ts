import { create } from "zustand";
import type { Artifact, Element, OutlineEntry, Screen } from "./artifact";
import {
  mergeDraft,
  type StreamEvent,
  type StreamHead,
} from "./artifact-stream";

export type Message = { role: "user" | "assistant"; text: string };
export type Status = "idle" | "listening" | "thinking" | "speaking";
export type JobStatus = "sketching" | "done" | "superseded" | "failed";
export type Job = {
  id: number;
  label: string;
  status: JobStatus;
  /** The job started over an existing artifact. */
  isEvolve: boolean;
};

// Shared across the voice (useVoice.ts) and text (CopilotPanel.tsx)
// render_artifact paths so their job ids never collide in the queue strip.
let jobIdCounter = 0;
export function nextJobId(): number {
  jobIdCounter += 1;
  return jobIdCounter;
}

/**
 * The streamed wireframe draft of the job whose head arrived last
 * (sketch-job.ts). A superseded job's draft stays until the next job's head
 * replaces it; it clears on done or on a terminal error with no newer job.
 * Screens commit to `artifact` as they close. Closed elements are kept per
 * stream screen index so the canvas can ink per screen or per element.
 */
export type Sketch = {
  jobId: number;
  kind: StreamHead["kind"];
  platform: StreamHead["platform"];
  title: string;
  outline: OutlineEntry[];
  /** The committed artifact the job started from. */
  base: Artifact | null;
  /** Closed screens, in close order. */
  closed: Screen[];
  /**
   * Closed top-level elements by stream screen index (screens[i] in the
   * model's output, which lists only new and changed screens), in order.
   */
  elements: Record<number, Element[]>;
  /** Per outline or closed screen id: whether its body differs from base. */
  changed: Record<string, boolean>;
};

type ElementEvent = Extract<StreamEvent, { type: "element" }>;
type ScreenEvent = Extract<StreamEvent, { type: "screen" }>;

function changedById(
  base: Artifact | null,
  outline: OutlineEntry[],
  closed: Screen[],
): Record<string, boolean> {
  return Object.fromEntries(
    mergeDraft(base, outline, closed).slots.map((slot) => [
      slot.id,
      slot.changed,
    ]),
  );
}

interface StoreState {
  artifact: Artifact | null;
  /**
   * `artifact` holds screens committed by a first sketch that never reached
   * done, so the next request must keep the first sketch's screen count.
   */
  firstSketchUnfinished: boolean;
  messages: Message[];
  status: Status;
  jobs: Job[];
  sketch: Sketch | null;
  setArtifact: (artifact: Artifact | null) => void;
  addMessage: (message: Message) => void;
  setStatus: (status: Status) => void;
  addJob: (job: Job) => void;
  updateJobStatus: (id: number, status: JobStatus) => void;
  sketchHead: (jobId: number, base: Artifact | null, head: StreamHead) => void;
  sketchElement: (jobId: number, event: ElementEvent) => void;
  sketchScreen: (jobId: number, event: ScreenEvent) => void;
  sketchDone: (artifact: Artifact) => void;
  clearSketch: () => void;
}

export const useStore = create<StoreState>((set) => ({
  artifact: null,
  firstSketchUnfinished: false,
  messages: [],
  status: "idle",
  jobs: [],
  sketch: null,
  setArtifact: (artifact) => set({ artifact, firstSketchUnfinished: false }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  setStatus: (status) => set({ status }),
  addJob: (job) => set((state) => ({ jobs: [...state.jobs, job] })),
  updateJobStatus: (id, status) =>
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === id ? { ...job, status } : job)),
    })),
  sketchHead: (jobId, base, { kind, platform, title, outline }) =>
    set((state) => {
      const job = state.jobs.find((j) => j.id === jobId);
      if (job?.status !== "sketching") return {};
      return {
        sketch: {
          jobId,
          kind,
          platform,
          title,
          outline,
          base,
          closed: [],
          elements: {},
          changed: changedById(base, outline, []),
        },
      };
    }),
  sketchElement: (jobId, { screenIndex, elementIndex, element }) =>
    set((state) => {
      const sketch = state.sketch;
      if (sketch?.jobId !== jobId) return {};
      const elements = [...(sketch.elements[screenIndex] ?? [])];
      elements[elementIndex] = element;
      return {
        sketch: {
          ...sketch,
          elements: { ...sketch.elements, [screenIndex]: elements },
        },
      };
    }),
  // Commit on close: the draft's drawable slots become the artifact.
  sketchScreen: (jobId, { screen }) =>
    set((state) => {
      const sketch = state.sketch;
      if (sketch?.jobId !== jobId) return {};
      const closed = [...sketch.closed, screen];
      const { slots } = mergeDraft(sketch.base, sketch.outline, closed);
      return {
        sketch: {
          ...sketch,
          closed,
          changed: Object.fromEntries(slots.map((s) => [s.id, s.changed])),
        },
        artifact: {
          kind: "wireframe",
          title: sketch.title,
          platform: sketch.platform,
          screens: slots.flatMap((slot) => (slot.screen ? [slot.screen] : [])),
        },
        firstSketchUnfinished:
          state.firstSketchUnfinished || sketch.base === null,
      };
    }),
  sketchDone: (artifact) =>
    set({ artifact, firstSketchUnfinished: false, sketch: null }),
  clearSketch: () => set({ sketch: null }),
}));
