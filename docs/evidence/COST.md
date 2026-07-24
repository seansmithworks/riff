# What it cost to build Riff

One day, 2026-07-24. Figures below are from provider dashboards, not estimates.

| Service | Usage | Cost |
|---|---|---|
| **ElevenLabs** (Conversational AI) | 26 min, 332 billable requests, 12.5K of 400K credits (3.1%) | **$2.76** |
| **Daytona** (sandbox handoff) | 7 sandboxes, all short-lived and auto-stopped | ~$0 — $100 credit untouched |
| **Fireworks** (`glm-5p1`) | ~25–30 structured-output generations | cents |
| **Braintrust** | ~25–30 logged generations | free tier |
| **Vercel** | 8 production deploys | free (hobby) |

**Total: under $3.**

## Two numbers worth keeping

- **197ms** average time-to-first-byte on voice. The conversation was never the slow part.
- **11–19s** for structured artifact generation. This was the slow part, and it's a different system entirely.

That gap is the whole design problem. Free-text streams, so it feels instant. Layout can't — you cannot render half a schema. So the wait got designed around instead of hidden: `render_artifact` returns immediately, the agent keeps talking, and the canvas fills in out of band when the JSON lands.

- **$0.0083** average cost per voice request.
- **~475 credits per minute** of conversation — the planning number. A 3-minute demo take costs ~1,400 credits; the monthly allowance covers ~250 more takes.
