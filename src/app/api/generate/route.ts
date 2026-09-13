import { NextRequest, NextResponse } from "next/server";
import {
  generateArtifact,
  MODEL_ID,
  streamArtifact,
  type ModelTaggedError,
} from "@/lib/generate";
import { logGeneration } from "@/lib/braintrust";
import type { Artifact, OutlineEntry, Screen } from "@/lib/artifact";
import { mergeDraft } from "@/lib/artifact-stream";

type GenerateBody = {
  brief?: string;
  currentArtifact?: Artifact;
  artifact_kind?: Artifact["kind"];
  pendingScreens?: OutlineEntry[];
  unfinishedFirstSketch?: boolean;
  // Dev only, ignored in production.
  replay?: string;
  truncateAfterScreens?: number;
};

// Requests that send `Accept: application/x-ndjson` get the stream. Voice
// and text both send it, via sketch-job.ts. The one-shot JSON response below
// remains for any other caller.
const NDJSON = "application/x-ndjson";

// Covers STREAM_HARD_CAP_MS (45s, generate.ts) plus headroom; makes the
// function's limit explicit instead of relying on the platform default.
export const maxDuration = 60;

// Client-controlled input (brief, currentArtifact, pendingScreens) is
// unbounded otherwise; 64 KB comfortably covers real artifacts (measured:
// docs/evidence/artifact-after.json, the largest committed fixture, is
// ~7.2 KB) plus a realistic brief.
const MAX_BODY_BYTES = 64 * 1024;
// Evolve screen cap (see WIREFRAME_SCREEN_COUNT_RULE_EVOLVE in generate.ts).
const MAX_PENDING_SCREENS = 6;

export async function POST(req: NextRequest) {
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 },
    );
  }

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 },
    );
  }

  let body: GenerateBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const { brief, currentArtifact, artifact_kind } = body;

  if (!brief || typeof brief !== "string" || !brief.trim()) {
    return NextResponse.json(
      { error: "Missing required field: brief" },
      { status: 400 },
    );
  }

  if (body.pendingScreens && body.pendingScreens.length > MAX_PENDING_SCREENS) {
    return NextResponse.json(
      {
        error: `pendingScreens exceeds the ${MAX_PENDING_SCREENS}-screen limit`,
      },
      { status: 400 },
    );
  }

  if (req.headers.get("accept")?.includes(NDJSON)) {
    return streamResponse(req, { ...body, brief });
  }

  const start = Date.now();
  try {
    const { artifact, model } = await generateArtifact({
      brief,
      currentArtifact,
    });
    const durationMs = Date.now() - start;
    console.log(`[api/generate] artifact generated in ${durationMs}ms`);
    logGeneration({
      brief,
      artifactKind: artifact.kind,
      artifact,
      model,
      latencyMs: durationMs,
    });
    return NextResponse.json({ artifact }, { status: 200 });
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[api/generate] failed after ${durationMs}ms: ${message}`);
    logGeneration({
      brief,
      artifactKind: artifact_kind ?? currentArtifact?.kind ?? "wireframe",
      model: (err as ModelTaggedError)?.modelId ?? MODEL_ID,
      latencyMs: durationMs,
      error: err,
    });
    return NextResponse.json(
      { error: `Artifact generation failed: ${message}` },
      { status: 500 },
    );
  }
}

// NDJSON, one event per line: start | head | element | screen | done | error,
// each stamped with `t` (ms since the request started). done carries the
// server's merged, validated artifact. A client disconnect aborts the
// Fireworks read.
function streamResponse(
  req: NextRequest,
  body: GenerateBody & { brief: string },
): Response {
  const { brief, currentArtifact, artifact_kind } = body;
  const dev = process.env.NODE_ENV !== "production";
  const start = Date.now();
  const since = () => Date.now() - start;
  const cancelled = new AbortController();
  const signal = AbortSignal.any([req.signal, cancelled.signal]);
  const encoder = new TextEncoder();
  let open = true;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: object) => {
        if (!open) return;
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ ...event, t: since() })}\n`),
        );
      };

      void (async () => {
        let headAt: number | null = null;
        let firstScreenAt: number | null = null;
        let outline: OutlineEntry[] = [];
        const closed: Screen[] = [];
        const loggedUnmatched = new Set<string>();

        send({ type: "start" });
        try {
          for await (const event of streamArtifact({
            brief,
            currentArtifact,
            pendingScreens: body.pendingScreens,
            unfinishedFirstSketch: body.unfinishedFirstSketch,
            signal,
            replay: dev ? body.replay : undefined,
            truncateAfterScreens: dev ? body.truncateAfterScreens : undefined,
          })) {
            if (event.type === "head") {
              headAt ??= since();
              outline = event.outline;
            } else if (event.type === "screen") {
              firstScreenAt ??= since();
              closed.push(event.screen);
              for (const id of mergeDraft(currentArtifact, outline, closed)
                .unmatched) {
                if (loggedUnmatched.has(id)) continue;
                loggedUnmatched.add(id);
                console.log(`[stream] unmatched screen id ${id}`);
              }
            } else if (event.type === "done") {
              const durationMs = since();
              console.log(
                `[api/generate] head ${headAt ?? "-"}ms s1 ${firstScreenAt ?? "-"}ms done ${durationMs}ms model ${event.model.split("/").pop()} chunks ${event.chunks}${event.fallback ? " (fallback: generateArtifact)" : ""}`,
              );
              logGeneration({
                brief,
                artifactKind: event.artifact.kind,
                artifact: event.artifact,
                model: event.model,
                latencyMs: durationMs,
              });
            }
            send(event);
          }
        } catch (err) {
          const durationMs = since();
          const aborted = signal.aborted;
          const message = aborted
            ? "aborted by client"
            : err instanceof Error
              ? err.message
              : String(err);
          console.log(
            aborted
              ? `[api/generate] aborted by client after ${durationMs}ms`
              : `[api/generate] stream failed after ${durationMs}ms: ${message}`,
          );
          logGeneration({
            brief,
            artifactKind: artifact_kind ?? currentArtifact?.kind ?? "wireframe",
            model: (err as ModelTaggedError)?.modelId ?? MODEL_ID,
            latencyMs: durationMs,
            error: aborted ? new Error(message) : err,
          });
          send({
            type: "error",
            message: `Artifact generation failed: ${message}`,
          });
        } finally {
          if (open) {
            open = false;
            controller.close();
          }
        }
      })();
    },
    cancel(reason) {
      open = false;
      cancelled.abort(reason ?? new Error("response stream cancelled"));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": `${NDJSON}; charset=utf-8`,
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
