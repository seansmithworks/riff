// CopilotKit runtime endpoint — powers the text sidebar (CopilotPanel).
// Uses CopilotKit's OpenAI-compatible adapter pointed at Fireworks, reusing
// the existing FIREWORKS_API_KEY env var (no new provider/key).

import OpenAI from "openai";
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { NextRequest } from "next/server";

const openai = new OpenAI({
  apiKey: process.env.FIREWORKS_API_KEY,
  baseURL: "https://api.fireworks.ai/inference/v1",
});

const serviceAdapter = new OpenAIAdapter({
  openai,
  model: "accounts/fireworks/models/glm-5p1",
});

const runtime = new CopilotRuntime();

export async function POST(req: NextRequest) {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
}
