#!/usr/bin/env node
// Creates the "Riff Design Partner" ElevenLabs Conversational AI agent and
// prints its agent_id. Run once, then add ELEVENLABS_AGENT_ID to .env.local.
//
// Usage:
//   ELEVENLABS_API_KEY=... node scripts/create-agent.mjs
// or place ELEVENLABS_API_KEY=... in .env.local at the project root.

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

const SYSTEM_PROMPT = `You are Riff, a senior product-design partner having a spoken conversation with a designer who has no canvas in front of them — only your voice and what you render for them.

Your job in every turn:
1. Listen to what they're describing.
2. Call render_artifact EARLY — the moment you grasp the core idea, even a rough one. Don't wait until you feel "ready" or think you have the full picture. Call it again after every meaningful new detail they give you — a new screen, a new step, a new requirement.
3. Between renders, ask exactly ONE pointed clarifying question — the kind a senior designer would actually ask. Push on edge cases, user goals, what belongs on a specific screen, or what order steps happen in. Never ask more than one question at a time, and never list options.

When you speak, speak like a person in a design review, not a report. Warm, sharp, concise. Short sentences built for the ear, not the page — no bullet points, no monologues, no reading back everything you just built. After you call render_artifact, mention what you just put on the canvas in one short phrase — "Alright, I've got a home feed and a booking flow up" — then move straight into your next question. Don't over-explain or narrate your own process.

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
        llm: "gemini-2.0-flash",
        tools: [
          {
            type: "client",
            name: "render_artifact",
            description:
              "Render or update the design artifact on the user's canvas. Call early and often as understanding evolves.",
            expects_response: true,
            response_timeout_secs: 30,
            parameters: {
              type: "object",
              properties: {
                brief: {
                  type: "string",
                  description:
                    "A complete, self-contained brief of everything known so far: the product, the screens or steps involved, and every requirement gathered in the conversation. This call REPLACES prior context, so always include everything, not just what's new.",
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
  console.error("To actually create the agent, run:");
  console.error("  ELEVENLABS_API_KEY=sk_... node scripts/create-agent.mjs");
  process.exit(1);
}

const res = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
  method: "POST",
  headers: {
    "xi-api-key": API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const body = await res.json();

if (!res.ok) {
  console.error(`Agent creation failed (${res.status}):`);
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log(`Agent created: ${body.agent_id}`);
console.log("");
console.log("Add this to .env.local:");
console.log(`ELEVENLABS_AGENT_ID=${body.agent_id}`);
