// Artifact generation — turns a spoken design brief into structured
// wireframe/flow JSON via Fireworks AI's OpenAI-compatible chat completions.

import { ARTIFACT_JSON_SCHEMA, type Artifact } from "./artifact";

const FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

// Primary model per Fireworks' current fast-structured-output list.
// Fallback (e.g. if the primary is unavailable): "accounts/fireworks/models/gpt-oss-20b".
export const MODEL_ID = "accounts/fireworks/models/kimi-k2p5";
export const FALLBACK_MODEL_ID = "accounts/fireworks/models/gpt-oss-20b";

const SCHEMA_STRING = JSON.stringify(ARTIFACT_JSON_SCHEMA);

const SYSTEM_PROMPT = `You are a senior product designer producing low-fidelity design artifacts as JSON for a live wireframing tool.

Rules:
- For wireframes: produce 2-4 screens. Only include the screens the brief actually supports — never invent screens the brief doesn't call for.
- Use realistic, specific copy in labels/headings/list items/card text. Never use lorem ipsum or placeholders like "Label here" or "Item 1".
- Design mobile-first: each screen's elements form a single vertical stack, top to bottom.
- Use the element vocabulary deliberately: "searchbar" + "list" for browsing content, "card" for summaries, "row" for paired buttons (e.g. secondary + primary action), "tabbar" when the app has 3+ top-level sections.
- For flows: produce 6-12 nodes with meaningful decision branches (not just a straight line) — model real forks like "already has account?" or "payment failed?".
- If a "CURRENT ARTIFACT" is provided in the user message, EVOLVE it rather than starting over: keep existing screen/node ids and content stable where they still fit the new brief, and only modify, add, or remove what the new brief actually requires. The goal is that the on-screen canvas visibly refines, not that it flickers to something unrelated.
- Output must strictly conform to this JSON Schema:

${SCHEMA_STRING}

Respond with ONLY the JSON artifact — no prose, no markdown fences.`;

function buildUserMessage(brief: string, currentArtifact?: Artifact): string {
  if (!currentArtifact) {
    return `BRIEF: ${brief}`;
  }
  return `BRIEF: ${brief}\n\nCURRENT ARTIFACT (evolve this, keep stable ids/content that still fits):\n${JSON.stringify(
    currentArtifact,
  )}`;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function buildRequestBody(messages: ChatMessage[]) {
  return {
    model: MODEL_ID,
    messages,
    temperature: 0.4,
    max_tokens: 4000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "Artifact",
        schema: ARTIFACT_JSON_SCHEMA,
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

async function callFireworks(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    throw new Error("FIREWORKS_API_KEY is not set");
  }

  const res = await fetch(FIREWORKS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRequestBody(messages)),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
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

export async function generateArtifact({
  brief,
  currentArtifact,
}: {
  brief: string;
  currentArtifact?: Artifact;
}): Promise<Artifact> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
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
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(brief, currentArtifact) },
  ]);
}
