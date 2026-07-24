// Server-side mint of a short-lived ElevenLabs signed URL for the Riff
// Design Partner agent. Signed URLs expire in 15 minutes — never cache.

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;

  if (!apiKey || !agentId) {
    return Response.json(
      {
        error:
          "Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID. Run scripts/create-agent.mjs and add both to .env.local.",
      },
      { status: 500 },
    );
  }

  const url = new URL(
    "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url",
  );
  url.searchParams.set("agent_id", agentId);

  const res = await fetch(url, {
    headers: { "xi-api-key": apiKey },
  });

  if (!res.ok) {
    const detail = await res.text();
    return Response.json(
      { error: `ElevenLabs signed-url request failed (${res.status})`, detail },
      { status: 500 },
    );
  }

  const { signed_url } = (await res.json()) as { signed_url: string };
  return Response.json({ signedUrl: signed_url });
}
