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

## 2026-07-28 (video-cut session, wrap-continue)

**Off-objective / parked — do NOT carry into the next thread's active work:**

- [ ] **`.claude/` is not gitignored.** Six agent worktrees currently live untracked at `.claude/worktrees/`. Any `git add -A` would sweep entire worktrees into a commit. One-line fix: add `.claude/` to `.gitignore`. Real footgun given how many subagent worktrees this workflow creates.
- [ ] **Fireworks retry never reaches the healthy fallback.** `generate.ts` treats only 429/503/network as retryable, so an HTTP 500 on the primary (`glm-5p1`) throws immediately and `gpt-oss-120b` — verified healthy 2026-07-28 while the primary was 500ing — is never tried. One line to add 5xx to the retryable set. Blocks live generation entirely during a provider outage.
- [ ] **Raise `max_tokens` 4000 → 6000 before new wireframe element types land.** A truncated artifact fails `JSON.parse` and triggers the repair retry, which doubles latency at exactly the moment being filmed.
- [ ] **`store.jobs` is now write-only.** `addJob`/`updateJobStatus` still fire from both render paths, but nothing reads `jobs` since the docked `ConversationPanel` was deleted on `chrome/canvas-shell-rework`. During an 11–19s generation the only progress signal is the mic label. Decide: surface the queue somewhere, or drop the slice. Not both-and-neither.
- [ ] **Chat panel does not refit the canvas.** Opening chat overlays the right side of the artifact rather than resizing the canvas, so a flow gets clipped behind it. Fine for reference, bad for demoing with chat open.
- [ ] **Ambient transcript overlays artifacts.** The presentation-mode transcript crawl renders on top of the phone frames. Pre-existing, but now the only always-visible transcript since the docked panel was removed.
- [ ] **Chat button clickable for ~260ms while invisible on close.** A stray click during the morph collapse reopens the panel.
- [ ] **Panel copy changed without a decision.** `chrome/canvas-shell-rework` changed the chat title "Riff — text rail" → "Riff" and rewrote the opening message. Reads well, but it's user-facing copy that rode in on a chrome commit.
- [ ] **No real view switcher exists.** The pill's "Wireframe"/"Flow" buttons inject sample data; they are now dev-only and explicitly labelled. There is no control that switches the view of the *current* artifact between wireframe and flow. That's a genuine feature if wanted.
- [ ] **Logo exploration — mic as the "i" in Riff.** Prompt written and handed to Sean for Quiver on 2026-07-28. Open question flagged in it: the speech bubble and a mic are both "talking" metaphors, so one may need to go. 16px legibility is the binding constraint.
- [ ] **Reset the global model default** — carried from 2026-07-24. Sean set it to Opus 5 default via `/model` this session; verify that's intended vs. `opusplan`.

## 2026-09-11 (light-refresh session, wrap-continue)

**Shipped to prod 2026-09-10 (`4df6c37`):** primary model `glm-5p2`, 404 arms fallback, first-open empty state + "or type it" + "See an example", jobs-driven "Sketching…" label, real generated sample, `docs/SHOT-LIST-90s.md`.

**Carried (on-objective, on `refresh/integration-2` @ `65ae1bd`, pushed, not on main):**

- [ ] **Desktop platform** — `feat/desktop-platform` @ `bac2a77` is WIP: `max_tokens` 8000 + evolve cap 6 (`694848d`), `platform` field in schema/prompt (`ebe98bf`), then an unverified `DesktopFrame.tsx` + `WireframeCanvas.tsx` branch. Rebase onto `refresh/integration-2` (it predates the sketch-tune commits), finish, type-check, screenshot, review, merge.
- [ ] **Sean's picks:** roughness 0.6 (committed) vs 0.45; tighten the hero-logo → headline gap (default on pickup: pull the logo down so the block reads as one unit, ~40px gap, Sean redlines).
- [ ] **Merge `refresh/integration-2` → main + push** (= prod deploy; Sean nods per push), verify `/api/generate` → 200 on prod, then Sean records from `docs/SHOT-LIST-90s.md`.

**Parked (off-objective):**

- [ ] OG share card / `openGraph` metadata in `layout.tsx` — the link gets pasted into messages; no preview image today.
- [ ] Phone-width pass — never checked beyond the empty state at 400px.
- [ ] Flow nodes are not sketched — `FlowNodes.tsx` still crisp while wireframes are hand-drawn; inconsistent when both appear.
- [ ] Docked hero logo overlaps the leftmost phone's screen title (pre-existing "logo overlaps status bar" item, now the title).
- [ ] `ArtifactCanvas.tsx` hero top padding is a magic number (`pt-[280px]`), not derived from the logo box.
- [ ] Stale worktree `.claude/worktrees/agent-a6823ba9705833ef4` (old copilotkit sticky-failover draft, 80 uncommitted lines) — Sean said drop it; `git worktree remove --force` was permission-blocked for agents. Also 8 finished session worktrees under `.claude/worktrees/` can go once their branches are merged.
- [ ] CopilotKit chat throws `AI_MissingToolResultsError` when a `render_artifact` generate fails — the tool call never gets a result; the chat thread wedges.
- [ ] Chat route has no model failover (streaming makes per-request failover impractical); it imports `MODEL_ID` so a retirement is a one-line fix.
- [ ] Global model default: Sean said he switched to Fable this session; confirm it was session-only (`s`), not saved as default.

## 2026-09-13 — real stream A+B (`feat/stream`, plan `docs/plans/riff-real-stream.html`)

- [x] **Step 1. Gate spike: PASS, 6 of 6, no failure rule fired.** 33 glm-5p2 calls, 0 errors. Reasoning off won (R1b first content 420ms vs R1 1480ms), so R2–R4 ran with `reasoning_effort: "none"`. 15/15 candidate runs order-correct and valid. Honesty: R3 kept s1+s2 5/5, marked s3 changed 4/5 (control rewrote s3 4/5); R4 tab bar on every screen 5/5. **Decision 1 goes to Sean:** R2 screen 1 closes at 3200ms (over the 3s per-screen line), first element at 1198ms. Bench `src/app/api/dev/stream-bench/route.ts`; fixtures and `results.json` untracked in `docs/evidence/stream/spike-2026-09-13/`.

  | Arm (median ms) | First content | Outline | First element | Screen 1 | First changed screen | Done |
  |---|---|---|---|---|---|---|
  | R0 today, batch | 8790 | – | – | – | – | 8790 |
  | R1 today, stream | 1480 | – | 1937 | 4046 | – | 8401 |
  | R1b stream, reasoning off | 420 | – | 889 | 2783 | – | 7989 |
  | R2 candidate, new | 372 | 951 | 1198 | 3200 | – | 7364 |
  | R3 candidate, time-slot edit | 500 | 1072 | 1296 | 3492 | 3492 | 5706 |
  | R3-control today, time-slot edit | 442 | – | 887 | 2433 | 7322 | 10407 |
  | R4 candidate, tab bar edit | 324 | 744 | 952 | 2360 | 4614 | 6290 |

- [x] **Step 2. Contract, tracker and merge.** `ARTIFACT_STREAM_JSON_SCHEMA` + `validateArtifact` into `artifact.ts`, new `artifact-stream.ts`, `tests/artifact-stream.test.ts` on spike fixtures. `npm test` 18/18: chunking-invariant events (whole, per char, every split, 50 seeds) on R2-1, R2-2, R3-1, R3-2 and a reordered-keys fixture; head buffering; element-before-screen; deep-equal unchanged; both M4 cases; synthetic before→after equals `artifact-after.json`.
- [x] **Step 3. Streaming `/api/generate` with dev-only replay.** NDJSON when the request sends `Accept: application/x-ndjson`; the JSON path (useVoice/CopilotPanel until Step 4) is unchanged. Stream request body byte-identical to the spike's R2-1/R3-1/R4-2 bodies. Live R2 ×3 heads received at 1194 / 2143 / 907ms (line 1251ms; run 2 missed, and replay shows the pipeline adds ~5ms). Abort after first screen: Fireworks read stopped 2ms after client abort, chunks 298 → 298. Replay R2-1 head t=1433ms vs fixture 1428ms. Idle watchdog 9s, hard cap 45s (arithmetic in `generate.ts`).
- [x] **Step 4. One client job runner (`sketch-job.ts`) and a store draft.** Voice and text both call `startSketchJob` (NDJSON, newest wins globally, aborts the previous fetch). Store `sketch` slice: head fields, outline, base, closed screens, closed elements per stream screen index, per-screen `changed`; screens commit to `artifact` on close, done sets the final artifact. The canvas mode (per screen vs per element) is not picked. Replay R2-1: outline at 1439ms, s1's 5 elements accumulate, s1 commits at 3911ms. Supersede at 1.5s: job 1 `superseded`, server `aborted by client after 1507ms`, job 1's outline held until job 2's head at 2463ms. Supersede after s1: next body carried `currentArtifact [s1]`, `pendingScreens [s2,s3]`, `unfinishedFirstSketch: true`. Live x1: `[sketch] ... head 1554ms first-ink 1808ms s1 3484ms screens 3 end 8385ms` (1 Fireworks call).
- [ ] **Step 5. Canvas: outlines, ink, camera framed once.** Needs decision 1 (per screen vs per element) first.
  - Decision 1: per element (Sean 2026-09-13). Draw treatment: pending, see /dev/ink-options.
- [ ] **Step 6. Races, failures, review (all on replay).**
  - [ ] **Sean: one live voice session with a real mic** (Step 4 acceptance, can't run headless): no `Voice connection error`, and the sketch still streams while the agent talks.
  - [ ] Replay can't check "keep landed ids" (the fixture content is fixed); the final count of 3 after an unfinished-first-sketch supersede needs one live check.
  - [ ] Stale comment in `src/app/api/generate/route.ts:23-25` still says useVoice/CopilotPanel use the JSON path. Left alone (file under review during Step 4).
