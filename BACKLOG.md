# Backlog — CreativeConvos / Riff

## 2026-07-24 (hackathon day, wrap-continue)

- [ ] **Off-objective:** Sean's global Claude Code default model got saved as Fable via `/model fable` + Enter this morning. After the hackathon: run `/model`, reset default to opusplan (per global CLAUDE.md tier policy).
- [ ] **Parked decision — demo device:** strawman = present from laptop (reliable mic/wifi); phone-as-mic theatrical moment only if end-to-end proves rock-solid during rehearsal. Decide at rehearsal, not before.
- [ ] **Parked decision — name:** "Riff" is live in the header as the working name (APP_NAME const in src/lib/config.ts). Stands unless Sean vetoes; optional Quiver AI branding pass only if Wave 4/5 finishes early.

## 2026-07-24 (second wrap-continue, 1:30 PM)

- [ ] **Tech debt — duplicate `render_artifact` logic.** The voice path (`src/hooks/useVoice.ts`) and the text path (`src/components/CopilotPanel.tsx`) each have their own independent implementation of the same render loop. Deliberately NOT unified during the hackathon — merging two working code paths hours before a live demo is the classic self-inflicted wound. Unify after the event.
- [ ] **CopilotKit sidebar covers the conversation panel.** When open, it's a fixed overlay across the same right-hand region, hiding the render-queue strip and mic button underneath. Means the queue strip is invisible in the exact fallback scenario it was built for (voice fails → type instead). Fix = sidebar width/position, or dock the queue strip elsewhere.
- [ ] **Daytona handoff is scaffolding only.** `src/lib/daytona.ts` + `/api/handoff` compile and are committed (`daf1eb6`) but are untested, have no UI entry point, and `DAYTONA_API_KEY` is empty. Either get a key and finish it, or delete it as dead code.
- [ ] **No artifact-vs-intent scorer.** Braintrust now logs every generation, but there's no eval scoring whether the artifact actually matches the spoken brief. That's the genuinely interesting eval problem and the natural next build — it's already named in `docs/DEVPOST.md` as what's next.
- [ ] **CodeRabbit not used.** Would be a process story (AI agents wrote nearly all this code; CodeRabbit reviews it), not a product feature. ~10 min once a GitHub repo exists: install the app, open one PR. Do NOT claim it's in the product.
- [ ] **Streaming generation unexplored.** Benchmarked: first chunk arrives in ~1.3s vs ~15.6s for the complete object. Not usable as a drop-in (can't parse partial JSON), but it's the real path to a responsive-feeling canvas that fills in progressively.
