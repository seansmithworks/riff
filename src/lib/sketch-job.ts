"use client";

// One sketch job runner for both render_artifact paths (voice in
// useVoice.ts, text in CopilotPanel.tsx). It reads /api/generate's NDJSON
// stream and writes the draft into the store as objects close
// (docs/plans/riff-real-stream.html, Step 4).
//
// Newest wins globally: one canvas shows one stream, so starting a job
// aborts the previous job's fetch and marks it superseded, whichever path
// started either job.

import type { Artifact, OutlineEntry, Screen } from "./artifact";
import { pendingFromSuperseded, type StreamEvent } from "./artifact-stream";
import { nextJobId, useStore } from "./store";

export type SketchSource = "voice" | "text";

export type SketchResult =
  | { status: "done"; artifact: Artifact }
  | { status: "superseded" }
  | { status: "failed"; error: string };

export type SketchJob = { id: number; done: Promise<SketchResult> };

/** Dev only; the route ignores both in production. */
export type SketchDevOptions = {
  replay?: string;
  truncateAfterScreens?: number;
};

type ServerEvent =
  | { type: "start"; t: number }
  | (StreamEvent & { t: number })
  | { type: "done"; t: number; artifact: Artifact; model: string }
  | { type: "error"; t: number; message: string };

type RunningJob = {
  id: number;
  controller: AbortController;
  /** Pending screens this job's request carried. */
  pendingScreens: OutlineEntry[];
  outline: OutlineEntry[] | null;
  closed: Screen[];
  /** performance.now() at the call; the [sketch] line counts from here. */
  t0: number;
  times: { head?: number; ink?: number; s1?: number };
  markNames: string[];
};

let running: RunningJob | null = null;

function jobLabel(brief: string): string {
  const words = brief.trim().split(/\s+/).slice(0, 6).join(" ");
  return brief.trim().split(/\s+/).length > 6 ? `${words}…` : words;
}

// What a superseded job planned but never landed. Before its head, the job
// had no outline of its own, so the entries it inherited carry forward.
function carriedPending(job: RunningJob): OutlineEntry[] {
  return job.outline
    ? pendingFromSuperseded(job.outline, job.closed)
    : job.pendingScreens;
}

function elapsed(job: RunningJob): number {
  return Math.round(performance.now() - job.t0);
}

function mark(job: RunningJob, name: string) {
  performance.mark(name, { detail: { jobId: job.id } });
  job.markNames.push(name);
}

/**
 * `sketch:first-ink`: the canvas calls this when the job's first element
 * stroke starts drawing (InkScope.tsx). Ink from a job that is no longer
 * running doesn't count.
 */
export function markFirstInk(jobId: number): void {
  const job = running;
  if (job?.id !== jobId || job.times.ink !== undefined) return;
  job.times.ink = elapsed(job);
  mark(job, "sketch:first-ink");
}

export function startSketchJob({
  brief,
  artifactKind,
  source,
  dev,
}: {
  brief: string;
  artifactKind: Artifact["kind"];
  source: SketchSource;
  dev?: SketchDevOptions;
}): SketchJob {
  const store = useStore.getState();
  const id = nextJobId();
  const base = store.artifact;

  const previous = running;
  const pendingScreens = previous ? carriedPending(previous) : [];
  if (previous) {
    running = null;
    store.updateJobStatus(previous.id, "superseded");
    previous.controller.abort();
  }

  const job: RunningJob = {
    id,
    controller: new AbortController(),
    pendingScreens,
    outline: null,
    closed: [],
    t0: performance.now(),
    times: {},
    markNames: [],
  };
  running = job;
  store.addJob({
    id,
    label: jobLabel(brief),
    status: "sketching",
    isEvolve: base !== null,
  });

  const done = run(job, {
    brief: `${brief}\n\nRender this as a ${artifactKind}.`,
    base,
    unfinishedFirstSketch: base !== null && store.firstSketchUnfinished,
    source,
    dev,
  });
  return { id, done };
}

async function run(
  job: RunningJob,
  {
    brief,
    base,
    unfinishedFirstSketch,
    source,
    dev,
  }: {
    brief: string;
    base: Artifact | null;
    unfinishedFirstSketch: boolean;
    source: SketchSource;
    dev?: SketchDevOptions;
  },
): Promise<SketchResult> {
  const store = useStore.getState();
  const isCurrent = () => running === job;
  const { times } = job;

  const finish = (result: SketchResult): SketchResult => {
    if (isCurrent()) running = null;
    if (result.status === "done") mark(job, "sketch:done");
    const extra = result.status === "failed" ? ` (${result.error})` : "";
    console.log(
      `[sketch] job ${job.id} ${source} ${base ? "evolve" : "initial"}${dev?.replay ? ` replay:${dev.replay}` : ""}${job.pendingScreens.length ? ` pending ${job.pendingScreens.map((e) => e.id).join(",")}` : ""}${unfinishedFirstSketch ? " unfinished-first-sketch" : ""} ${result.status} head ${times.head ?? "-"}ms first-ink ${times.ink ?? "-"}ms s1 ${times.s1 ?? "-"}ms screens ${job.closed.length} end ${elapsed(job)}ms${extra}`,
    );
    for (const name of job.markNames) performance.clearMarks(name);
    return result;
  };

  // Voids everything a terminal failure leaves behind, unless a newer job
  // has taken over (then its own events own the draft).
  const fail = (error: string): SketchResult => {
    if (!isCurrent()) return finish({ status: "superseded" });
    store.updateJobStatus(job.id, "failed");
    useStore.getState().clearSketch();
    return finish({ status: "failed", error });
  };

  const apply = (event: ServerEvent): SketchResult | null => {
    switch (event.type) {
      case "head":
        times.head ??= elapsed(job);
        mark(job, "sketch:first-outline");
        job.outline = event.outline;
        useStore.getState().sketchHead(job.id, base, event);
        return null;
      case "element":
        useStore.getState().sketchElement(job.id, event);
        return null;
      case "screen":
        times.s1 ??= elapsed(job);
        mark(job, `sketch:screen:${event.screen.id}`);
        job.closed.push(event.screen);
        useStore.getState().sketchScreen(job.id, event);
        return null;
      case "done":
        if (isCurrent()) {
          useStore.getState().sketchDone(event.artifact);
          store.updateJobStatus(job.id, "done");
        }
        return finish({ status: "done", artifact: event.artifact });
      case "error":
        return fail(event.message);
      default:
        return null;
    }
  };

  mark(job, "sketch:call");
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify({
        brief,
        currentArtifact: base ?? undefined,
        pendingScreens: job.pendingScreens.length
          ? job.pendingScreens
          : undefined,
        unfinishedFirstSketch: unfinishedFirstSketch || undefined,
        ...dev,
      }),
      signal: job.controller.signal,
    });
    if (!res.ok || !res.body) {
      return fail(`generate request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (!isCurrent()) return finish({ status: "superseded" });
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const result = apply(JSON.parse(line) as ServerEvent);
        if (result) return result;
      }
      if (done) return fail("stream ended without a result");
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// Dev-only console hook: __riffSketch("a dog walking app", "wireframe",
// { replay: "R2-1" }). Replay streams a saved spike run with its timing.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (
    window as unknown as {
      __riffSketch?: (
        brief: string,
        kind: Artifact["kind"],
        opts?: SketchDevOptions,
      ) => SketchJob;
    }
  ).__riffSketch = (brief, kind, opts) =>
    startSketchJob({ brief, artifactKind: kind, source: "text", dev: opts });
}
