1. WRONG

Path shorthand: **L** = `/Users/seansmith/Code/CreativeConvos/.claude/worktrees/feat-voice-lab/src/lib/voiceLab`, **S** = `/Users/seansmith/Code/CreativeConvos/.claude/worktrees/feat-stream/src`, **N** = `/Users/seansmith/Code/CreativeConvos/node_modules`. feat-stream's node_modules is a symlink to N. Installed versions: @elevenlabs/react 1.10.2, @elevenlabs/client 1.15.2, @xyflow/react 12.11.2.

**F1. Step 2c never reaches the marks under the production profile. Real voice would drive nothing.** Step 2f picks Ink & Wash, so `morphOn` is true. Under morph the engine skips both functions the plan patches:
- **Human:** `morphOn && !(this.config.realMicEnabled && this.analyser) ? this.blendTalk(synthesizeLevelData(t), talk!)` (L/engine.ts:1478-1481). The plan says `enableRealMic` is never called, so `analyser` stays null and the data is always synthetic.
- **Riff:** `data = morphOn ? this.blendTalk(synthesizeLevelData(t * 0.8 + 4000), talk!) : this.riffLevelData(t, active)` (L/engine.ts:1488-1490). `riffLevelData` is dead code under morph.
- **Wash:** activity follows `motion.energy`, which steps toward `lastLevel` (L/engine.ts:1789-1790, 2032-2039). So the wash is synthetic too.
- **Onsets:** under morph the drawn pulse is `motion.onset[role].value` (L/engine.ts:1486, 1495), not the delta-rule pulse step 2c edits. I haven't checked what sets its target.

Consequence: Amoeba, Burst and the wash animate the same whether Sean whispers, shouts or says nothing. Only the state flips are real. No gate catches it, because fixtures and headless captures are synthetic anyway, and synthetic motion looks alive, so Sean's live review could pass it too.

Fix: one seam at the two data call sites in `drawRole` (1478-1490). Injected data replaces `synthesizeLevelData` in both the morph and non-morph branches, `blendTalk` still runs on top (keeps the silence easing), and onset detection keys off "source present", not `realMicEnabled`.

**F2. The real risk is signal shape, not bin count.**
- **Bin count is fine.** `VoiceConversation.FREQUENCY_BIN_COUNT = 1024` (N/@elevenlabs/client/dist/VoiceConversation.js).
- **The bins are not raw FFT bins.** They are linearly resampled over 100-8000 Hz (`resampleVoiceRange`, N/@elevenlabs/client/dist/utils/volumeProvider.js; called from dist/platform/web/volumeProvider.js). With `BIN_COUNT = 410` (L/constants.ts:67) the band math reads only 100-3.2 kHz, in five linear slices. The lab's own real-mic path reads raw bins at fftSize 2048 (L/engine.ts:1207), roughly 0-9 kHz. So even the lab's "real mic" never matched what the SDK returns.
- **Every mark and Sean's DialKit pass were tuned on synthetic data.** `synthesizeLevelData` fills all 410 bins at 10-90 (L/constants.ts:57-64), a steady, lively level after GAIN 2.5.
- **The real input is heavily processed.** It goes through echo cancellation, noise suppression, auto gain and `voiceIsolation: true` (N/@elevenlabs/client/dist/platform/web/input.js) plus the analyser's default 0.8 smoothing. LevelMeter's GAIN is still marked UNCALIBRATED (S/components/LevelMeter.tsx header comment).

Consequence: expect near-zero bands in pauses and weak upper slices, so the tuned marks read flat or lopsided. Step 4 only tunes VAD thresholds. It needs a per-role gain, floor and curve dial (kept out of the band layout) that Sean sets live.

**F3. The claim in the Risks section that "the tint box is origin-bounded, so a larger viewport should not scale it" is false.** `tintDotsFromField` loops `for (let i = 0; i < dg.count; i++)` over every dot (L/engine.ts:2085-2105). The comment directly above it (2073-2084) says the box was deliberately removed.
- Per dot, `sampleFluidPixelBilinear` allocates 6 arrays (4 corner tuples, `out`, the return) (L/fluidGlow.ts:411-435), plus the `[r,g,b]` literal at engine.ts:2104.
- At pitch 12 (engine.ts:173, Sean's pass) a 1440×900 stage has about 8.6k dots, roughly 60k allocations per frame. At 2560×1440 it is about 24.7k dots, roughly 170k allocations per frame.
- `DotGrid.draw` builds and parses a new `rgba()` string for each dirty dot (L/dotGrid.ts:252). The dirty set grows with the wash footprint, which grows with the viewport (F5).

Cost scales with viewport area.

**F4. Step 2e rebuilds the whole paper grid every zoom frame, and the grid densifies at low zoom.**
- **Rebuild:** "reuse the Pitch-change resample at setPaperParams" means `new DotGrid(...)` (L/engine.ts:1846). That allocates 11 typed arrays, creates a new canvas, draws every dot as its own arc (L/dotGrid.ts:82-100), then resamples every dot.
- **When it fires:** zoom changes on every frame of the 400ms `fitView` (S/components/WireframeCanvas.tsx:323-324) and on every wheel tick.
- **Density:** the wireframe minZoom is 0.15 (WireframeCanvas.tsx:301, 346). Pitch 12×0.15 = 1.8 px gives about 373k dots at 1440×900 and about 1.09M at 2560×1440. That is roughly 28MB of typed arrays and a million arcs per rebuild, then a million bilinear samples and about 7M allocations per frame in the tint pass. A normal four-phone fit on a 1440 screen (zoom about 0.6) already nearly triples the dot count.

Consequence: multi-second stalls when the first sketch fits and on any zoom. The tradeoff "start viewport, shrink the marks canvas if perf fails" targets the wrong layer; the paper is the cost.

**F5. Stretching the 96×60 fluid field to the viewport distorts the wash Sean tuned.**
- **Aspect:** `softUnion` corrects aspect with the field's fixed `w/minDim` and `h/minDim` (L/fluidGlow.ts:167-168, 241), which assumes 16:10. The lab guaranteed 16:10 by contain-fitting (L/../../components/voiceLab/Stage.tsx:205-207).
- **Phone (390×844):** each field pixel becomes 4.1×14.1 CSS px, so blobs render as vertical streaks and the Sobel rim (fluidGlow.ts:365-370) smears.
- **Wide screens (2560):** 27 CSS px per field pixel versus 15 in the lab, so it looks muddier. Blob offsets and sigmas are normalized, so the footprint also grows with viewport width.
- **Vertical anchor:** the wash anchors at `glowHeight/100` of the canvas (L/engine.ts:2050), not at the origin provider. Step 2d moves the marks, but only the wash's x.

**F6. Step 3a's `fixed inset-0 z-0` paper cannot sit "behind main", and it hides the empty state.**
- The page root (S/app/page.tsx:54), `main` (:57) and `body` (S/app/layout.tsx) are all non-positioned, and the root and body have opaque `bg-[#f4f4f5]`.
- CSS paints a positioned z-index 0 element above all non-positioned content in the root stacking context.
- The empty state (S/components/ArtifactCanvas.tsx:33-69: headline, "or type it", "See an example", the no-mic path) and `WireframeSkeleton` are non-positioned. The paper's opaque fill (L/engine.ts:1825-1826) paints over them. The buttons still take clicks but can't be seen.
- React Flow only survives because its wrapper is `position:relative; zIndex:0` (N/@xyflow/react/dist/esm/index.js:3721-3727), and only if the paper comes before `main` in the DOM. The plan never says where in the DOM it goes.
- A negative z-index hides the paper under the body and root backgrounds instead.

Fix: make `main` `relative isolate`, put the paper as its first child with `absolute inset-0`, and add `relative` to ArtifactCanvas's empty-state and skeleton wrappers.

The marks layer at z-10 is feasible as planned. It sits above React Flow, below the bar wrapper (z-20), RiffLogo and Header (z-30, S/components/Header.tsx:203, 253) and the CopilotKit popup (z-30, N/@copilotkit/react-ui/src/css/popup.css:5).

**F7. Step 2b leaves the marks canvas uncleared, so every frame smears into the last.** The only per-frame clear in the engine is `drawBackground`'s opaque `fillRect` (L/engine.ts:1824-1826). The only `clearRect` in voiceLab is the dot base cache (L/dotGrid.ts:93). Once the paper moves to its own canvas, the main canvas accumulates every stroke. It must also become transparent to sit over React Flow. The step 2 gate ("/voice-lab eyeball") can't see this, because the lab never attaches a paper canvas.

**F8. During `fitView` the paper lattice lags the frames by one frame.**
- React Flow writes the viewport transform straight to the DOM inside `store.subscribe` (N/@xyflow/react/dist/esm/index.js:3048-3068).
- `onMove` does fire for programmatic transitions: `!event.sourceEvent?.internal` with a null sourceEvent (N/@xyflow/system/dist/esm/index.mjs:2805).
- The fitView transition ticks inside d3-timer's own animation-frame callback (N/d3-timer/src/timer.js:11). That callback is registered after the engine's always-running loop, so for the whole 400ms swoop `renderFrame` reads the previous tick's viewport. Dots slide against the frames.

Fix: redraw the lattice synchronously in the viewport-change callback, not in the engine loop.

**F9. Step 3c's "read the pill rect at frame start, before any DOM writes" can't be guaranteed.** Four independent frame loops share the same frame, and they run in registration order:
- engine glow writes (L/engine.ts:1994-2017)
- LevelMeter style writes (S/components/LevelMeter.tsx loop)
- Pen, which reads rects and writes the nib transform (S/lib/draw-treatment.ts:185, 288, 575)
- d3-timer during fitView

A `getBoundingClientRect` after another loop's write forces a synchronous style recalc, and a full layout of the Pen/React Flow tree while the chip or chat transitions run (S/components/VoiceBar.tsx:64, 244-246). Cache the rect instead: refresh it on a ResizeObserver on the pill, on window resize, and per frame only between the wrapper's `transitionrun` and `transitionend`.

2. MISSING

**M1. Idle cost.**
- The engine loop never sleeps (L/engine.ts:2255-2259).
- `renderFluidGlow` evaluates all 5,760 field pixels × layers × 8 blob exponentials every frame even at zero activity. The `total < 0.003` skip comes after both `softUnion` calls (L/fluidGlow.ts:293-307).
- Add two full-viewport canvases being cleared and composited every frame, and the pill, Caption and Header backdrop blurs (VoiceBar.tsx:164, 273; Header.tsx:253) re-blurring over them.

The real app is idle most of the time. Add: sleep the loop when voice is idle, presence, wash and tints are below a small threshold, and the viewport is still; wake on state or viewport change. Add idle CPU to the perf gate.

**M2. No-session data is empty, not silent.** Without a conversation, `EMPTY_FREQUENCY_DATA = new Uint8Array(0)` (N/@elevenlabs/react/dist/conversation/ConversationControls.js:5). `computeBands` then pins every band at 0.2 (L/constants.ts:76), so marks sit at a fixed pose instead of rest. The adapter must treat length 0 as "no source".

**M3. Output-audio timing.** `signedUrl` forces a WebSocket connection (N/@elevenlabs/client/dist/utils/ConnectionFactory.js). The output analyser sits after the gain node (dist/platform/web/output.js), so it does reflect Riff's audio. But:
- `mode` flips to speaking when audio events arrive, before playback starts (VoiceConversation.js `handleAudio`), so Burst starts before any sound.
- `interrupt()` fades the gain over 2s (output.js), so Burst's level lingers for up to 2s after a barge-in while the state already says listening.

**M4. Local-silence anticipation will churn.** A 350ms local release fires `triggerAnticipation` on every pause inside a sentence. The server's end of turn is already exposed as `userTurnCount` (S/hooks/useVoice.ts:107, 200). Driving anticipation from that needs no change to the off-limits handler.

**M5. The paper loses crispness.** The DotGrid base is drawn at 1x CSS pixels (L/dotGrid.ts:82-85) and replaces React Flow's resolution-independent SVG dots (WireframeCanvas.tsx:351). Every retina screen gets softer dots. The plan lists this as a risk but has no step for it.

**M6. Viewport handoff jumps and goes stale.** ArtifactCanvas swaps between empty state, skeleton, WireframeCanvas and FlowCanvas. FlowCanvas remounts on every node-id change (`key`, FlowCanvas.tsx:83). Nothing resets the transform on unmount. The first fit is instant (duration 0, WireframeCanvas.tsx:323), so the lattice snaps from identity to the fitted zoom the moment the outline appears. Today's `<Background>` mounts together with its nodes, so there is no jump.

**M7. No automated evidence that the real signal reaches `drawRole`.** Headless mic is silent, and the fixtures are synthetic. Add a dev hook that pushes a recorded frequency-buffer sequence through the new level source and exposes the smoothed bands.

3. OVERVALUED / GOLD-PLATED

**O1. Step 2a (variable W/H across 15 engine refs, logical resize).** Cut. Mount marks and wash in a fixed logical 1440×900 stage anchored to the pill's top-center, scaled by roughly `clamp(vw/1440, 0.6, 1)`. That is the lab's coordinate model unchanged. It removes F5's distortion, bounds F3, keeps canvases small, and the existing `buildGlow` mask already fades the box edges. All W/H refs are in engine.ts only (verified), so no other module needs touching.

**O2. The engine's DotGrid as the real app's paper (steps 2b and 2e).** Cut. It buys F4, F6, F7, F8, M5 and M6 for a lattice that shows only in the gutters between 340px white frames. Instead:
- Keep React Flow's `<Background>` as the lattice, retuned to Sean's paper values (gap 12, size about 1, `rgba(212,212,216,0.3)`). React Flow already syncs it in the same DOM write as the nodes, keeps it crisp and handles zoom.
- The engine paints only the transient tinted and stained dots onto a transparent layer under React Flow, at the same world positions (`x mod 12·zoom`), limited to the wash's bounding box. A one-frame lag on soft tints is invisible.
- The empty state gets a static CSS dot background.

This removes base renders, rebuilds, resamples and the DPR problem.

**O3. The "4x CPU throttle" trace, as scoped.** It measures the wrong scenario (see E4). Replace it with the scenarios the plan actually risks.

4. EVIDENCE

**E1.** The origin-bounded tint claim contradicts the comment right above the function (L/engine.ts:2073-2084). It was trusted from memory of an earlier box implementation.

**E2.** For A1, the plan checked only that the getters exist on the hook (useVoice.ts:203-206). It never read:
- how the engine consumes data under morph (engine.ts:1478-1490)
- the SDK's resampling (volumeProvider.js)
- the SDK's bin constant

"Bin count may not be 1024" is a literal constant in VoiceConversation.js.

**E3.** The step 2 gate compares against lab-t5 and lab-t8, which run synthetic data with no paper canvas attached. It structurally can't see F1 or F7.

**E4.** The perf gate runs "replay + speaking fixture" at the default fit. It never exercises the conditions that break:
- zoom at 0.15-0.6 (worst dot density)
- wheel zoom and the fitView swoop (grid rebuild)
- idle battery
- the 390×844 portrait aspect (captures there would show the distortion, but there is no lab baseline at that aspect to compare against)

A 16.7ms p95 budget is also wrong for a 120Hz ProMotion display (8.3ms). I haven't checked Sean's hardware.

**E5.** The z-order claim ("same slot as VoiceBar glow z-10") checked z-index values only, not paint order for non-positioned content (F6). The z-index-only check isn't evidence: `app-idle.png` shows the empty state, not the paper sitting on top of it.

**E6.** The installed SDK comes through feat-stream's node_modules symlink to N. feat-voice-lab has its own install with the same @elevenlabs versions, so there is no SDK drift. N has no `dialkit` (verified), so any tree on the N symlink won't build after the merge.

5. WEAKEST ASSUMPTION

**A2: "A full-viewport Canvas2D engine holds 60fps on Sean's Mac."** As planned with step 2e it is false by arithmetic, not by measurement:
- The grid rebuilds every zoom frame (engine.ts:1846).
- The tint pass walks every dot with 6-7 allocations each (engine.ts:2088-2104; fluidGlow.ts:411-435).
- Dot count grows with viewport area and with 1/zoom² (up to about 1.09M dots at zoom 0.15).

If it fails, the plan's fallback (shrink the marks canvas) doesn't touch the cost, which is in the paper. Step 3 stalls at the perf gate and forces a redesign late, after merge and seams work is already done. O1 and O2 remove the assumption instead of testing it.

VERDICT: revise. Most important change: move the level-source seam into `drawRole`'s data selection (L/engine.ts:1478-1490) so injected SDK frequency data replaces `synthesizeLevelData` under Ink & Wash too, and prove it with a recorded-buffer dev hook. As written, every gate passes while Riff's real voice drives nothing.