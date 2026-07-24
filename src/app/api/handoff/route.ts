import { NextRequest, NextResponse } from "next/server";
import { createHandoffPreview } from "@/lib/daytona";
import type { Artifact } from "@/lib/artifact";

export async function POST(req: NextRequest) {
  let body: { artifact?: Artifact };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const { artifact } = body;

  if (!artifact || typeof artifact !== "object") {
    return NextResponse.json(
      { error: "Missing required field: artifact" },
      { status: 400 },
    );
  }

  if (!process.env.DAYTONA_API_KEY) {
    return NextResponse.json(
      { error: "DAYTONA_API_KEY is not set" },
      { status: 500 },
    );
  }

  const start = Date.now();
  try {
    const { url, sandboxId } = await createHandoffPreview(artifact);
    const durationMs = Date.now() - start;
    console.log(`[api/handoff] sandbox ready in ${durationMs}ms`);
    return NextResponse.json({ url, sandboxId }, { status: 200 });
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[api/handoff] failed after ${durationMs}ms: ${message}`);
    return NextResponse.json(
      { error: `Handoff failed: ${message}` },
      { status: 500 },
    );
  }
}
