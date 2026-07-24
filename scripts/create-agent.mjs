#!/usr/bin/env node
// Creates (or updates, if ELEVENLABS_AGENT_ID is set) the "Riff Design
// Partner" ElevenLabs Conversational AI agent.
//
// Usage:
//   ELEVENLABS_API_KEY=... node scripts/create-agent.mjs
// or place ELEVENLABS_API_KEY=... (and optionally ELEVENLABS_AGENT_ID=...)
// in .env.local at the project root.
//
// If ELEVENLABS_AGENT_ID is set, this PATCHes the existing agent in place
// (same agent_id, prompt/tools/voice updated). Otherwise it POSTs a new
// agent and prints the agent_id to add to .env.local.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");

function loadEnvLocal() {
  if (!existsSync(envPath)) return;
  const contents = readFileSync(envPath, "utf-8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const API_KEY = process.env.ELEVENLABS_API_KEY;
const EXISTING_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

const SYSTEM_PROMPT = `You are Riff, a senior product-design partner having a spoken conversation with a designer who has no canvas in front of them — only your voice and what you render for them.

THE MOST IMPORTANT RULE: call render_artifact again EVERY SINGLE TIME you learn something new about the design — not just once at the start. If the user answers your question, adds a detail, changes direction, or introduces a new screen or step, that is your cue to re-render immediately. Err heavily toward calling it too often rather than too rarely. A conversation with five new facts should have five (or more) render_artifact calls. Never sit on new information without putting it on the canvas.

Your job in every turn:
1. Listen to what they're describing.
2. Call render_artifact EARLY — the moment you grasp the core idea, even a rough one. Don't wait until you feel "ready" or think you have the full picture.
3. Say one short line before you call it, like "Let me add that in" or "Give me a second to sketch that" — the render takes several seconds and the user should never sit in silence while it runs.
4. The brief you pass to render_artifact must be CUMULATIVE: restate the full design intent gathered across the whole conversation so far — the original request plus every refinement and answer since — not just the newest fragment. The generator uses this brief together with the current artifact to evolve it, so leaving anything out will lose it.
5. After the tool returns, say ONE short sentence about what just changed on the canvas — never a list of every screen, never a recap of the whole artifact — then ask exactly ONE pointed clarifying question. The kind a senior designer would actually ask: push on edge cases, user goals, what belongs on a specific screen, or what order steps happen in. Never ask more than one question at a time, and never list options.

Speech recognition in the room can be noisy and occasionally mishears you (e.g. "dog walkers" garbled into unrelated phrases). If what you heard sounds garbled, nonsensical, or unrelated to the conversation so far, do not confidently render it — ask the user to repeat themselves instead.

When you speak, speak like a person in a design review, not a report. Warm, sharp, concise. Short sentences built for the ear, not the page — no bullet points, no monologues, no reading back everything you just built. Don't over-explain or narrate your own process.

Your first message to the user should be something like: "Hey — I'm Riff. Tell me what you're imagining and I'll start sketching while we talk."`;

const payload = {
  name: "Riff Design Partner",
  conversation_config: {
    agent: {
      first_message:
        "Hey — I'm Riff. Tell me what you're imagining and I'll start sketching while we talk.",
      language: "en",
      prompt: {
        prompt: SYSTEM_PROMPT,
        llm: "claude-sonnet-5",
        temperature: 0.3,
        tools: [
          {
            type: "client",
            name: "render_artifact",
            description:
              "Render or update the design artifact on the user's canvas. Call this again every time you learn something new about the design, not just once at the start.",
            expects_response: true,
            response_timeout_secs: 30,
            parameters: {
              type: "object",
              properties: {
                brief: {
                  type: "string",
                  description:
                    "A complete, cumulative, self-contained brief of everything known so far: the original request plus every requirement and refinement gathered across the whole conversation, not just the newest detail. Always restate the full picture — never send only what changed.",
                },
                artifact_kind: {
                  type: "string",
                  description:
                    "Which kind of artifact fits the current discussion: 'wireframe' for UI screens, or 'flow' for a user-flow / journey diagram.",
                  enum: ["wireframe", "flow"],
                },
              },
              required: ["brief", "artifact_kind"],
            },
          },
        ],
      },
    },
    tts: {
      // Rachel — warm, natural, widely-used ElevenLabs premade voice.
      voice_id: "21m00Tcm4TlvDq8ikWAM",
      model_id: "eleven_flash_v2",
    },
  },
};

if (!API_KEY) {
  console.error(
    "ELEVENLABS_API_KEY is not set (checked process.env and .env.local).",
  );
  console.error("");
  console.error("Dry run — request payload that would be sent:");
  console.error(JSON.stringify(payload, null, 2));
  console.error("");
  console.error("To actually create/update the agent, run:");
  console.error("  ELEVENLABS_API_KEY=sk_... node scripts/create-agent.mjs");
  process.exit(1);
}

const isUpdate = Boolean(EXISTING_AGENT_ID);
const url = isUpdate
  ? `https://api.elevenlabs.io/v1/convai/agents/${EXISTING_AGENT_ID}`
  : "https://api.elevenlabs.io/v1/convai/agents/create";

const res = await fetch(url, {
  method: isUpdate ? "PATCH" : "POST",
  headers: {
    "xi-api-key": API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const body = await res.json();

if (!res.ok) {
  console.error(
    `Agent ${isUpdate ? "update" : "creation"} failed (${res.status}):`,
  );
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

if (isUpdate) {
  console.log(`Agent updated: ${body.agent_id}`);
} else {
  console.log(`Agent created: ${body.agent_id}`);
  console.log("");
  console.log("Add this to .env.local:");
  console.log(`ELEVENLABS_AGENT_ID=${body.agent_id}`);
}
