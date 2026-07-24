import { NextRequest, NextResponse } from "next/server";
import { generateArtifact } from "@/lib/generate";
import type { Artifact } from "@/lib/artifact";

export async function POST(req: NextRequest) {
  let body: { brief?: string; currentArtifact?: Artifact };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const { brief, currentArtifact } = body;

  if (!brief || typeof brief !== "string" || !brief.trim()) {
    return NextResponse.json(
      { error: "Missing required field: brief" },
      { status: 400 },
    );
  }

  const start = Date.now();
  try {
    const artifact = await generateArtifact({ brief, currentArtifact });
    const durationMs = Date.now() - start;
    console.log(`[api/generate] artifact generated in ${durationMs}ms`);
    return NextResponse.json({ artifact }, { status: 200 });
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[api/generate] failed after ${durationMs}ms: ${message}`);
    return NextResponse.json(
      { error: `Artifact generation failed: ${message}` },
      { status: 500 },
    );
  }
}
