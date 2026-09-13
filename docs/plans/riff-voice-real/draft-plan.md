# DRAFT: Lab voice UI into the real Riff app (on top of the real stream)

Status: DRAFT, not reviewed. Author: orchestrator. Target refs: feat/stream @ 9219f07 (real app, stream done), feat/voice-lab @ 7fbb78d (lab engine). Merge base of both and origin/main: 6974192.

## Goal

The real app at `/` shows the lab's voice UI (Amoeba = human mark, Burst = Riff mark, Morph "Ink & Wash", fluid wash glow, dot paper with glow-tinted dots, Blend choreography) driven by the REAL ElevenLabs session, while the real streaming sketch (outline, then per-element Pen ink in React Flow nodes) keeps working unchanged. Then ship to main on Sean's nod.

## Core decision: which lab FX survive next to Pen

The lab engine is two channels in one Canvas2D (engine.ts:2115-2208): a voice channel and a simulated job channel.

KEEP (voice channel, no sketch geometry needed):
- Marks: Amoeba (human) and Burst (Riff), presence handoff envelopes from the Blend preset (sequence.ts preset data, not its scripted beats).
- Morph "Ink & Wash" (pose reveal, stain on paper, wet bloom).
- Fluid wash glow (fluidGlow.ts, 96x60 CPU field upscaled), pigment mix.
- Dot paper (dotGrid.ts) with glow tinting (engine.ts tintDotsFromField ~2085-2106).
- Anticipation squash on human yield (triggerAnticipation, engine.ts:704).

CUT in the real app (Pen owns all sketch drawing):
- frames.ts card + two-pass ink reveal (hardcoded FRAME_DEFS phones, frames.ts:42-87).
- build.ts particle build, cinders, dust puffs, speculative frame / construction guide dots, Relay landing bead, tip-burst landing, hit-stop (already 0 in Blend).
- stream.ts fake arrivals, SequencePlayer scripted beats, Autoplay, fake level synthesis for live use, backchannel (no real signal exists).
- Lab-only UI: Panels/DialKit/Agentation, window hotkeys (Stage.tsx:120-185), caption + progress bar, `__voiceLabEngine`.

Deferred bridges (v2, Sean picks later): Pen nib bleeding dot paper (nib div is DOM-measurable, draw-treatment.ts:287); a Burst "nod" pulse at first ink (sketch-job.ts markFirstInk :79); tip sparks when a screen closes.

## Approach

Seams, not a rewrite. Keep one engine. Add inputs so a host can drive it, and a production profile that turns the job channel off. Lab defaults stay as they are so /voice-lab behaves the same.

## Steps

### 0. Branch and worktree (orchestrator)
- `git worktree add .claude/worktrees/feat-voice-real -b feat/voice-real feat/stream`.
- Symlink `node_modules` from feat-voice-lab (it has dialkit/agentation/motion; feat/stream added no deps), `.env.local`, and the replay fixtures dir `docs/evidence/stream/spike-2026-09-13/` from feat-stream.
- Dev server port 3330.

### 1. Merge feat/voice-lab into feat/voice-real (implementer)
- `git merge feat/voice-lab`. Only conflict: BACKLOG.md (verified via `git merge-tree`). Resolve as union of both blocks.
- package.json auto-merges (stream added `test` script line 9; lab added 3 deps). HackathonFootnote.tsx: lab's version equals origin/main's; stream did not touch it since base.
- Gate: `npx tsc --noEmit`, `npm test`, `npm run build` pass; /voice-lab still plays; `/` stream replay still works.

### 2. Engine seams (general-purpose Opus builder + separate reviewer)
All in src/lib/voiceLab/. Lab behavior must not change.
a. Variable stage size. Replace module constants W/H (constants.ts:4-5; 15 refs in engine.ts incl. 411-429, 496-497, 1826, 1846, 2049, 2089-2090, 2315) with instance fields set by `resize(cssW, cssH, logicalW?, logicalH?)`. Lab passes 1440x900 as today; the real app passes the viewport size (logical = CSS px).
b. Split paper onto its own canvas. `drawBackground` (engine.ts ~1824-1846) draws into a second ctx (`attachPaper(canvas)`); when not attached, it draws into the main ctx as today (lab unchanged). Needed because in the real app the paper sits BEHIND React Flow nodes while marks + wash sit ABOVE them.
c. Injectable level source. `setLevelSource({ human?: () => Uint8Array, riff?: () => Uint8Array })`. When present, `levelDataForState` (engine.ts:1233-1254) and `riffLevelData` (1270-1274) read it instead of synthesis. Human onsets use the existing real-mic delta branch (1279-1282); add the same delta rule for Riff (replacing the synthetic schedule at 1307-1315) when a riff source exists. `enableRealMic` (getUserMedia, 1199) is never called by the real app.
d. Origin provider. `setOriginProvider(() => {x,y})` in CSS px; `getOrigin` (494-498) uses it when set.
e. Paper viewport transform. `setPaperTransform({x, y, zoom})` so the dot lattice pans/zooms with React Flow (phase = offset mod pitch×zoom). Tints are ephemeral and resample to nearest dot on change (reuse the Pitch-change resample at setPaperParams).
f. Production profile. `createProductionConfig()` returns config with `showFramesOn=false`, `cindersOn=false`, stream off, player not started, Blend preset selected, Ink & Wash morph, center origin, disc off.
g. Single source of tuned defaults. Seven engine defaults disagree with the baked DialKit panel defaults (onsetRingsOn engine.ts:133 vs Panels.tsx:424; glowEdgeAmount 167 vs 517; glowLayers 169 vs 519; glowRoleColor 170 vs 521; build arc 178 vs 823; dotPop 187 vs 855; cinderConfig 152-156 vs 791-795). Move the baked values into `src/lib/voiceLab/tuning.ts` (plain data). Panels reads its DialKit defaults from it; `createProductionConfig` reads it. Cross-check against memory `dialkit-pass-2026-09-13.json` `changed` (second value = Sean's).
h. Cleanup. `destroy()` (2319-2328) removes the hidden measuring SVG (414-422) and clears the backchannel timers (722-740, morph.ts:665).
Gate: tsc, build, /voice-lab eyeball matches captures lab-t5/lab-t8 (same preset, same timing), no console errors.

### 3. Real-app mount (general-purpose Opus builder + separate reviewer)
a. `src/components/VoiceStage.tsx` (client). Mounted once in `src/app/page.tsx` (tree at page.tsx:54-71). Renders:
   - paper canvas: `fixed inset-0 z-0 pointer-events-none`, behind `main` (page bg is bg-[#f4f4f5], page.tsx:54).
   - voice canvas (marks) + mask wrapper with fluid wash canvas: `fixed inset-0 z-10 pointer-events-none`, same slot as today's VoiceBar glow (VoiceBar.tsx:232-236, z-10), below the bar (z-20).
   - Reuses `buildGlow` mask (move from Stage.tsx:48-78 to a shared module so there is one copy).
b. Signals adapter `src/hooks/useVoiceStageSignals.ts`, wired where voice state is derived (ConversationPanel.tsx:176-200) and handed to VoiceStage through a tiny zustand slice or context (no per-frame setState):
   - voiceState mapping: speaking -> "riff-talking"; listening -> "you-talking" while input volume above threshold (attack 60ms), -> "silence" after 350ms below (fires `triggerAnticipation` with Blend's anticipation); silence (useMicSilence) -> "silence"; mic-blocked -> "dead-mic"; idle/connecting/allow-mic/connect-failed/dropped/ended -> "idle".
   - Level sources: `voice.getInputByteFrequencyData` (human), `voice.getOutputByteFrequencyData` (Riff) (useVoice.ts:203-206), read inside the engine frame, not in React.
   - Dev fixtures: when `?voiceState=` is set (ConversationPanel.tsx:122-132), feed synthetic level data (ConversationPanel.tsx:143-147) so headless captures work.
c. Origin: the pill's top-center, read from the VoiceBar pill element rect at frame start (before any DOM writes), so marks follow the bar when chat opens (VoiceBar.tsx:238-254, 260ms transition) and on mobile (bottom-14).
d. Paper transform: WireframeCanvas/FlowCanvas publish React Flow viewport {x,y,zoom} (they own the provider, WireframeCanvas.tsx:369) via `onMove`/`onInit` into the same slice. No canvas mounted (empty state) -> identity transform.
e. Remove what the lab replaces: VoiceBar fixed glow div (VoiceBar.tsx:232-236) and its glow classes; the radial gradient + `<Background>` in WireframeCanvas.tsx:333-351 and FlowCanvas.tsx:79-103. Pill, LevelMeter, VoiceHint, Caption, sketch chip unchanged.
f. `/voice-lab` in production: `notFound()` when `process.env.VERCEL_ENV === "production"` (previews and local keep it). Confirm dialkit/agentation/motion are not in the `/` route chunks after `npm run build`.
g. Hard constraint: no change to `render_artifact` in useVoice.ts:119-153 (diff of useVoice.ts must be empty or read-only additions outside the tool handler; return literal byte-identical).
Gate (evidence):
- tsc, `npm test`, `npm run build`.
- Captures at 1440x900 and 390x844: empty state idle; `?voiceState=speaking` + `__riffSketch(brief, kind, {replay:"R2-5"})` mid-ink; `?voiceState=listening`; chat open (marks follow the bar).
- Perf: 10s Chrome trace during replay + speaking fixture: no engine long tasks > 50ms, frame p95 <= 16.7ms on Sean's Mac; repeat at 4x CPU throttle and report.
- Stream intact: `__riffPen` idle reports and `__riffNodeRenders` unchanged vs feat/stream for the same replay.

### 4. Sean live review on :3330 (Sean)
Real mic and real Riff audio (headless mic is silent). Tune VAD attack/release thresholds if handoffs lag. Design notes go back as a batched fix pass.

### 5. "Open chat" tooltip (diagnose first, no fix committed)
Evidence so far: the only source of that text as a tooltip is the native `title={label}` on the chat button (VoiceBar.tsx:95, label from :355); no custom tooltip exists in src. Sean's screenshot shows macOS native tooltip chrome, the chat button in hover state, and the tooltip at the top-left of a region screenshot, consistent with the tooltip timer firing at the OS cursor position while the screenshot crosshair was at the selection origin (inferred).
Diagnose: Sean hovers the chat button in normal Chrome, no screenshot tool, waits ~1.5s. At the cursor -> screenshot artifact, close the item, no code change. Anywhere else -> real bug, plan a fix then.

### 6. Ship (orchestrator, on Sean's explicit nod)
- Pre-merge: `git merge-tree` feat/voice-real vs origin/main clean; `git fetch origin main:main`.
- Merging ships: feat/voice-ui's 10 VoiceBar commits, the real stream, the voice lab engine, the /voice-lab route (404 on prod).
- Push `feat/voice-real:main` with explicit refspec. Verify prod by curling for a string only this build contains, and one live voice session by Sean (streaming on Vercel prod is untested; maxDuration=60 is set).

## Files touched
- Engine: src/lib/voiceLab/{engine,constants,dotGrid,marks?,morph,types}.ts, new tuning.ts; src/components/voiceLab/{Stage,Panels}.tsx.
- App: new src/components/VoiceStage.tsx, new src/hooks/useVoiceStageSignals.ts (+ store slice in src/lib/store.ts or new), src/app/page.tsx, src/components/{ConversationPanel,VoiceBar,WireframeCanvas,FlowCanvas}.tsx, src/app/voice-lab/page.tsx.
- Off-limits: src/hooks/useVoice.ts render_artifact handler, src/lib/sketch-job.ts, draw-treatment.ts / Pen, canvas-slots.ts, API routes, generate.ts.

## Tradeoffs weighed
- Seams vs splitting VoiceEngine out of the lab engine: split is cleaner but touches a 2331-line engine whose presence/morph code references frames (Relay bead) and the player; seams keep the lab provably unchanged and ship sooner. Cost: job-channel code stays in the prod bundle, inert.
- One viewport canvas for marks vs a small canvas around the origin: viewport canvas is simplest and matches the lab's coordinate model; small canvas is cheaper per frame. Start viewport, measure, shrink only if the perf gate fails.
- Paper pans with the canvas vs fixed to the screen: panning keeps "drawing on paper"; fixed is simpler. Strawman: pans.

## Risks
- Per-frame dot tint allocates ~40k small arrays (engine.ts:2088-2105, fluidGlow.ts:411-435): GC stutter on mobile. The tint box is origin-bounded, so a larger viewport should not scale it, but verify.
- Full-viewport canvas at DPR 2 on a large monitor.
- DotGrid base render is 1x and upscaled (dotGrid.ts:82-85): soft dots on retina at viewport size.
- SDK frequency data bin count may not be 1024; band mapping (constants.ts:72-86) may read wrong bins.
- Output frequency data may be empty depending on SDK connection type, leaving Burst flat.
- fitView zoom < 1 makes pitch×zoom dense.
- VoiceBar glow removal changes the "thinking" look while a job runs (riff-glow-thinking, VoiceBar.tsx:222).

## Out of scope
Job-layer FX (sparks, cinders, build particles, speculative frame, Relay bead, landing), backchannel, DialKit on the real app, other sequence presets, evolve FX, mobile redesign, feat/load-logo.

## ASSUMPTIONS
A1. ElevenLabs `getInputByteFrequencyData`/`getOutputByteFrequencyData` return arrays the engine's band math can consume, and output data reflects Riff's voice.
A2. A full-viewport Canvas2D engine holds 60fps on Sean's Mac.
A3. Sean wants the paper to pan/zoom with the canvas (design fork).
A4. Sean wants marks rising from the voice bar pill, pill unchanged (design fork).
A5. Blend preset data + Ink & Wash morph are the whole choreography needed; scripted beats are not.
A6. The engine's module-level shared state (marks.ts:12-33, fluidGlow.ts:71-117, morph.ts:772) is safe because each page mounts exactly one engine.
A7. The tooltip is a screenshot artifact (to be diagnosed, not assumed in code).
A8. Turning off `showFramesOn` and `cindersOn` fully silences the job channel (no other job-driven drawing or DOM writes).
