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

// Constructing the OpenAI client / adapter requires FIREWORKS_API_KEY, which
// is only guaranteed to be present at request time (not during `next build`'s
// page-data collection, and not on Vercel Preview where env vars are scoped
// Production-only). Build these lazily, on first request, instead of at
// module scope.
let serviceAdapter: OpenAIAdapter | undefined;
let runtime: CopilotRuntime | undefined;

function getServiceAdapter(): OpenAIAdapter {
  if (!serviceAdapter) {
    const openai = new OpenAI({
      apiKey: process.env.FIREWORKS_API_KEY,
      baseURL: "https://api.fireworks.ai/inference/v1",
    });

    serviceAdapter = new OpenAIAdapter({
      openai,
      model: "accounts/fireworks/models/glm-5p1",
    });
  }
  return serviceAdapter;
}

function getRuntime(): CopilotRuntime {
  if (!runtime) {
    runtime = new CopilotRuntime();
  }
  return runtime;
}

export async function POST(req: NextRequest) {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: getRuntime(),
    serviceAdapter: getServiceAdapter(),
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
}
