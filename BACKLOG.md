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

## 2026-07-24 (end-of-day wrap, post-event)

**Resolved since the 1:30 PM entry:** Daytona handoff shipped and is verified in prod (~3s, live sandbox serving a full design brief). CopilotKit sidebar no longer covers the queue strip — the shell is now full-canvas with a floating pill. Both items above are closed.

- [ ] **Clickable prototypes need a schema change.** The wireframe schema has no navigation targets — a button is `{type, label, variant}`, so there is nothing to link screens with. The elegant path: the **flow** artifact already has `edges` with `from`/`to`. Generate both kinds from one conversation and let the flow's edges drive the wireframe's click targets. Note: the shipped Devpost pitch claims "interactive click through prototypes" — this makes that true.
- [ ] **Wireframe fidelity is a prompt problem, not a renderer problem.** The renderer already supports navbar, card, list-with-thumbnails, tabbar, searchbar, avatar, row, divider. The model under-uses that vocabulary, so screens look sparser than they need to. One prompt change, high visual payoff. Highest value-per-effort item here.
- [ ] **CopilotKit text rail is still dark-themed** on a now-light app (`themeVars` in `src/components/CopilotPanel.tsx`). Visibly inconsistent when opened via the keyboard icon.
- [ ] **Mic button overlaps the middle artifact** in presentation mode at low screen counts. Self-corrects as artifacts grow past ~5 screens. Fix = bottom padding on the canvas container in presentation mode (do not touch the refit logic).
- [ ] **Logo needs a compact lockup + contrast pass.** The teal/green mark's interior lines vanish at favicon size, and the wordmark sits too close in value to its pale mint ground. Ask for a tighter box-to-word ratio and a darker wordmark or lighter ground. WCAG measured: `#3FBA6A` 2.49:1, `#B7FF00` 1.21:1, `#00F5F1` 1.37:1 — all fail as text. `#1F7A4D` (5.32:1) is the working text accent now.
- [ ] **Devpost was never submitted** — missed by seconds; not selected to present. Copy is committed at `docs/DEVPOST-PASTE.md` and the project is live. Repurposable as a portfolio case study or a build-in-public post.
- [ ] **Rename the Vercel account** to match the `seansmithworks` GitHub handle (currently `seansmithdesign`). Flagged during the hackathon, deferred as non-demo.
- [ ] **Reset the global model default** — carried from the top of this file, still open. Run `/model`, set back to `opusplan`.
- [ ] **Daytona sandboxes idle ~15 min after a ~3s job.** Measured 2026-07-24: each of 7 sandboxes burned ~915 CPU-seconds serving a static page for about 3 seconds, because they stay alive until auto-stop. Cost $0.02 each — irrelevant at demo scale, dominant at user scale. Fix = delete the sandbox after handing back the preview URL, or serve the static brief from object storage and reserve sandboxes for actually-running code. See `docs/evidence/COST.md`.
