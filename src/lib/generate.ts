// Artifact generation — turns a spoken design brief into structured
// wireframe/flow JSON via Fireworks AI's OpenAI-compatible chat completions.

import { ARTIFACT_JSON_SCHEMA, type Artifact } from "./artifact";

const FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

// Primary model per Fireworks' current fast-structured-output list.
// Fallback (e.g. if the primary is unavailable): "accounts/fireworks/models/gpt-oss-120b".
export const MODEL_ID = "accounts/fireworks/models/glm-5p1";
export const FALLBACK_MODEL_ID = "accounts/fireworks/models/gpt-oss-120b";

const SCHEMA_STRING = JSON.stringify(ARTIFACT_JSON_SCHEMA);

const WIREFRAME_SCREEN_COUNT_RULE_INITIAL =
  "For wireframes: produce EXACTLY 3 screens. Only include the screens the brief actually supports — never invent screens the brief doesn't call for.";
const WIREFRAME_SCREEN_COUNT_RULE_EVOLVE =
  "For wireframes: only include the screens the brief actually supports — never invent screens the brief doesn't call for.";

function buildSystemPrompt(isEvolve: boolean): string {
  const wireframeRule = isEvolve
    ? WIREFRAME_SCREEN_COUNT_RULE_EVOLVE
    : WIREFRAME_SCREEN_COUNT_RULE_INITIAL;

  return `You are a senior product designer producing low-fidelity design artifacts as JSON for a live wireframing tool.

Rules:
- ${wireframeRule}
- Use realistic, specific copy in labels/headings/list items/card text. Never use lorem ipsum or placeholders like "Label here" or "Item 1".
- Design mobile-first: each screen's elements form a single vertical stack, top to bottom.
- Use the element vocabulary deliberately: "searchbar" + "list" for browsing content, "card" for summaries, "row" for paired buttons (e.g. secondary + primary action), "tabbar" when the app has 3+ top-level sections.
- For flows: produce 6-12 nodes with meaningful decision branches (not just a straight line) — model real forks like "already has account?" or "payment failed?".
- If a "CURRENT ARTIFACT" is provided in the user message, EVOLVE it rather than starting over: keep existing screen/node ids and content stable where they still fit the new brief, and only modify, add, or remove what the new brief actually requires. The goal is that the on-screen canvas visibly refines, not that it flickers to something unrelated.
- Output must strictly conform to this JSON Schema:

${SCHEMA_STRING}

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

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function buildRequestBody(messages: ChatMessage[], modelId: string = MODEL_ID) {
  return {
    model: modelId,
    messages,
    temperature: 0.4,
    max_tokens: 4000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "Artifact",
        // Fireworks requires a top-level "type" field on the schema; the
        // canonical ARTIFACT_JSON_SCHEMA (artifact.ts) is a bare `anyOf` of
        // two object schemas, so add it here without altering the contract.
        schema: { ...ARTIFACT_JSON_SCHEMA, type: "object" },
      },
    },
  };
}

function validateArtifact(value: unknown): value is Artifact {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "wireframe") {
    return Array.isArray(v.screens) && v.screens.length > 0;
  }
  if (v.kind === "flow") {
    return (
      Array.isArray(v.nodes) &&
      v.nodes.length > 0 &&
      Array.isArray(v.edges) &&
      v.edges.length > 0
    );
  }
  return false;
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
): Promise<string> {
  const res = await fetch(FIREWORKS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRequestBody(messages, modelId)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

async function callFireworks(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    throw new Error("FIREWORKS_API_KEY is not set");
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const modelId = attempt === MAX_ATTEMPTS ? FALLBACK_MODEL_ID : MODEL_ID;
    try {
      return await callFireworksOnce(messages, apiKey, modelId);
    } catch (err) {
      lastError = err;

      // Retryable: thrown network errors (incl. timeout/abort, e.g. the
      // IPv6-related "fetch failed" seen on this machine) have no HTTP
      // status; 429/503 are Fireworks' own overload signals. Any other
      // 4xx is our bug — retrying just burns demo seconds.
      const status = err instanceof FireworksHttpError ? err.status : undefined;
      const retryable =
        status === undefined || status === 429 || status === 503;

      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw err;
      }

      const nextAttempt = attempt + 1;
      const reason =
        status === 429
          ? "HTTP 429"
          : status === 503
            ? "HTTP 503"
            : "network error";
      const fallbackNote =
        nextAttempt === MAX_ATTEMPTS
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
  }

  throw lastError;
}

export async function generateArtifact({
  brief,
  currentArtifact,
}: {
  brief: string;
  currentArtifact?: Artifact;
}): Promise<Artifact> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(Boolean(currentArtifact)) },
    { role: "user", content: buildUserMessage(brief, currentArtifact) },
  ];

  const firstContent = await callFireworks(messages);

  try {
    const parsed = JSON.parse(firstContent);
    if (!validateArtifact(parsed)) {
      throw new Error(
        "Artifact failed validation: missing/empty kind-specific arrays",
      );
    }
    return parsed;
  } catch (err) {
    // One retry: append the failed response + error, ask the model to fix it.
    const errorMessage = err instanceof Error ? err.message : String(err);
    messages.push({ role: "assistant", content: firstContent });
    messages.push({
      role: "user",
      content: `That response was invalid: ${errorMessage}. Respond again with ONLY valid JSON strictly matching the schema.`,
    });

    const retryContent = await callFireworks(messages);
    const parsed = JSON.parse(retryContent);
    if (!validateArtifact(parsed)) {
      throw new Error(
        "Artifact failed validation on retry: missing/empty kind-specific arrays",
      );
    }
    return parsed;
  }
}

// Exposed for dry-run/debugging without making a network call.
export function buildRequestBodyForBrief(
  brief: string,
  currentArtifact?: Artifact,
) {
  return buildRequestBody([
    { role: "system", content: buildSystemPrompt(Boolean(currentArtifact)) },
    { role: "user", content: buildUserMessage(brief, currentArtifact) },
  ]);
}
