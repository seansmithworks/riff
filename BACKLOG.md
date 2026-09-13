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

## 2026-09-11 (voice lab session, wrap-continue)

**Carried (on-objective, `feat/voice-lab` @ `c230553`, pushed, preview Ready):**

- [x] **Glow hard edge:** the ambient glow still ends in a hard line at the stage card bottom (`tips-closeup.png`, `resp-800x600.png`). Make it fade out inside the canvas bounds. Done: mask fade `f403a3e`.
- [x] **Riff Arcs over-wrap into scribble loops** (`arcs-flex-a/b.png`) and lose the three separate wavy lines Sean liked. Strawman: default sweep ~200°, 3 distinct arcs with a visible gap. Sean redlines in DialKit. Done: strawman `8ec175e`.
- [ ] **DECIDE OR KILL: merge `feat/voice-lab` → main** (= prod deploy of `/voice-lab`). Preview: https://riff-git-feat-voice-lab-seansmithworks.vercel.app/voice-lab. Sean (2026-09-11 late): yes, after his dial pass; still needs the per-deploy nod.
- [ ] **DECIDE OR KILL: origin + controls forks.** Voice-mark origin bottom-center (built default) vs bottom-right; white pill (default) vs V10 disc. Canvas thread `7b739fff` stays open.
- [ ] **Phases 1–3: bring the winning voice FX into the real voice UI.** Voice × job are concurrent channels. The plan lived in the session-06199eed scratchpad (`sketch-shader-research.md`, tmp); re-derive from the `/voice-lab` engine if it's gone.
- [ ] **DECIDE OR KILL: `feat/load-logo` @ `0f52726`**, carried 4× since 2026-09-10.

**Parked (off-objective):**

- [ ] Human marks 04 Hatch EQ, 05 Speech Balloon, 07 Stipple Spray and 09 Orbit Ticks read thin. Sean's taste call.
- [ ] Voice Marks Lab artifact `42d1b072` and canvas board 15 still use the old exclusive-sketching model. Superseded by `/voice-lab`.
- [ ] Root `layout.tsx` wraps every route in `<CopilotKit>`, so `/api/copilotkit` 500s on `/voice-lab` without keys and masks real errors while tuning.
- [ ] `feat/voice-ui` Conversation Bar (`cdd7ddd`) is a baseline, unmerged.
- [ ] Sean records the 60–90s cut from `docs/SHOT-LIST-90s.md` (original refresh objective).

## 2026-09-11 (voice lab tuning session, wrap-continue)

**Carried (on-objective, `feat/voice-lab` @ `6d9f8be`, pushed):**

- [ ] **DialKit panel separation.** Sean: "the sparks/glow panel needs to be a bit better separated with…" (message cut off). Strawman: more space and bolder headings between panels, plus one Sparks panel directly under Glow (Cinders on/off, tip spark rate, cinder cap). Moving controls changes persist keys, so carry his saved values over.
- [ ] **Bake Sean's dial pass in as defaults.** He pastes DialKit values. Saved localStorage values override code defaults, so check the new defaults in a clean browser.
- [ ] **Riff Arcs 200° strawman** (`8ec175e`): no reaction yet. Sean redlines it in DialKit.

Done this session: glow hard edge via mask (`f403a3e`), Glow slider set (Strength/Size/Height/Color Mix/Edge Softness) + working Ambient Glow toggle (`1065ab9`, `6d9f8be`), DialKit persist on every lab panel.

## 2026-09-12 (sequence exploration)

- [x] 10 sequence presets built
- [x] recording of all 10 sent to Sean
- [ ] Sean picks a preset direction
- [x] Fluid "shader" gradient glow (blue/green, tied to voice activity) (`e9c2b94`, `83cff90`)
- [x] Color semantics: human = blue, Riff = yellow, overlap = green (`88638d5` role-color dial)
- [x] New Amoeba mark, single wobbly loop (shipped as default human mark per Sean's correction; Riff keeps Burst) (`e9c2b94`, `ee70469`)
- [x] Center disc squash & stretch (vertical for human, horizontal for Riff) (`e9c2b94`)

**Parked (off-objective):**

- [ ] DialKit panel separation — Sean's cut-off point ("sparks/glow panel needs to be better separated with…"), he no longer recalls it; revisit if it resurfaces.

### 2026-09-12 (ink-and-wash sketchbook, Phase A)

- [x] Dot-grid paper: `DotGrid` addressable buffer, dirty-dot redraws, new Paper panel (Pitch/Dot size/Base opacity/on-off)
- [x] Glow as texture: density field tints/brightens dot-grid paper (Style: Wash/Dots/Both)
- [x] Watercolor treatment: wet edge, granulation, 2-3 glazes, wet-in-wet boundary warp
- [x] Role-color dominance fix: "Role color" dial + `hueBiasExplicit` so presets 1/4 read blue/yellow/green by default
- [x] Stroke bleed primitive: `bleedAlongPath` + single ink-advance callback hook in `frames.ts`
- [x] Reviewer nit: Amoeba's smear now widens outline reach like Burst's rays
- [x] **Phase B: sparks build the sketch on the grid** — particle landing snaps to nearest grid dot, speculative tiers draw as lit-dot skeletons, dots fade to paper under finished ink (voice-lab-dotgrid-addendum.md §3). `src/lib/voiceLab/build.ts` (new) + `frames.ts`/`engine.ts` integration; docs/voice-lab-sequences.md §9.
- [x] Phase B deferred: no full acceptance-evidence capture (perf ms/frame profiling, per-preset build-vs-clear-beat log, before/after video recordings) — only spot-checked via screenshots and `tsc --noEmit`. Revisit if Sean wants the full evidence pass before shipping. (evidence pass done: build-vs-clear margins logged for 6 presets, 3.4ms avg/5.6ms max per frame at Juice, recordings in the orchestrator scratchpad)
- [ ] Phase B deferred: build particles and drift cinders both render in plain ink color as short line segments — visually similar at a glance; a distinct spark color/shape would read the "sparks become the sketch" narrative more clearly.
- [ ] Phase B deferred: nib highlight on tier 0/1 arrival (width ×1.6, 120ms fade) not implemented — heads currently draw with no extra highlight on arrival.
- [ ] Phase B deferred: React Flow real-app integration (plan §6 risk 3) — Canvas2D build layer doesn't yet track live node screen coords through a `fitView` animation.

### wrap-continue (2026-09-12 afternoon)

**Carried (on-objective):**

- [ ] Sean picks a base choreography — strawman in place: preset "B · Blend" (Mm-hm turn-taking + Catch sparks, `32b61be`, default on fresh installs). Next thread: apply his redlines, don't re-ask.
- [x] Sean's dial pass → bake DialKit values as code defaults (verify in a clean browser; saved localStorage overrides defaults). `6771c2c`
- [ ] Merge feat/voice-lab → main (= prod deploy; per-deploy nod), then Phases 1–3: bring the winning system into the real voice UI. Known blocker: React Flow node coords move during fitView; evolve = diff re-ink, not rebuild.
- [ ] DECIDE OR KILL (carried 2× since 2026-09-11): voice-mark origin bottom-center (built default) vs bottom-right; white pill vs disc. Disc squash assumes the disc.
- [ ] DECIDE OR KILL (carried 5× since 2026-09-10): feat/load-logo @ 0f52726 — clean SVG export, draw-in intro only, or kill.

**Parked (off-objective):** see the Phase B deferred items above and the panel-separation item; not duplicated here.

### voice-lab morph transition system (2026-09-12, feat/voice-lab)

Build order from `docs/voice-lab-morph-spec.md`, one commit per step:

- [x] Step 1: F0 fixes (landing white-card flash, landing timestamp ownership, construction dots after clear) `723f60a`
- [x] Step 2: `morph.ts` motion primitives + F2–F7 engine/marks/fluidGlow/frames integration `8c8f388` (combined with Step 3 below — MORPH_STYLES' Record type needs all 5 styles to exist for the engine wiring to compile)
- [x] Step 3: 5 Morph styles `8c8f388` — Shapeshift is a simplified crossfade of the outgoing loop against the incoming ray fan (drawShapeshiftBody), not the spec's literal shared-topology K-slot resample
- [x] Step 4: MorphPanel, `M`/`Shift+M` hotkey, caption label `b254698`
- [x] Step 5: Evidence recordings + ffmpeg acceptance checks in `docs/evidence/morph/` (mobile only, untracked; desktop 1440px skipped, time)
- [x] Fix wave after reviewer rejection (2026-09-12): prod-gated engine hook + spec committed `6284fee`; live Morph dials `88a3332`; Shapeshift as one K-slot shared-topology body `5ec6899`; Relay gather/hold/release timeline + disc pivot + landing bead `115772a`; spring period clamp (every spring ran ≥1s) `02f4c44`; F2 talk-blended bands `a01de94`; onset pulses stuck at 1 under Morph (cinder flood) `8d4d4b5`
- [ ] Morph F5 not wired: every style defines `wash.overlap`, but nothing in `engine.ts`/`fluidGlow.ts` reads it, so riff blob anchors never lerp toward human (spec §2 F5) — found in review of `c7c02ae..a4966b0`
- [ ] Elastic wind-up→settle uses `setTimeout` (`morph.ts` ~665), off the frame clock; a backgrounded tab can flip the target mid-freeze and jump on refocus — move it onto `now()`
- [ ] Sean's design call: barge-in transitions (T6/T9) are specced ≤150ms, so Shapeshift/Relay/Ink & Wash still show one visible step on interrupt — slow them for smoothness, or keep them snappy?
- [ ] Sean picks a Morph style (strawman default: Ink & Wash; fork: one creature [Shapeshift/Elastic] vs two speakers [Relay/Ink & Wash])
- [ ] Fresh load comes up paused (VoicePanel mount stops autoplay) — awaiting Sean's nod, not fixed
- [ ] Landing particle and ink-bleed color follows the wrong role (`activeRoleAndMarkId` reports human during silence) — noticed, not fixed
- [ ] `burstUnderlay` is dead (typed and set by presets but never read) — noticed, not fixed
- [ ] Burst boil runs at ~11Hz, above the reduced-motion 3Hz guidance — noticed, not fixed
- [ ] Lab: Stream prototype (A+B, steady pen default, batch baseline)
- [ ] Sean feels stream vs batch in lab → go/no-go on real pipeline A+B (generate.ts streaming, outline head, draft artifact, draw-in)
- [ ] Option D pencil guesses: held (Sean 2026-09-13: not yet)
- [ ] Pen pace: steady (Sean 2026-09-13)
