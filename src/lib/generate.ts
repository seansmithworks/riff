// Artifact generation — turns a spoken design brief into structured
// wireframe/flow JSON via Fireworks AI's OpenAI-compatible chat completions.

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ARTIFACT_JSON_SCHEMA,
  ARTIFACT_STREAM_JSON_SCHEMA,
  validateArtifact,
  type Artifact,
  type OutlineEntry,
  type Screen,
} from "./artifact";
import {
  createClosedObjectTracker,
  mergeDraft,
  type StreamEvent,
} from "./artifact-stream";

const FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

// Primary model per Fireworks' current fast-structured-output list.
// Fallback (e.g. if the primary is unavailable): "accounts/fireworks/models/gpt-oss-120b".
export const MODEL_ID = "accounts/fireworks/models/glm-5p2";
export const FALLBACK_MODEL_ID = "accounts/fireworks/models/gpt-oss-120b";

const SCHEMA_STRING = JSON.stringify(ARTIFACT_JSON_SCHEMA);
const STREAM_SCHEMA_STRING = JSON.stringify(ARTIFACT_STREAM_JSON_SCHEMA);

const WIREFRAME_SCREEN_COUNT_RULE_INITIAL =
  "For wireframes: produce EXACTLY 3 screens. Only include the screens the brief actually supports — never invent screens the brief doesn't call for.";
const WIREFRAME_SCREEN_COUNT_RULE_EVOLVE =
  "For wireframes: only include the screens the brief actually supports — never invent screens the brief doesn't call for. Keep the wireframe to at most 6 screens; when the brief adds content, extend existing screens before adding new ones.";
// A supersede can land before a first sketch reaches done; the next request
// must still finish at 3 screens instead of shrinking to what landed.
const WIREFRAME_SCREEN_COUNT_RULE_UNFINISHED = `${WIREFRAME_SCREEN_COUNT_RULE_INITIAL} The CURRENT ARTIFACT is an unfinished first sketch: keep the ids of the screens it already has.`;

// Outline rules for the streamed schema, verbatim from the Step 1 bench
// (src/app/api/dev/stream-bench/route.ts OUTLINE_RULES), which passed P5/P6.
const OUTLINE_RULES = `- For wireframes, "outline" lists every screen of the resulting wireframe in display order, one entry per screen: {"id", "name", "status"}. "status" is "new" for a screen that is not in the CURRENT ARTIFACT (every screen when there is no CURRENT ARTIFACT), "keep" for an existing screen whose name and elements stay exactly as they are, and "changed" for an existing screen whose name or any element changes.
- "screens" holds the full content of every outline entry marked "new" or "changed", in outline order. Never put a "keep" screen in "screens": kept screens are reused from the CURRENT ARTIFACT exactly as they are. If the brief affects a screen at all, mark it "changed" and include it in full.
`;

function screenCountRule(isEvolve: boolean): string {
  return isEvolve
    ? WIREFRAME_SCREEN_COUNT_RULE_EVOLVE
    : WIREFRAME_SCREEN_COUNT_RULE_INITIAL;
}

function buildSystemPrompt(
  wireframeRule: string,
  schemaString: string = SCHEMA_STRING,
  outlineRules = "",
): string {
  return `You are a senior product designer producing low-fidelity design artifacts as JSON for a live wireframing tool.

Rules:
- ${wireframeRule}
- Use realistic, specific copy in labels/headings/list items/card text. Never use lorem ipsum or placeholders like "Label here" or "Item 1".
- For wireframes, set "platform" to "desktop" when the brief describes a website, web app, dashboard, admin tool, marketing site, or anything meant for a browser/laptop; otherwise set it to "mobile". If a "CURRENT ARTIFACT" is provided, keep its platform unless the brief explicitly asks to change it.
- Design mobile-first: each screen's elements form a single vertical stack, top to bottom. Exception — desktop platform: screens are wide, so use "navbar" with the site name as the title and 2–4 nav links in its actions, and use "row" to place 2–3 cards or buttons side by side; never use "tabbar" on desktop. The body still reads top-to-bottom within that wide layout.
- Use the full element vocabulary deliberately — most screens should combine several of these, not just searchbar/list/card/row:
  - "navbar" at the top of nearly every screen: a title plus back/action labels for anything that isn't the root tab screen.
  - "searchbar" + "list" for browsing/filtering flat content; set "hasImage" on list items when the content is visually distinguishing (photos, avatars, thumbnails) so browsing reads as media-rich, not just text rows.
  - "card" (with "hasImage" where the content has a hero image) for a single focused summary, e.g. a detail view or a featured item.
  - "image" for a standalone hero/photo that isn't part of a list or card.
  - "avatar" wherever a screen is about a person, profile, or social/collaborative context (e.g. a user's name next to their content, a profile header).
  - "divider" to separate distinct sections on a screen (e.g. above a "Related" section) rather than relying on spacing alone.
  - "row" to group paired buttons (secondary + primary action) or other short horizontal groups.
  - "tabbar" pinned to the bottom when the app has 3+ top-level sections.
  - "heading" / "text" for section titles and short supporting copy between other elements.
  - "button" and "input" for explicit actions and form fields.
  - Pick the elements a real version of this screen would need — don't force one of every type onto a screen that doesn't call for it.
- For flows: produce 6-12 nodes with meaningful decision branches (not just a straight line) — model real forks like "already has account?" or "payment failed?".
- If a "CURRENT ARTIFACT" is provided in the user message, EVOLVE it rather than starting over: keep existing screen/node ids and content stable where they still fit the new brief, and only modify, add, or remove what the new brief actually requires. The goal is that the on-screen canvas visibly refines, not that it flickers to something unrelated.
${outlineRules}- Output must strictly conform to this JSON Schema:

${schemaString}

Respond with ONLY the JSON artifact — no prose, no markdown fences.`;
}

function buildUserMessage(brief: string, currentArtifact?: Artifact): string {
  if (!currentArtifact) {
    return `BRIEF: ${brief}`;
  }
  return `BRIEF: ${brief}\n\nCURRENT ARTIFACT (evolve this, keep stable ids/content that still fits):\n${JSON.stringify(
    currentArtifact,
  )}`;
}

function buildStreamUserMessage(
  brief: string,
  currentArtifact?: Artifact,
  pendingScreens?: OutlineEntry[],
): string {
  const message = buildUserMessage(brief, currentArtifact);
  if (!pendingScreens?.length) return message;
  return `${message}\n\nPENDING SCREENS (outlined by an interrupted sketch but never drawn; include them unless the brief replaces them):\n${JSON.stringify(
    pendingScreens,
  )}`;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function buildRequestBody(
  messages: ChatMessage[],
  modelId: string = MODEL_ID,
  schema:
    | typeof ARTIFACT_JSON_SCHEMA
    | typeof ARTIFACT_STREAM_JSON_SCHEMA = ARTIFACT_JSON_SCHEMA,
) {
  return {
    model: modelId,
    messages,
    temperature: 0.4,
    max_tokens: 8000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "Artifact",
        // Fireworks requires a top-level "type" field on the schema; the
        // canonical ARTIFACT_JSON_SCHEMA (artifact.ts) is a bare `anyOf` of
        // two object schemas, so add it here without altering the contract.
        schema: { ...schema, type: "object" },
      },
    },
  };
}

function buildStreamRequestBody(messages: ChatMessage[], modelId: string) {
  return {
    ...buildRequestBody(messages, modelId, ARTIFACT_STREAM_JSON_SCHEMA),
    stream: true,
    // Spike R1 vs R1b: reasoning off cut glm-5p2's median first content from
    // 1480ms to 420ms. Only measured on the primary, so the fallback keeps
    // its own defaults.
    ...(modelId === MODEL_ID ? { reasoning_effort: "none" } : {}),
  };
}

// A single attempt cannot run longer than this — a live demo can't afford a
// hung connection (one earlier call hung ~70s before failing).
const REQUEST_TIMEOUT_MS = 40_000;

// 1 initial attempt + 2 retries, short backoff between them so a transient
// blip (dead venue wifi, Fireworks overload) doesn't cost real demo time.
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFFS_MS = [400, 1000];

class FireworksHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function callFireworksOnce(
  messages: ChatMessage[],
  apiKey: string,
  modelId: string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Aborted", "AbortError");
  }

  const res = await fetch(FIREWORKS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRequestBody(messages, modelId)),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new FireworksHttpError(
      res.status,
      `Fireworks API error ${res.status}: ${text || res.statusText}`,
    );
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Fireworks API returned no content");
  }
  return content;
}

// Thrown/rethrown errors carry the model id of the attempt that produced
// them, so callers can attribute latency/logging to the right model even
// when the final attempt fell back to FALLBACK_MODEL_ID.
export type ModelTaggedError = Error & { modelId?: string };

// Module-level and sticky for the life of the process: once the primary has
// failed over (5xx or 404 — e.g. retired), every subsequent call skips
// straight to FALLBACK_MODEL_ID instead of re-trying a known-dead primary.
let primaryFailedOver = false;

function modelForAttempt(attempt: number): string {
  return attempt === MAX_ATTEMPTS || primaryFailedOver
    ? FALLBACK_MODEL_ID
    : MODEL_ID;
}

// Shared by the batch and stream paths. Returns the reason to log before a
// retry, or null when the error isn't retryable.
function retryReason(err: unknown, modelId: string): string | null {
  // Retryable: thrown network errors (incl. timeout/abort, e.g. the
  // IPv6-related "fetch failed" seen on this machine) have no HTTP
  // status; 429/503 are Fireworks' own overload signals; 5xx means the
  // provider itself is down, and 404 means the primary model id itself
  // is gone (e.g. retired) — both fall over to FALLBACK_MODEL_ID right
  // away instead of burning retries on a dead endpoint/model. Any other
  // 4xx is our bug — retrying just burns demo seconds.
  const status = err instanceof FireworksHttpError ? err.status : undefined;
  const retryable =
    status === undefined ||
    status === 429 ||
    status === 404 ||
    (status >= 500 && status < 600);

  if (
    status !== undefined &&
    (status === 404 || (status >= 500 && status < 600)) &&
    modelId === MODEL_ID
  ) {
    primaryFailedOver = true;
  }

  if (!retryable) return null;
  return status === undefined ? "network error" : `HTTP ${status}`;
}

async function waitBeforeRetry(attempt: number, reason: string) {
  const nextAttempt = attempt + 1;
  const fallbackNote =
    nextAttempt === MAX_ATTEMPTS || primaryFailedOver
      ? ` (falling back to ${FALLBACK_MODEL_ID})`
      : "";
  console.error(
    `[api/generate] attempt ${nextAttempt} after ${reason}${fallbackNote}`,
  );

  const backoff =
    RETRY_BACKOFFS_MS[attempt - 1] ??
    RETRY_BACKOFFS_MS[RETRY_BACKOFFS_MS.length - 1];
  await new Promise((resolve) => setTimeout(resolve, backoff));
}

async function callFireworks(
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<{ content: string; model: string }> {
  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    throw new Error("FIREWORKS_API_KEY is not set");
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const modelId = modelForAttempt(attempt);
    try {
      const content = await callFireworksOnce(
        messages,
        apiKey,
        modelId,
        signal,
      );
      return { content, model: modelId };
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err;
      lastError = err;

      const reason = retryReason(err, modelId);
      if (reason === null || attempt === MAX_ATTEMPTS) {
        if (err instanceof Error) {
          (err as ModelTaggedError).modelId = modelId;
        }
        throw err;
      }

      await waitBeforeRetry(attempt, reason);
    }
  }

  throw lastError;
}

export async function generateArtifact({
  brief,
  currentArtifact,
  signal,
}: {
  brief: string;
  currentArtifact?: Artifact;
  signal?: AbortSignal;
}): Promise<{ artifact: Artifact; model: string }> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(screenCountRule(Boolean(currentArtifact))),
    },
    { role: "user", content: buildUserMessage(brief, currentArtifact) },
  ];

  const first = await callFireworks(messages, signal);

  try {
    const parsed = JSON.parse(first.content);
    if (!validateArtifact(parsed)) {
      throw new Error(
        "Artifact failed validation: missing/empty kind-specific arrays",
      );
    }
    return { artifact: parsed, model: first.model };
  } catch (err) {
    // One retry: append the failed response + error, ask the model to fix it.
    const errorMessage = err instanceof Error ? err.message : String(err);
    messages.push({ role: "assistant", content: first.content });
    messages.push({
      role: "user",
      content: `That response was invalid: ${errorMessage}. Respond again with ONLY valid JSON strictly matching the schema.`,
    });

    const retry = await callFireworks(messages, signal);
    const parsed = JSON.parse(retry.content);
    if (!validateArtifact(parsed)) {
      const validationError: ModelTaggedError = new Error(
        "Artifact failed validation on retry: missing/empty kind-specific arrays",
      );
      validationError.modelId = retry.model;
      throw validationError;
    }
    return { artifact: parsed, model: retry.model };
  }
}

// ---------------------------------------------------------------------------
// Streaming (docs/plans/riff-real-stream.html, Step 3)

// Both sized from same-day glm-5p2 data (docs/evidence/stream/spike-2026-09-13,
// results.json plus the per-run chunk timestamps beside it):
// - Idle watchdog, reset by every byte from Fireworks. The longest silence in
//   any of the 30 streamed spike runs was 2966ms: R1-2 waiting for its first
//   chunk (reasoning on). Once content flowed, the longest gap between chunks
//   was 1106ms (same run). 3 × 2966ms = 8898ms, rounded to 9s.
// - Hard cap, across all attempts. The slowest done in any spike arm was
//   11675ms (R3-control-2, today's schema rewriting every screen). The
//   slowest real generation on record is the 35.1s prod evolve
//   (docs/evidence/EVOLVE-MOMENT.md, glm-5p1, not streamed).
//   max(2 × 11675ms, 1.25 × 35100ms) = max(23350ms, 43875ms), rounded to 45s.
const STREAM_IDLE_TIMEOUT_MS = 9_000;
const STREAM_HARD_CAP_MS = 45_000;

class StreamTimeoutError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export type StreamArtifactOptions = {
  brief: string;
  currentArtifact?: Artifact;
  /** Outline entries a superseded job planned but never landed. */
  pendingScreens?: OutlineEntry[];
  /** currentArtifact is a first sketch that never reached done. */
  unfinishedFirstSketch?: boolean;
  signal: AbortSignal;
  /** Dev only: stream a saved spike run with its recorded chunk timing. */
  replay?: string;
  /** Dev only: end the stream with an error after this many screens. */
  truncateAfterScreens?: number;
};

export type GenerateStreamEvent =
  | StreamEvent
  | {
      type: "done";
      artifact: Artifact;
      model: string;
      /** The stream's result didn't validate; this came from generateArtifact. */
      fallback: boolean;
      chunks: number;
    };

type StreamCall = {
  model: string;
  chunks: number;
  finishReason: string | null;
};

function sseContent(line: string, call: StreamCall): string {
  if (!line.startsWith("data:")) return "";
  const data = line.slice(5).trim();
  if (data === "[DONE]") return "";
  let event: {
    error?: unknown;
    choices?: {
      finish_reason?: string | null;
      delta?: { content?: string | null };
    }[];
  };
  try {
    event = JSON.parse(data);
  } catch {
    return "";
  }
  if (event.error) {
    throw new Error(
      `Fireworks stream error: ${JSON.stringify(event.error).slice(0, 300)}`,
    );
  }
  const choice = event.choices?.[0];
  if (choice?.finish_reason) call.finishReason = choice.finish_reason;
  const delta = choice?.delta?.content;
  return typeof delta === "string" ? delta : "";
}

// Content deltas from Fireworks. Retry and failover apply only until the
// first content arrives; after that the client has events, so errors end
// the stream.
async function* fireworksContent(
  messages: ChatMessage[],
  signal: AbortSignal,
  call: StreamCall,
): AsyncGenerator<string> {
  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    throw new Error("FIREWORKS_API_KEY is not set");
  }
  const started = Date.now();

  for (let attempt = 1; ; attempt++) {
    if (signal.aborted) throw signal.reason;
    const modelId = modelForAttempt(attempt);
    call.model = modelId;

    const attemptAbort = new AbortController();
    let idle: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(
        () =>
          attemptAbort.abort(
            new StreamTimeoutError(
              `no bytes from Fireworks for ${STREAM_IDLE_TIMEOUT_MS}ms`,
              true,
            ),
          ),
        STREAM_IDLE_TIMEOUT_MS,
      );
    };
    const cap = setTimeout(
      () =>
        attemptAbort.abort(
          new StreamTimeoutError(
            `stream hit the ${STREAM_HARD_CAP_MS}ms hard cap`,
            false,
          ),
        ),
      STREAM_HARD_CAP_MS - (Date.now() - started),
    );
    let clientAbortAt: number | null = null;
    let chunksAtAbort = 0;
    const onClientAbort = () => {
      clientAbortAt = Date.now();
      chunksAtAbort = call.chunks;
      attemptAbort.abort(signal.reason);
    };
    signal.addEventListener("abort", onClientAbort, { once: true });

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let gotContent = false;
    try {
      armIdle();
      const res = await fetch(FIREWORKS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildStreamRequestBody(messages, modelId)),
        signal: attemptAbort.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new FireworksHttpError(
          res.status,
          `Fireworks API error ${res.status}: ${text || res.statusText}`,
        );
      }

      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        armIdle();
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const delta = sseContent(buffer.slice(0, newline).trim(), call);
          buffer = buffer.slice(newline + 1);
          if (delta) {
            gotContent = true;
            call.chunks++;
            yield delta;
          }
        }
      }
      const tail = sseContent(buffer.trim(), call);
      if (tail) {
        call.chunks++;
        yield tail;
      }
      return;
    } catch (err) {
      if (signal.aborted) throw signal.reason ?? err;
      const cause = attemptAbort.signal.aborted
        ? attemptAbort.signal.reason
        : err;
      const reason =
        cause instanceof StreamTimeoutError
          ? cause.retryable
            ? "idle timeout"
            : null
          : retryReason(cause, modelId);
      if (gotContent || reason === null || attempt === MAX_ATTEMPTS) {
        if (cause instanceof Error) {
          (cause as ModelTaggedError).modelId = modelId;
        }
        throw cause;
      }
      await waitBeforeRetry(attempt, reason);
    } finally {
      clearTimeout(idle);
      clearTimeout(cap);
      signal.removeEventListener("abort", onClientAbort);
      reader?.cancel().catch(() => {});
      if (clientAbortAt !== null) {
        console.log(
          `[api/generate] stopped reading Fireworks ${Date.now() - clientAbortAt}ms after client abort (chunks ${chunksAtAbort} at abort, ${call.chunks} at stop)`,
        );
      }
    }
  }
}

// Replay fixtures: committed test fixtures first, then the untracked spike runs.
const REPLAY_DIRS = ["tests/fixtures", "docs/evidence/stream/spike-2026-09-13"];

async function loadReplayChunks(
  name: string,
): Promise<{ t: number; c: string }[]> {
  if (!/^[\w.-]+$/.test(name)) {
    throw new Error(`replay: invalid fixture name "${name}"`);
  }
  for (const dir of REPLAY_DIRS) {
    try {
      const raw = await readFile(
        path.join(process.cwd(), dir, `${name}.json`),
        "utf8",
      );
      return (JSON.parse(raw) as { chunks: { t: number; c: string }[] }).chunks;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  throw new Error(`replay: no fixture "${name}" in ${REPLAY_DIRS.join(", ")}`);
}

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function* replayContent(
  name: string,
  signal: AbortSignal,
  call: StreamCall,
): AsyncGenerator<string> {
  const chunks = await loadReplayChunks(name);
  call.model = `replay:${name}`;
  const started = Date.now();
  for (const chunk of chunks) {
    const wait = started + chunk.t - Date.now();
    if (wait > 0) await sleepUnlessAborted(wait, signal);
    call.chunks++;
    yield chunk.c;
  }
  call.finishReason = "stop";
}

// The streamed JSON merged over the base, as a plain Artifact, or null when
// it doesn't parse or validate.
function finalStreamArtifact(
  content: string,
  base?: Artifact,
): Artifact | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const value = parsed as {
    kind?: unknown;
    title?: unknown;
    platform?: unknown;
    outline?: unknown;
    screens?: unknown;
  } | null;
  if (value?.kind !== "wireframe") {
    return validateArtifact(parsed) ? parsed : null;
  }
  const { slots } = mergeDraft(
    base,
    Array.isArray(value.outline) ? (value.outline as OutlineEntry[]) : [],
    Array.isArray(value.screens) ? (value.screens as Screen[]) : [],
    { final: true },
  );
  const artifact = {
    kind: "wireframe",
    title: value.title,
    platform: value.platform,
    screens: slots.flatMap((slot) => (slot.screen ? [slot.screen] : [])),
  };
  return validateArtifact(artifact) ? artifact : null;
}

/**
 * One streamed generation: head, element and screen events as objects close,
 * then done with the merged, validated artifact. If the streamed result
 * doesn't validate, done carries generateArtifact's result instead (today's
 * batch path with its repair retry). Abort via `signal`.
 */
export async function* streamArtifact({
  brief,
  currentArtifact,
  pendingScreens,
  unfinishedFirstSketch,
  signal,
  replay,
  truncateAfterScreens,
}: StreamArtifactOptions): AsyncGenerator<GenerateStreamEvent> {
  const wireframeRule = unfinishedFirstSketch
    ? WIREFRAME_SCREEN_COUNT_RULE_UNFINISHED
    : screenCountRule(Boolean(currentArtifact));
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(
        wireframeRule,
        STREAM_SCHEMA_STRING,
        OUTLINE_RULES,
      ),
    },
    {
      role: "user",
      content: buildStreamUserMessage(brief, currentArtifact, pendingScreens),
    },
  ];

  const call: StreamCall = { model: MODEL_ID, chunks: 0, finishReason: null };
  const source = replay
    ? replayContent(replay, signal, call)
    : fireworksContent(messages, signal, call);
  const tracker = createClosedObjectTracker();
  let content = "";
  let screens = 0;

  for await (const delta of source) {
    content += delta;
    for (const event of tracker.push(delta)) {
      yield event;
      if (event.type === "screen" && ++screens === truncateAfterScreens) {
        throw new Error(
          `truncateAfterScreens: stream ended after ${screens} screen(s)`,
        );
      }
    }
  }

  const artifact = finalStreamArtifact(content, currentArtifact);
  if (artifact) {
    yield {
      type: "done",
      artifact,
      model: call.model,
      fallback: false,
      chunks: call.chunks,
    };
    return;
  }

  if (signal.aborted) {
    console.error(
      `[api/generate] streamed result invalid (finish_reason ${call.finishReason}); skipping generateArtifact fallback, signal already aborted`,
    );
    return;
  }

  console.error(
    `[api/generate] streamed result invalid (finish_reason ${call.finishReason}); falling back to generateArtifact`,
  );
  const batch = await generateArtifact({ brief, currentArtifact, signal });
  yield {
    type: "done",
    artifact: batch.artifact,
    model: batch.model,
    fallback: true,
    chunks: call.chunks,
  };
}

// Exposed for dry-run/debugging without making a network call.
export function buildRequestBodyForBrief(
  brief: string,
  currentArtifact?: Artifact,
) {
  return buildRequestBody([
    {
      role: "system",
      content: buildSystemPrompt(screenCountRule(Boolean(currentArtifact))),
    },
    { role: "user", content: buildUserMessage(brief, currentArtifact) },
  ]);
}
