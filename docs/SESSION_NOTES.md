# Session Notes — Riff

## 2026-07-24 — Hackathon day, afternoon session (orchestrator)

Daytona HackSprint #5, WorkOS SF. Picked up at 1:32 PM with everything buildable already built; ended at 3:35 PM.

### Outcome

**The product shipped. The submission did not.** Riff was public, deployed, and verified in production with five working sponsor integrations. The Devpost entry was missed by about five seconds at the 3:30 PM deadline, and Sean was not selected to present.

### What shipped

| | |
|---|---|
| Repo | https://github.com/seansmithworks/riff — public, origin-only |
| Prod | https://riff-navy.vercel.app — Vercel scope `seanstonsfs-projects` |
| Integrations | ElevenLabs, Fireworks (`glm-5p1`), CopilotKit, Braintrust, Daytona — all five verified working |

**Commits** (`665efe0..c414c64`, 9 total, all pushed):

- `8fc3d3b` — "Hand off to build" button wired to the Daytona handoff
- `dee8b0d` — handoff output upgraded from a screen dump to a full design brief (original ask, deterministic direction summary, screens, full transcript, offline self-download; no LLM call, ~3s)
- `bb72178` — **canvas viewport refit fix** (see below)
- `6955b6f` — dark shell converted to light for projector legibility
- `afa6895` — presentation mode: full-bleed canvas, centered mic, two-line feathered transcript, CSS ambient glow
- `60f7454` — green rebrand, presentation mode as default, floating icon toolbar, logo, ambient background wash
- `a9146e5` — controls consolidated into one floating pill; CopilotKit's own launcher hidden
- `c3692a8` — chat icon → voice conversation panel, keyboard icon → CopilotKit text rail
- `c414c64` — app icons (`src/app/apple-icon.png`, `icon.png`) + brand assets + `docs/DEVPOST-PASTE.md`

### The bug worth remembering

Sean noticed he was "only seeing 3 or maybe 4 mockups" after asking for desktop variants. Testing against prod proved the **generation layer was fine** — 3 screens → 6, all originals preserved byte-identical, three desktop screens added. The failure was in the viewport: in `@xyflow/react` v12, **`fitView` as a prop only fits on initial render** and never refits when nodes change. Compounded by `WireframeCanvas` inheriting the default `minZoom: 0.5`, which couldn't fit six 340px frames in one row anyway. Fixed with an imperative `fitView()` in a `useEffect` keyed on joined node ids, plus `minZoom={0.15}`.

This would have silently eaten the best moment of the demo — the artifact would have grown and the audience would have seen nothing change.

### Verifications worth keeping

- **Fire-and-forget confirmed by a human.** Sean's 372-second voice session (`conv_8501kyaxwnzxe2wsqd36g4qk1z4g`): 4 `render_artifact` calls, 4 completed, **0 aborted**. Previously 5 of 6 died. Caveat: the tool returns instantly by design, so the transcript proves no *abort* — it cannot prove the artifact visually landed.
- **The agent handles garbled speech well** — it isolated the part it lost and asked a targeted question rather than hallucinating a render.
- **WCAG contrast measured** on the new palette: `#3FBA6A` 2.49:1, `#B7FF00` 1.21:1, `#00F5F1` 1.37:1 — all fail as text. `#1F7A4D` at 5.32:1 became the working text accent. The *old* coral was also failing (2.82:1), so this was a pre-existing problem surfaced by the rebrand.
- **Stop/start = new conversation, agent memory lost, canvas kept.** Safe mid-demo recovery, but the next sentence must re-anchor context.

### Process note

Repeated advisory nudges to submit early did not change the outcome. Captured as a durable rule in memory: on hard external deadlines, a submitted draft is a **blocking gate that precedes polish**, not a task competing with it — and the orchestrator should enforce it as a gate. See `feedback_deadline-submit-draft-first.md`.

Open items: `BACKLOG.md`.
