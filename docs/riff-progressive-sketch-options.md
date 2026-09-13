# Riff: progressive sketching, today's pipeline and options

Paths are relative to `feat-voice-ui` @ `cdd7ddd`. Everything is checked in code unless it's marked measured, estimated, or inferred.

## Today: one voice turn

| Hop | What happens | Streamed or batch |
|---|---|---|
| 1. Mic to ElevenLabs | `useConversation` session from a signed URL (useVoice.ts:71, :208). ElevenLabs handles speech-to-text, turn-taking and speech. | Streamed. 197ms voice time-to-first-byte (measured, COST.md:17) |
| 2. Agent decides to sketch | An LLM hosted by ElevenLabs (`claude-sonnet-5` per create-agent.mjs:72; I haven't checked the live agent's config) says a short line first (:53), then calls `render_artifact` with a cumulative brief. | Batch. The tool call arrives whole, only after your turn ends. About 1–3s after you stop talking (estimated) |
| 3. Client tool | Fires `fetch("/api/generate")` and returns immediately (useVoice.ts:128–187). | Fire-and-forget. Voice and sketch **already run in parallel** |
| 4. Generation | route.ts:36 → generate.ts:237: one Fireworks call, `glm-5p2`, `response_format: json_schema`, no `stream` (generate.ts:64–80). It waits for the full body (:140), then parses and does one repair retry (:249–278). Evolve re-sends the whole artifact, and the model rewrites all of it (:57). | Batch. 11–19s (measured, COST.md:18). 12.8s initial, 35.1s evolve (measured, SESSION_NOTES.md:54) |
| 5. Format | One JSON document: a wireframe `{kind,title,screens[],platform}` or a flow `{nodes[],edges[]}` (artifact.ts:4–47). Elements have no ids, only array positions. About 1.5–2k tokens (estimated from the evidence JSONs). | — |
| 6. Canvas | `setArtifact` replaces the whole artifact (useVoice.ts:159). React Flow remounts whenever screen ids change (`key`, WireframeCanvas.tsx:153), then fitView runs for 400ms. Strokes are static SVG with no draw-in (Sketch.tsx). Only the first turn shows a skeleton (ArtifactCanvas.tsx:31). | Batch. Everything pops in at once |

**Where the wait goes:** almost all of it is hop 4. The model writes about 2k tokens of JSON, and nothing shows until the last brace. The repo already has a benchmark: with streaming, the first chunk arrived in about 1.3s, against about 15.6s for the whole object (measured 2026-07-24 on glm-5p1, BACKLOG.md:16). The data exists at 1.3s. The app just doesn't read it.

## Provider facts behind the options

- **Fireworks streaming.** Fireworks streams tokens as server-sent events with `stream: true`. Schema-constrained decoding makes invalid JSON impossible, so each `}` that closes a screen or element is final. I haven't confirmed the 1.3s benchmark used `response_format`. Check that in the first spike.
- **Platform arrives last.** `platform` sits after `screens` in the schema (artifact.ts:244–247). Constrained decoders usually follow schema order (inferred), so a stream would reveal mobile vs. desktop last. Move it up.
- **No word-by-word transcript.** The installed ElevenLabs SDK (client 1.15.2) has no tentative *user* transcript. It only has the final `user_transcript` and `vad_score` (verified in node_modules). Drawing is possible per pause, not per word.
- **Riff's voice can be told what landed.** `sendContextualUpdate` "sends contextual information to the agent that won't trigger a response." It exists in the installed SDK.
- **Cost.** GLM 5.2 costs $1.40 input / $4.40 output per 1M tokens, so a turn today runs about $0.01–0.015 (estimated).
- **No parser library needed.** Constrained output plus a small brace-depth tracker can emit each closed object.

## Options

### A. Stream the artifact and ink each piece as its JSON closes
- **What you see:** About 2s after Riff says "sketching," the first phone frame inks. Its elements then drop in top to bottom, one screen after another. It still finishes around 15s.
- **First real stroke:** about 1.5–2s after the tool call (estimated), vs. 11–19s today.
- **Build: M.** Touches generate.ts (streaming, closed-object tracker, fallback only before the first byte), route.ts (NDJSON response), useVoice.ts and CopilotPanel.tsx (read the stream outside the tool; the tool still returns immediately), store.ts (a draft artifact that grows), WireframeCanvas.tsx (stable key, frame the camera once), Sketch.tsx (draw-in ported from the lab), and artifact.ts (`platform` first).
- **Cost:** none. Same call, same tokens.
- **Risks:**
  - **Layout:** Wireframe x positions come from screen index (WireframeCanvas.tsx:117), so appended screens never move earlier frames. The first sketch is always exactly 3 screens (generate.ts:16), so the camera can frame 3 slots once and never refit mid-ink. Flows are different: dagre repositions every node as nodes arrive (flow-layout.ts), and edges come last. Hold flows until all nodes are in.
  - **Superseded requests:** Today a stale result is simply ignored (useVoice.ts:158). With streams, the older one has to be aborted or two pens draw at once.
  - **Failure mid-stream:** roll back to the last complete artifact.
  - **Evolve is still slow:** the model re-types unchanged screens first. If screen 3 changed, nothing visible happens until 1 and 2 are re-sent.
- **Lab:** Add a `job` beat event `part` with a `frameId` (sequence.ts:19–24). Land frames one at a time through `planBuild`, which already groups paths per frame (`pathsByFrame`). Fire beats at 2.0 / 5.5 / 9.0s instead of one `ready` at 10.2s.

### B. Outline first, then only the screens that change (builds on A)
- **What you see:** At about 1.5s, every device frame appears as a pencil outline with its screen name. Screens about to change get a faint wash. Untouched screens stay put, and only changed or new screens re-ink.
- **First real stroke:** the outline shows at about 1.5–2s on every turn. On evolve, the first changed stroke lands at about 2–3s (estimated), with no waiting behind unchanged screens.
- **Build: M on top of A.** A new schema head, `outline:[{id,name,status: keep|changed|new}]`, comes before `screens` (which now holds only changed and new screens). Touches artifact.ts, a merge step in store.ts, and the rules in generate.ts.
- **Cost:** lower on evolve because fewer output tokens are written. About +50 tokens on the first sketch.
- **Risks:** The model has to decide up front, in the outline, what changes. The evolve moment where a button relabeled itself (EVOLVE-MOMENT.md) now depends on it marking that screen `changed`. Use the before/after evidence JSONs as the test case. The camera refits once, when the outline reveals a new screen count, before any ink.
- **Lab:** This is the lab's speculative layer with real names and counts. Fire tier-0 `part` beats for all frames, then detail tiers per frame.

### C. Fan-out: a planner, then one parallel call per screen
- **What you see:** Outlines at about 2s, then all screens draw at once. Done in about 6–8s.
- **First real stroke:** about 3–4s. Complete at about 6–8s, vs. 11–19s (estimated).
- **Build: L.** A planner prompt, a per-screen prompt, N concurrent streams, a merge step, and per-stream abort.
- **Cost increase:** N+1 calls, each paying for the roughly 2k-token system prompt, plus the current artifact on evolve. About 2× per first sketch and 3–4× per 6-screen evolve (estimated).
- **Risks:** Screens can't see each other, which breaks naming, navigation, and the button that relabeled itself. It means 4–7 concurrent calls per visitor per turn (I haven't checked rate limits). Three pens at once also reads busier than one hand.
- **Lab:** Fire `part` beats for every frame at the same timestamp.

### D. Pencil while listening (the caricature layer)
- **What you see:** The moment you pause, before Riff answers, gray pencil strokes guess at the screens. Real ink then draws over them and corrects them.
- **First real stroke:** about 1–2s after you stop talking, ahead of the tool call (estimated).
- **Build: M.** The user transcript in `onMessage` (useVoice.ts:108) triggers a small `/api/pencil` call on `gpt-oss-120b` (confirmed on the account) that returns platform, screen names and element types, with no copy. Add a pencil layer on the canvas and a debounce so filler like "yeah" doesn't fire it.
- **Cost increase:** +1 small call per utterance. I haven't checked the price. Estimated at a fraction of a cent.
- **Risks:** It draws before Riff's judgment, so garbled speech the agent would ask you to repeat (create-agent.mjs:57) still gets drawn. It works per pause, not per word (the SDK limit above).
- **Lab:** At each `yield` beat, draw the speculative frame at full ink in a pencil tone, then let `part` beats ink over it.

### E. A stream of edit operations instead of whole documents
- **What you see:** On evolve, individual elements appear, relabel, move or erase one at a time. The first sketch looks like A.
- **First real stroke:** about 1.5–2s on evolve. Small changes finish in a few seconds (estimated).
- **Build: L.** Element ids go into the schema (there are none today, artifact.ts:16), plus an operations grammar, an applier, and conflict handling when turns overlap.
- **Cost:** the fewest output tokens on evolve.
- **Risks:** Models patch less reliably than they rewrite (inferred). Operations can hit stale state when turns overlap. It's also the largest schema change. B captures most of this benefit at the screen level.
- **Lab:** Script `add` / `relabel` / `erase` beats against the existing frame elements.

## Recommendation

**Build A and B together as one feature: "the stream."** It turns a 15-second pop into a pen that starts at about 2s. On evolve it touches only what changed, with no extra API cost and no loss of cross-screen reasoning. Fake it in `/voice-lab` first (the `part` beat is size S) so Sean can feel it, then build the real pipeline. Call `sendContextualUpdate` as each screen lands so Riff can say "there's the home screen" in sync.

Skip C: it costs 2–4× and breaks the consistency behind Riff's best evolve moment. Skip E: B gets most of its benefit with less risk. Hold D until the stream ships. The remaining gap, between when you stop talking and when Riff calls the tool, may be small enough not to need it.

## Forks for Sean

1. **Pencil guesses (D): charming, or do they undercut trust?** They're the caricature he described, but they also show Riff being wrong on every turn. Strawman: not yet.
2. **Pen pace.** Model-paced ink arrives in uneven bursts. A steady pen buffers up to 1.5s and draws at a constant tempo: smoother, slightly later. Strawman: steady pen.

## Sources

- [Fireworks chat completions API (stream, response_format)](https://docs.fireworks.ai/api-reference/post-chatcompletions)
- [Fireworks structured outputs](https://docs.fireworks.ai/structured-responses/structured-response-formatting)
- [Fireworks GLM 5.2 pricing](https://fireworks.ai/models/fireworks/glm-5p2)
- [ElevenLabs client events](https://elevenlabs.io/docs/eleven-agents/customization/events/client-events)
- [ElevenLabs React SDK (sendContextualUpdate)](https://elevenlabs.io/docs/eleven-agents/libraries/react)
- [ElevenLabs client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools)
