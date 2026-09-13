1. WRONG.

**F1. The level-source seam (2c) hooks functions that the production profile never calls.** In Morph mode, and Ink & Wash is the production morph, `drawRole` bypasses both seams:
- **Riff:** `engine.ts:1488-1490` is `morphOn ? this.blendTalk(synthesizeLevelData(t * 0.8 + 4000), talk!) : this.riffLevelData(t, active)`, so `riffLevelData` (the 2c hook) is unreachable.
- **Human:** `engine.ts:1478-1481` synthesizes unless `this.config.realMicEnabled && this.analyser`. When that gate does pass, `levelDataForState` returns raw data with no `blendTalk`, which drops the F2 talk-spring fix.
- **Shapeshift:** synthesizes Riff separately (~`engine.ts:1530`).
- **Wash:** `motion.energy` reads `lastLevel` (`engine.ts:1789-1790`), so the wash also runs on the fake sine.

Consequence: Burst, and the wash, animate on a sine wave while real Riff audio plays. Every gate still passes, because `?voiceState=` fixtures are synthetic anyway. Fix: one `levelFor(role, t, talk)` used at all three call sites, with `blendTalk` applied to a copy of the SDK buffer. `blendTalk` mutates in place (`engine.ts:1261-1267`), and the SDK returns a shared buffer (`VoiceConversation.js:99-108`).

**F2. Splitting the paper off (2b) leaves the marks canvas uncleared.** `drawBackground`'s opaque `fillRect` (`engine.ts:1825-1826`) is the only per-frame wipe of the main canvas (`renderFrame` `engine.ts:2115`). Moving it to a paper ctx without adding `clearRect` on the marks ctx leaves marks, onset rings and the nib as permanent trails. The step doesn't mention this.

**F3. "Paper canvas `fixed inset-0 z-0` … behind main" is the wrong stacking model.** A positioned `z-index:0` box paints above all non-positioned content in the root stacking context.
- `page.tsx`'s root div and `<main>` are non-positioned, and so is the whole ArtifactCanvas empty state (headline, "or type it", "See an example").
- With the `#f4f4f5` fill carried over, the paper canvas covers the empty state completely (compare `app-idle.png`). Without the fill, dots draw over the text.
- Whether it lands above or below React Flow nodes then depends on DOM order. I couldn't find whether the `.react-flow` wrapper forms a z-0 stacking context (unverified).

Fix: make `main` `relative isolate`, render the paper as `absolute inset-0 -z-10` inside it, and never fill in host mode.

**F4. The perf risk note is factually false.** The plan says "The tint box is origin-bounded, so a larger viewport should not scale it." The code comment says the opposite: "Walks every dot rather than a footprint box" (`engine.ts:2074-2084`), and the loop at `engine.ts:2088` is over `dg.count`.
- Dot count is `(w-40)/pitch+1` × `(h-40)/pitch+1` (`dotGrid.ts:62-63`). At pitch 12: about 8.6k dots at 1440×900, about 24.7k at 2560×1440.
- Each dot's `sampleFluidPixelBilinear` allocates 6 tuples (`fluidGlow.ts:411-435`), so roughly 150k short-lived arrays per frame at 1440p.
- On top of that, every tinted dot gets a template-string `fillStyle` plus an arc (`dotGrid.ts:235-254`).

Step 2a (logical = CSS px) is exactly what makes this scale with viewport area. With paper panning, `dg.x(i)/W` is also world space sampled against a screen-space field, which is wrong unless it's transformed.

**F5. The ship push is non-fast-forward.** `git log 6974192..origin/main` shows `e39b54f` and `51051bf`, and neither is in feat/stream or feat/voice-lab. Step 6 runs `merge-tree` and `fetch` but never merges origin/main into feat/voice-real. So `git push origin feat/voice-real:main` is rejected, or tempts `--force`, which would delete the stack-popover commits. Every gate also ran on a tree that isn't the one that ships. Fix: merge origin/main (clean; `merge-tree feat/stream origin/main` exits clean, and HackathonFootnote lab vs origin/main is an empty diff), re-run the gates, then push.

**F6. The `/voice-lab` production 404 (3f) is mechanically fragile and an unrequested product change.**
- **Mechanism:** `src/app/voice-lab/page.tsx:1` is `"use client"`. `process.env.VERCEL_ENV` is not inlined into client bundles, so the gate only works if it happens to fire during server prerender.
- **Intent:** the code says the route is meant to be public: `Stage.tsx:100-101` ("/voice-lab is public on Vercel, so production builds never expose the engine on window") and `AgentationMount.tsx:3-5` (mounted "in production" by design).

If it's kept, use a server `page.tsx` wrapper. Either way it's a one-line fork for Sean, not a silent decision.

**F7. Step 5 contradicts the request, and its test can't work.** The request says "Include the 'Open chat' tooltip mispositioning fix." `BACKLOG.md:107` says "Fix before any ship." Step 5 commits no fix and can close with no code change.
- The test is "Sean hovers … in normal Chrome." But `sean-shot-0-0.png` shows Sean's browser is not stock Chrome: toolbar "Chat" button, split-view and pen icons (inferred: a Chromium-based AI browser).
- Native `title` tooltips are placed by the browser shell, so a clean result in Chrome proves nothing about Sean's browser. BACKLOG already says "not reproduced".

The structural fix doesn't depend on the cause: drop `title={label}` from IconButton (`VoiceBar.tsx:95`; `aria-label` is already at `:94`) and anchor a small CSS tooltip to the button. That removes the whole class in every browser, for both IconButtons (End session and chat). `Header.tsx:45` uses the same pattern.

**F8. The listening mapping breaks the plan's own capture gate.** 3b maps `listening` to `you-talking` only while `getInputVolume` is above threshold. Fixture mode has no session, so volume is 0 and the state becomes `silence` after 350ms. The `?voiceState=listening` capture (and `sketching`/`sketch-failed`, which map to listening at `ConversationPanel.tsx:179-183`) will never show the Amoeba. The "synthetic level data" in 3b feeds byte data, not the volume read that drives the state. Fixtures must set the engine voice state directly.

2. MISSING.

**F9. The origin at the pill's top-center sits under the caption and hint slot.**
- The caption/VoiceHint slot is `absolute bottom-full mb-2` directly above the pill, in the z-20 wrapper (`VoiceBar.tsx:257-270`).
- It shows in exactly the states where marks are active: listening, silence, speaking (`ConversationPanel.tsx:233-237`).
- Burst rises about 140px above origin (`lab-t5.png`). Sean's screenshot shows a white caption bubble in that spot, so the z-10 marks will be mostly hidden behind `bg-white/90`.
- The in-pill LevelMeter keeps running, so there are two level visualizations side by side.

A4 lists pill placement as a fork but not this collision. The strawman capture has to include a caption.

Also, reading `getBoundingClientRect` "at frame start" isn't controllable. Pen and LevelMeter run their own rAF loops that write DOM, and callbacks run in registration order, so this can force a synchronous layout every frame. Cache the geometry on resize, `rightInset` change and `transitionend` instead.

**F10. Nobody decides whether the wash sits above the sketch.** The plan defaults to "same slot as today's VoiceBar glow", but it's a different element:
- **Today's glow:** peaks at opacity 0.14–0.22 (`globals.css:59-90`) over the bottom 55vh.
- **Lab wash:** opacity up to 1.2 (`engine.ts:1989-1990`) over the full viewport, fading only at the mask edges.

At z-10 it tints the Pen-inked nodes Sean just approved, plus the footnote and Controls. CopilotPanel's z-index is unverified. That's a real design fork: wash above the nodes, or below them with the paper. It needs a capture of nodes under a speaking wash.

**F11. The "thinking" state loses its only ambient signal.** `riff-glow-thinking` fires whenever a job exists (`VoiceBar.tsx:222-223`). That's the only ambient response for a typed sketch with no voice session. Engine glow is keyed only by voice state (`engine.ts:1975-1977`), so after 3e a text-rail sketch shows nothing. The plan lists this as a risk but makes no call.

**F12. Resize and zoom churn is unplanned.**
- DotGrid is sized once at construction, with a 1x offscreen base (`dotGrid.ts:82-85`). Variable size means rebuilding it on every resize event.
- 2e's "reuse the Pitch-change resample" (`engine.ts:1840-1868`) runs `nearestDot` for every dot on every rebuild. During fitView's 400ms animated refit (`WireframeCanvas.tsx:323-324`), and B11 shows 4 fits per 3-job chain, that's a full rebuild every frame.
- The Ink & Wash stain writes `bleedAlongPath` at screen-space tip coordinates (`engine.ts:1679`). With a panning, world-space grid it needs a screen-to-world conversion, which isn't in the plan.

**F13. Mobile scale has no rule.** With logical = CSS px, a 390px phone gets marks and rings (`engine.ts:1321`, radius up to 122px) at lab-desktop size, where the lab would contain-fit them to 27%. The 96×60 landscape field (`fluidGlow.ts:17-18`) stretches over a portrait viewport. The 390×844 capture will show the problem, but nothing decides what it should look like.

3. OVERVALUED / GOLD-PLATED.

**F14. Cut tint resampling on transform changes (2e).**
- `fieldTint` is reassigned from the field every frame (`engine.ts:2085-2106`).
- Bleed tint comes only from frames (cut) and the stain, which decays in about 1s (`dotGrid.ts:163-181`).

Nothing survives long enough to be worth resampling. Pan should be a phase offset only; rebuild the grid on `onMoveEnd` when zoom changes.

**F15. The perf gate's thresholds are the wrong size.**
- If Sean's Mac is a 120Hz ProMotion display (not checked), "p95 ≤ 16.7ms" hides dropped frames; the budget there is 8.3ms.
- The 4x-throttle headless trace measures software raster, not the full-viewport DPR-2 canvas plus CSS mask compositing that actually costs.

Replace both with one real-Chrome trace on Sean's machine at his real window size during a replay.

**F16. The two plan risks about SDK bin count and empty output data aren't risks: I checked both.**
- `VoiceConversation.FREQUENCY_BIN_COUNT = 1024` (`VoiceConversation.js:93`), resampled to the 100–8000Hz voice range (`lib.iife.js:21380-21396`).
- `signedUrl` means a WebSocket connection with an analyser provider. Only WebRTC falls back to the no-op `NO_VOLUME` (`lib.iife.js:21371-21374`).
- LevelMeter already reads bins 0–409 of the same arrays in production (`LevelMeter.tsx:19-20`).

Remove them from Risks and A1.

4. EVIDENCE.

**F17. The wrong risk claim in F4 was never checked against `engine.ts`.** The contradicting comment sits 10 lines above the lines the plan itself cites (2088-2105).

**F18. Seam 2c cites line ranges without reading `drawRole`.** The ranges (1233-1254, 1270-1274, 1279-1282, 1307-1315) describe the Morph-off path only. The call sites that decide which one runs (1478-1490) were never read; this is F1.

**F19. The z-layer plan (3a) is asserted, not measured.** "Behind main" was inferred from class names. Nothing checked whether `main` or `ArtifactCanvas` are positioned, which they aren't, or what the engine's paper fill does to them.

**F20. The tooltip hypothesis trusts one screenshot and ignores the second.**
- "Consistent with the tooltip timer firing at the OS cursor position" is inferred, and the proposed test runs in a browser Sean doesn't appear to use (`sean-shot-0-0.png`).
- BACKLOG's description ("top-left of the canvas") is itself a reading of that same screenshot, not an independent observation.
- A Chromium tracker entry titled ["Dropdowns, tooltips etc. always render in top-left corner"](https://issues.chromium.org/issues/358041219) exists; it was sign-in-walled, so I couldn't read it.

The artifact hypothesis isn't the only live one, and it doesn't matter once the native `title` is gone.

**F21. Leftover staleness notes.**
- The dial JSON's `_source` still says "NOT yet baked into code", though `7fbb78d` baked it. The plan uses it correctly as a cross-check only, but whoever implements 2g should know the note is stale.
- The "seven disagreements" list was carried over from research, and I didn't re-diff all of it. Spot checks match: `onsetRings` false in `Panels.tsx:424`; `fluidEdge` 0.7, `fluidLayers` 3 and `roleColor` 0.75 in `Panels.tsx:517-521`.

**F22. "Step 0 symlinks work" holds, but it rests on an unstated fact.** feat-voice-lab's `node_modules` is a real directory containing dialkit, agentation and motion. The shared root `node_modules`, which feat-stream links to, lacks all three. Symlink to feat-stream's by mistake and the Step 1 build fails.

5. WEAKEST ASSUMPTION.

A5/A8, together with 2c's premise: that the production profile is the lab engine with inputs swapped in and the job channel switched off.

The engine's live-signal paths only work with Morph off, and Morph (Ink & Wash) is the one setting production requires (F1). The paper is also the only thing clearing the frame (F2). If this assumption is false, and the code says it is, the "seams, not a rewrite" estimate breaks:
- Level sourcing has to be refactored across all three `drawRole` branches.
- A clear pass has to be added.
- The paper needs a world/screen transform through tint, stain and field sampling.

Every visual gate still passes, because fixtures are synthetic. The failure only shows up in Step 4 with Sean on a real mic, after two Opus build-and-review passes have been spent.

VERDICT: revise. The single most important change: before any mount work, rewrite 2b/2c as one named refactor. It covers a single `levelFor(role)` used by every `drawRole` branch with Morph on, a `clearRect` for the marks canvas once the paper moves out, and a transparent host mode. Gate it with a test where an injected constant source visibly changes Burst under Ink & Wash.