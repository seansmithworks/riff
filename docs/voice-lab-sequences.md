# Riff voice FX: 10 choreography presets (build spec)

The ten presets share one model. Each is data on a single timeline, played by the engine's own clock; none forks the code. Beats are signals the real app already has (`onModeChange` in useVoice.ts:119, mic silence, render_artifact start/return). A preset only decides how visuals respond to those signals, so the winner carries straight into the real voice UI.

## 1. Research digest

1. Turn gaps average ~200ms across languages (Stivers 2009). Handoffs finishing much later read as lag. Riff's TTFB is 197ms, so visuals can keep human tempo.
2. ~40% of speaker changes overlap, ~40% have a gap (Heldner & Edlund 2010). Hard cut is least natural; outgoing mark fading with 100–170ms overlap is closer to real talk.
3. Listeners predict turn ends (Levinson & Torreira 2015). Anticipation is fair for Riff's turn (trigger: human stops). Human's turn is unpredictable → pure input feedback, ≤150ms ease-out.
4. Backchannels ~4.3/min (5.2 casual) and don't take the floor (Sesame TurnBench). Riff "mm-hm" blip ≤50% presence, never replaces the Ripple.
5. Barge-in aborts Riff. Asymmetric motion: Riff leaves ≤140ms, enters over 200–420ms.
6. Gemini: "anticipation, then release", directional gradients. Glow gets a directional envelope, not a static wash.
7. Siri's glow starts where activated. Everything grows from the disc → works at center or right origin.
8. Riff needs no "thinking" state; the sketch job is its thinking, sparks make it visible alongside talk.
9. Sidechain ducking: 1–5ms attack, 100–300ms release. Voice = vocal, job = bed: cinders dip under speech, swell in gaps. Job yields visually, never suppresses voice.
10. Hit-stop 40–80ms sells weight. No screen shake (glow is a DOM layer).
11. Smear frames (1–2 frames) and animating on twos/threes read hand-made. Boil as a first-class clock gives hit-stop and stop-motion almost free.
12. Squash/stretch/follow-through: mic disc is Riff's mouth — squashes on anticipation; marks spring in with bounce ≤0.2.
13. Call-and-response leaves rests; canon staggers. Job "speaks" in gaps; frames ink in with 30–60ms stagger.
14. Reduced motion = fewer, gentler animations keeping opacity/color. WCAG 2.3.1: boil ≤3Hz.
15. Handoffs happen dozens of times per session → short. Theatrical budget goes to the rare moment: the landing.

## 2. Sequence data model

New `src/lib/voiceLab/sequence.ts` (types + player), new `src/lib/voiceLab/sequences.ts` (10 presets).

```ts
export type Ease =
  | { kind: "bezier"; p: [number, number, number, number] }
  | { kind: "spring"; bounce: number }      // Apple-style; Tween.ms = duration
  | { kind: "steps"; n: number };
export type Tween = { ms: number; ease: Ease };

export type Beat = { at: number } & (
  | { kind: "voice"; state: VoiceState }
  | { kind: "yield" }                        // human stopped → voice "silence"; anticipation trigger
  | { kind: "backchannel" }                  // Riff blip; floor stays with human
  | { kind: "job"; event: "start" | "ready" | "clear" } // ready → landing.policy decides when it plays
);

export type SequencePreset = {
  id: string; hotkey: "1"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"0";
  name: string; thesis: string;
  loopMs: number; beats: Beat[];
  handoff: {
    style: "cut" | "crossfade" | "throughDisc"; // crossfade = alpha only; throughDisc = collapse into / grow from disc
    humanIn: Tween; humanOut: Tween;           // humanIn.ms ≤ 150, always
    riffIn: Tween; riffOut: Tween;             // riffOut doubles as barge-in yield
    smearFrames: 0 | 1 | 2;                    // incoming reach ×1.6 for N frames
    entryPunch: number;                        // onsetPulse on entry, 0–1.5
  };
  anticipation: { depth: number; ms: number }; // on yield: disc squash + glow dip
  backchannel: { presence: number; ms: number };
  silenceHolder: "human" | "riff" | "none";    // riff = Burst lingers at 0.25
  breathe: { periodMs: number; depth: number };// idle + silence: disc scale, glow opacity
  stepFps: number;                             // 0 = continuous mark clock
  markPeak: number;                            // × Sean's tuned mark alpha
  envelope: { attackMs: number; releaseMs: number }; // glow follower + job duck
  glow: { level: Record<VoiceState, number>; hueBias: number; follow: number; swell: number };
  job: { emit: "stream" | "onsets" | "gaps" | "none"; duck: number; burstUnderlay: number };
  landing: {
    policy: "immediate" | "nextGap"; maxHoldMs: number;
    hitStopMs: number; tipBurst: number; riffNod: boolean; inkStaggerMs: number; // stagger total capped 600
    impact: { kind: "ticks" | "none" } | { kind: "squash"; bounce: number };
  };
};
```

Glow opacity = `level[state] × (1 − follow + follow × voiceLevel)`, smoothed by `envelope`. Glow scale = `1 + (swell − 1) ×` that same value.

Easing tokens: OUT `(0.23,1,0.32,1)` · INOUT `(0.77,0,0.175,1)` · ARRIVE `(0.16,1,0.3,1)` · EASE `(0.25,0.1,0.25,1)`.

## 3. Engine additions (verified against feat/voice-lab @ 8e7efd6 — re-check line numbers, they drift)

1. **Sequence player.** Tick inside `renderFrame` (engine.ts:529-556); replaces the `Autoplay.run` script (autoplay.ts:45-83). Current `sleep` polls every 100ms (autoplay.ts:17-28) — too coarse. Keep Autoplay's `start/stop/onRunningChange` surface (Stage.tsx:89-118). Player owns land-hold policy and slow motion. Skip the 14s auto-land timer while the player drives (engine.ts:259-261).
2. **Per-role presence envelopes.** `drawVoiceLayer` (engine.ts:414-492) is either/or on voice state. Replace with tweened `presence` per role that retargets from current value (springs carry velocity). Draw both roles when presence >0.01, incoming on top. Compute both roles' bands every frame (428-431, 451-454), feeding silence to the non-speaker so the outgoing mark decays naturally. Point `lastMarkContext` (132, 425) at Burst whenever its presence >0 so backchannel/underlay keep ray tips live.
3. **Fading/scaling marks.** `strokePath`/`strokeChain` (marks.ts:18-55) set fixed `globalAlpha`, so an outer alpha can't fade a mark. Add module-level `alphaMul` next to `ctx` (13-16); apply in both helpers and in direct alpha writes at 599 (Stipple) and 873 (Smear). Add `presence` and `smear` to `MarkDrawArgs` (types.ts:43-53). Burst `draw` (107-152) and `getTipEmitters` (155-187) must scale `len` identically (they mirror). Ripple (933-960) grows radius out from 22.
4. **Disc squash.** `drawMicDisc` (marks.ts:1071-1079) takes sx/sy via `roughEllipse`. Drives squash, breathing, anticipation.
5. **Mark clock.** Pass `markT` (dt × timeScale, frozen during hit-stop, quantized when `stepFps>0`) instead of raw `t` into marks (435-487) and boil (418-421). Mic sampling stays real-time.
6. **Glow driven per frame, outside React.** Today: one div with gradient + mask + CSS `transition-opacity duration-200` (Stage.tsx:188-198), updated only via `emitStatus` → setState (engine.ts:199-216; Stage.tsx:145-167). Per-frame setState = 60 re-renders/s — don't. Split into a static mask wrapper (owns `maskImage`, never animates) with two gradient children (cyan, lime). `buildGlow` (Stage.tsx:47-71) returns one background per hue — stays the single source. Engine gets `attachGlow({cyan, green})` and writes only `opacity` and `transform: scale()`; remove the CSS transition. Mask on a never-moving wrapper means swell can't reintroduce an edge line.
7. **Job ducking + emit modes.** `updateSketchSpawning` (501-527): multiply rate by duck envelope. `onsets`: spawn 3–5 tip sparks from `maybeDetectOnset` (342-369) and `maybeDetectRiffOnset` (373-381). `gaps`: spawn only in idle/silence. `drawCinders` (frames.ts:510-568): alpha multiplier on drift alpha (526).
8. **Landing.** New `spawnTipSparks(emitters, n, dustPuffs)` modeled on `spawnDustPuff` (frames.ts:222-241). Hit-stop and `riffNod` (`riffOnsetPulse = 1`) in `beginLanding` (engine.ts:276-280). Squash scales the frame around its center inside `drawFrames` (384-437). Stagger = per-element start offset in the reveal loop (425-426).

Canvas2D cost flags:
- MUST FIX BEFORE STAGGER: `drawInkingReveal` (frames.ts:454-471) creates an SVG path and calls `getTotalLength()` per element per frame. Cache `len` in `buildFramePaths` (138-167), which already measures each path.
- Overlap doubles stroke work (~70 `roughLine` + `new Path2D` per frame). Fine at 60Hz; watch `onsets` emission vs the 500 cinder cap at 120Hz.
- Never animate `shadowBlur` (409-411); no canvas blur/filters on crossfades.

## 4. Presets

Beat timelines (every loop starts idle at 0; `clear` = job none + voice idle). Columns: you · bc (backchannel) · yield · riff · job start · you (barge-in, lands while Riff talking) · yield · riff · ready → lands · silence · clear.

| # | loop | you | bc | yield | riff | job | you | yield | riff | ready → lands | silence | clear |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1,2,3,5,7 | 14000 | 800 | 2000 | 3400 | 3600 | 4400 | 6400 | 8600 | 8800 | 10200 → 10200 | 11400 | 13200 |
| 10 | 14000 | same as above | | | | | | | | 10200 → 11400 | 11400 | 13200 |
| 4 | 15000 | 600 | 1700, 2900, 7600 | 3800 | 3950 | 4600 | 6500 | 8700 | 9100 | 9800 → 11600 | 11600 | 14000 |
| 6 | 16000 | 700 | — | 2700 | 3400 | 4000 | 6300 | 8300 | 9000 | 9600 → 11000 | 5600, 11000 | 14800 |
| 8 | 11000 | 500 | 1300 | 2300 | 2450 | 2900 | 4600 | 6200 | 6350 | 7400 → 7400 | 8600 | 10300 |
| 9 | 12000 | 750 | 2000 | 3250 | 3625 | 4375 | 6250 | 8000 | 8375 | 9500 → 9500 | 10500 | 11500 |

(For nextGap presets the "lands" time is the expected result of the policy given the beats, not a separate beat.)

BASE (every preset starts from this): handoff `cut`, all tweens 0, smearFrames 0, entryPunch 0 · anticipation 0 · backchannel 0 · silenceHolder `human` · breathe off · stepFps 0 · markPeak 1 · envelope 0/0 · glow levels all 1, hueBias 0, follow 0, swell 1 · job `stream`, duck 0, underlay 0 · landing `immediate`, hitStop 0, tipBurst 0, riffNod false, stagger 0, impact `ticks`.

**1 · Hard Cut** — today's lab retimed into the model; the control. Axis: cut / byproduct / realistic. Params: BASE.

**2 · Breath** — ChatGPT-calm; one soft presence that breathes between turns. Axis: calm / crossfade / balanced. Handoff crossfade: humanIn 120 OUT, humanOut 220 OUT, riffIn 260 ARRIVE, riffOut 140 OUT. Glow envelope 60/400; levels idle .55, you .8, riff 1, silence .6, dead .3; hueBias .3; follow .35. Breathe 4500/.04. (Deliberate: glow release 400ms — ambient light as audio release.)

**3 · Through the Disc** — the disc is the mouth; each voice is swallowed and re-emerges. Axis: morph / mark-led. Handoff throughDisc: humanIn 120 OUT, humanOut 180 INOUT, riffIn 420 spring(.2), riffOut 120 INOUT; entryPunch .5. Anticipation .10/160; breathe 4000/.03; envelope 80/300. Landing stagger 30. (Deliberate: riffIn 420ms spring, feels ~300ms.)

**4 · Mm-hm** — turn-taking science made visible: backchannels, overlap, a polite landing. Axis: calm / hyper-realistic. Handoff crossfade: humanIn 100 OUT, humanOut 320 OUT (0–170ms overlap), riffIn 200 OUT, riffOut 110 OUT. Anticipation .05/150; backchannel .35/260; silenceHolder `riff`. Glow envelope 80/500; levels idle .6, you .85, riff 1, silence .7, dead .3; follow .25. Job duck .4, underlay .2. Landing nextGap, maxHold 2000, riffNod. (Deliberate: humanOut 320ms release tail.)

**5 · Sidechain** — light carries the turn; voice ducks the sketch like vocals over a bed. Axis: glow-led. Handoff crossfade: humanIn 120 OUT, humanOut 200 OUT, riffIn 220 OUT, riffOut 120 OUT. markPeak .5. Glow envelope 30/250; levels idle .35, you .9, riff 1, silence .45, dead .15; hueBias 1; follow .9; swell 1.12. Job duck .8. Breathe 5000/.06.

**6 · Call & Response** — the sketch answers in the rests. Axis: morph / sparks as narrative / stylized slow. Handoff throughDisc: humanIn 120 OUT, humanOut 240 INOUT, riffIn 380 spring(.15), riffOut 140 INOUT. Anticipation .12/240; silenceHolder `riff`; breathe 3000/.05. Glow envelope 120/500; levels idle .5, you .75, riff 1, silence .9, dead .3. Job emit `gaps`. Landing nextGap, maxHold 2500, hitStop 70, tipBurst 24, riffNod, stagger 50. (Deliberate: 700ms rests, slower than human norm.)

**7 · Catch** — your words become the sparks that become the sketch. Axis: sparks as narrative / realistic. Handoff crossfade: humanIn 100 OUT, humanOut 200 OUT, riffIn 240 ARRIVE, riffOut 120 OUT. Backchannel .25/220. Job emit `onsets`, underlay .3. Landing tipBurst 40, riffNod, impact squash(.2), stagger 40.

**8 · Juice (bold)** — manga smash cuts and game hit-feel; the landing is an event. Axis: theatrical / cut / stylized fast. Handoff cut, smearFrames 2, entryPunch 1.2. Anticipation .18/90; backchannel .5/120. Glow envelope 5/150, follow .6, swell 1.10; levels idle .5, you .9, riff 1, silence .6, dead .2. Job emit `onsets`. Landing tipBurst 60, hitStop 100, riffNod, impact squash(.35), stagger 30. (Deliberate: hit-stop 100ms, bounce .35.)

**9 · Flipbook (bold)** — paper stop-motion; marks animate on threes while light stays smooth. Axis: stepped / stylized. Handoff crossfade: humanIn 125 steps(1), humanOut 250 steps(2), riffIn 375 steps(3), riffOut 125 steps(1); smearFrames 1; entryPunch .6. stepFps 8; breathe 3000/.05. Glow envelope 100/400, never stepped; levels idle .6, you .9, riff 1, silence .7, dead .3. Landing stagger 60, batched by the 8fps clock.

**10 · Still Water (reduced-motion by construction)** — identity through hue and opacity only; nothing travels. Axis: calm / glow-led. Handoff crossfade: humanIn 150 EASE, humanOut 300 EASE, riffIn 300 EASE, riffOut 150 EASE. markPeak .8; stepFps 3 (≤3Hz boil). Glow envelope 300/600; levels idle .4, you .8, riff .8, silence .5, dead .2; hueBias .6. Job emit `none`. Landing nextGap, maxHold 1500, impact none.

**B · Blend (strawman, orchestrator's recommendation)** — Mm-hm's turn-taking with Catch's sparks. All of 4 · Mm-hm's beats, handoff, anticipation, backchannel, silenceHolder `riff`, glow, and landing policy `nextGap`/maxHold 2000/riffNod, kept as-is (including duck .4) — with 7 · Catch's job emit `onsets`/underlay .3 and Catch's landing punch (tipBurst 40, impact squash(.2), stagger 40) merged in. Composed directly from the Mm-hm and Catch preset objects, not retyped, so it tracks either if they change. Fresh installs (no persisted Sequence panel value) default here.

## 5. Picker UX

- **Panel.** New `SequencePanel` first in Panels.tsx: select labeled "1 · Hard Cut" etc. + `play` toggle, persisted under `persistKey("sequence")`. `play` replaces the Voice panel's `autoplay` (Panels.tsx:43) — loses only a play/pause boolean, no tuning.
- **Keys.** `1`–`9`, `0`: select preset, reset (job none, presences 0, cinders cleared), play from 0. `` ` ``: flip to previous preset (A/B). `Z`: toggle 0.25× slow motion. Voice-state keys move from digits (Stage.tsx:102-105) to `Shift+1–5`. `S` and `L` unchanged. Add `SELECT` to the focus guard (96-101).
- **Caption.** Status line (Stage.tsx:201-205) becomes "3 · Through the Disc — the disc is the mouth", with a thin loop progress bar under it showing beat ticks.
- **Precedence** (presets never call DialKit `setValue`, never touch DialKit versions):
  1. Sean's saved dials = the full-presence look (mark tuners, colors, glow shape, cinder settings, toggles).
  2. Presets only scale or gate: numbers multiply (glow level × his strength, markPeak × his alphas, duck × his cinder alpha); booleans AND (his Cinders off beats any preset). Preset values live in code only, never persisted.
  3. Reduced motion (toggle or OS) swaps the active preset's motion settings (handoff, anticipation, breathe, stepFps, swell, follow, job, landing) for Preset 10's. Beats, glow levels, hueBias stay.
  4. Manual keys pause the player but keep the preset's transition style.

## 6. Risks

- Anticipation relies on silence detection, which misfires on mid-sentence pauses. Squash must undo within ≤150ms if the human keeps talking. Perfect lab beats hide this.
- `nextGap` delays an artifact the user already waited 11–19s for. Capped `maxHoldMs` is mandatory.
- Hit-stop briefly freezes the voice mark on landing, bending "job never touches voice". Freeze mark clock only, never level/state; cap 110ms.
- Perf: Safari with masked composited glow layers; `onsets` emission at 120Hz.
- Persisted dials can hide changes. Don't rename existing persist keys. Cinders use `Math.random`; seed if comparisons get recorded.

Sources: Stivers et al. 2009 (PNAS) · Heldner & Edlund 2010 · Levinson & Torreira 2015 · Sesame TurnBench · Google Design: Gemini visual design · ElevenLabs UI Orb · sidechain compression (Unison) · game feel on the web · Bloop: smear frames.

## 7. Fluid glow, pigment mix, Amoeba, disc squash & stretch (Sean's second pass)

Four asks off the 10-preset review, all wired to dials (`src/lib/voiceLab/fluidGlow.ts`, `engine.ts`, `marks.ts`, `Panels.tsx`).

**Fluid "shader" glow — no WebGL.** `renderFluidGlow` (fluidGlow.ts) computes a 96×60 (`FLUID_W`×`FLUID_H`) density field on the CPU each frame — 2-4 slowly drifting Gaussian blobs per role, positions driven by `sin`/`cos` of engine time (no simplex/Perlin noise; cheap and always smooth) — and `putImageData`s it onto a small `<canvas>` that Stage.tsx upscales via ordinary browser canvas-to-CSS-size scaling (bilinear by default). It lives as a third child inside the existing mask wrapper in Stage.tsx, alongside the two classic gradient divs; the engine (`updateGlow`, engine.ts) only ever writes that canvas's own `opacity`/`transform`, exactly like the classic gradients — the wrapper and its `maskImage` never move. `Glow → Style` (Panels.tsx) picks Fluid (default) or Classic; switching never touches the classic gradients' own dials.

**Pigment mixing, not light mixing.** Each pixel's human/riff density is combined by routing explicitly through Riff's brand green (`#3FBA6A`, DESIGN.md `accentDecorative`) at the 50/50 point — `frac = riffDensity / (human+riff)`, then blend human→green for `frac < 0.5` and green→riff for `frac > 0.5` — rather than a straight RGB or hue lerp (a straight RGB lerp of blue+yellow averages to gray; a hue lerp from 240° to 60° is directionally ambiguous). Equal densities always resolve to the brand green regardless of which human/riff hues Sean picks. Dials: Human color, Riff color, Mix softness (widens/narrows the green blend region), Flow speed, Blob scale, Blob count.

**`hueBias` reinterpreted for fluid only.** Classic mode's `effectiveColorMix()` (engine.ts) is untouched — same formula, same presets. Fluid mode instead reads role-color dominance from a dedicated **"Role color" dial** (Glow panel, 0-1, default 0.8), not `hueBias` directly: **0 = always the shared green blend, 1 = pure role colors** (the pixel color computed above is itself `lerp(green, mixedColor, dominance)`). This is the *opposite* sense from what `hueBias` meant for classic (there, `hueBias=1` pushed toward pure lime/green, `0` toward Sean's own cyan/lime dial). A preset's own `glow.hueBias` only ever *scales* the Role color dial, and only when the preset explicitly set one — tracked as `hueBiasExplicit` on `SequencePreset["glow"]` (sequence.ts/sequences.ts), true only for presets whose `Overrides.glow.hueBias` is defined. Every preset that inherits `BASE.glow.hueBias` (`0`, most presets, including 1 · Hard Cut and 4 · Mm-hm) counts as "no opinion" — `hueBiasExplicit` is `false`, so dominance is just the dial (0.8 default), and those presets read role-distinct (human blue, Riff yellow, overlap green) rather than collapsing to the shared green wash the old direct-`hueBias` reading gave them. Presets that do set `hueBias` (2 · Breath `.3`, 5 · Sidechain `1`, 10 · Still Water `.6`) scale the dial down/up from there — `engine.ts#roleColorDominance()` is the single source of truth: `dial × (hueBiasExplicit ? clamp(hueBias) : 1)`. No preset's stored `hueBias` value changed.

**Amoeba mark.** New shared mark (`marks.ts`, id `amoeba`, num 14) — a single closed rough loop whose radius bulges per voice band (`amoebaOutline()`, borrowing Riff Arcs' band-driven wobble and Scribble Loop's rough-ellipse stroke language, kept to one loop). `draw()` and `getTipEmitters()` both call `amoebaOutline()`, so sketch-job sparks leave exactly the bulges on screen (local maxima in radius). It's role-agnostic like every mark — its stroke color and voice bands are whichever role has it assigned. **Amoeba is now the default human mark** (replacing Ripple); Riff's default stays Burst, unchanged. A one-time, version-gated migration (`migrateHumanMarkToAmoeba()`, Panels.tsx, module scope) flips only a previously-saved `voiceLab.voiceRole.human` mark selection of `"ripple"` to `"amoeba"` — every other stored value, including Ripple's own tuner values and anything under the Riff role, is untouched.

**Disc squash & stretch.** `computeDiscSquash` (engine.ts) now composes three multiplicative layers: the existing anticipation/breathe squash (unchanged), a role-presence target aspect (`human − riff` bias → vertical for human, horizontal for riff, volume-preserving `sx·sy ≈ 1`) reached via a hand-rolled damped spring (stiffness fixed, damping ratio from the `Squish bounce` dial) so handoffs overshoot through round, and a small level-driven wobble while talking. Reduced motion keeps the aspect target but forces critical damping (no overshoot) and drops the wobble term entirely. Dials: Stretch amount, Squish bounce, Wobble (new "Disc squash & stretch" DialKit panel).

## 8. Dot-grid paper & ink-and-wash (Phase A, `voice-lab-dotgrid-addendum.md`)

**Dot-grid paper.** `DotGrid` (`dotGrid.ts`) replaces the old flat dot-pattern background canvas with an addressable buffer: preallocated `Float32Array`/`Uint8Array` per-dot `ink`/`tint` state, a cached static base render (plain gray dots, redrawn only when Pitch/Dot size/Base opacity change), and dirty-dot-only redraws each frame (`decay()` + `draw()`, called from `engine.ts#drawBackground`) — idle cost is one `drawImage`. Exposes `nearestDot`, `lightDot`, `setTint`, `decay`, `bleedAlongPath` for the wash/bleed hooks below and for Phase B's spark-landing. New "Paper" DialKit panel: Paper on/off, Pitch, Dot size, Base opacity.

**Watercolor wash.** `renderFluidGlow` (fluidGlow.ts) now composites 1-3 translucent "glaze" layers at small fixed spatial offsets (alpha-over, not one smooth density ramp), multiplies the result by a static once-generated paper-grain texture (mutes only, never brightens), and darkens pixels near the field's own alpha gradient (a Sobel-lite magnitude) for a drying-wash rim. The human/riff boundary sample point is warped by that same grain field (scaled off Grain) so the pigment mix bleeds along an irregular edge instead of a linear crossfade ("wet-in-wet"). New Glow-panel dials: Edge (rim darkening), Grain (granulation strength), Layers (1-3 glazes).

**Glow as texture (Style: Wash/Dots/Both).** The Glow panel's `style` select gains two options alongside the existing `fluid` (relabeled "Wash") and `classic`: `dots` and `both` (new default for fresh installs; existing persisted `fluid`/`classic` values are untouched). `dots`/`both` sample the finished field pixels (`sampleFluidPixel`) onto dot-grid paper within the field's own footprint (`engine.ts#tintDotsFromField`, bounded to an origin-centered box so cost doesn't scale with card size) — the wash shows through the paper as tinted, brightened dots even when the wash canvas itself is hidden (`dots`-only).

**Stroke bleed.** `DotGrid#bleedAlongPath` tints dots within `8-14px` (scaled by the new Bleed dial, default 0.5) of a given point, falling off with distance. `frames.ts`'s existing ink-reveal (`drawInkingReveal`) takes an optional `measurePath`/`onInkAdvance` pair — when passed, it samples the ink head's current world-space point each frame and reports it via callback, with no other change to the reveal itself (Phase B restructures it). `engine.ts#onInkAdvance` is that callback: it bleeds the active speaker's color at the reported point.

**Role-color dominance.** See §7 above — the "Role color" dial and `hueBiasExplicit` semantics.

## 9. Sparks build the sketch (Phase B, `voice-lab-build-plan.md` / dotgrid addendum §3)

**Subpath split (load-bearing fix).** Every drawably path (`roughRoundedRect`/`roughLine`/`roughEllipse`) emits two `M` subpaths; a single `setLineDash` restarted per subpath, so the old reveal finished both by t≈0.5. `frames.ts`'s `BuiltPath` now carries `passA`/`passB` (split via `constants.ts#firstStroke`/`secondStroke`), their own `lenA`/`lenB`, and `samples` — pass A sampled once at build time at a fixed ~8px spacing with cumulative arclength, so runtime code never calls `getPointAtLength`/`getTotalLength` again. Pass B trails pass A by a fixed 0.38 fraction of the path's own duration (`build.ts#BUILD_PASS_B_TRAIL`).

**Two build layers, not one.** The *wait* (before landing) never gets a particle build of its own: `frames.ts#drawSpeculativeFrame` lights dot-grid dots along the device outline + four generated construction guides (header/footer bands, side margins — honest at any platform guess, never real element geometry), gated by the **Speculative frame** (Off/Construction/Full ink) and **Guide dots** (Off/Lit dots/Lit dots + faint lines) dials. The landing sequence itself is the one real particle build (`build.ts#planBuild`), spanning tier 0 (outline) → tier 1 (rect/circle) → tier 2 (line/cross), wave-major across frames with a 90ms per-frame offset — "device frame first, then structure, then detail" reads as one continuous landing gesture rather than two separate builds stitched together. This is a deliberate simplification of the build-plan's own loop diagram (which shows tier 0/0.5 building during the wait): Sean's later dotgrid-addendum refinement ("draws as lit grid dots only") supersedes it.

**Pooled particles.** `BuildPlan.particles` is a Structure-of-Arrays (`Float32Array`/`Int32Array`) sized once per landing at plan-creation time — `updateBuild` never allocates per frame. Each build path gets `clamp(density × lenA/100, 2, 24)` particles (density per tier: frame 2.5, blocks 2.0, details 1.2 per 100px), each targeting a point along the path's own arclength; arrival time is locked to the moment the ink head (clock-authoritative, driven by `startMs`/`durMs`) would reach that point, so ducking/capping particles never stalls the drawing. Flight duration is `clamp(180 + dist×0.28, 220, 380)ms / flightSpeed`, eased `EASE_OUT`, bowing away from the canvas center by `arc × chordLength × sin(π·t)`. Launch points recruit the sketch phase's existing drift cinders, bearing-sorted from the origin (`engine.ts#beginLanding`). Total scheduled particles are capped at 600 (uniform density scale-down beyond that) and at most 240 concurrently in flight.

**Grid landing.** Every particle arrival and every build path's live ink head pops the nearest dot-grid dot (`DotGrid#lightDot`, gated by the **Snap to grid** and **Dot pop** dials) — the dotted leader the pooled particles draw *is* the grid lighting up ahead of the pen, which the stroke then connects.

**Budgets & clamping.** `SequencePlayer#nextBeatAt` (new) finds the absolute time of the preset's next "clear" beat; `planBuild` clamps the whole build (uniform time-scale) to end ≥300ms before it, and to a 1800ms cold cap otherwise (scaled by the existing `landDurationMs`/900 master tempo). A fast `S`-then-`L` land and a slow (19s) hold both drive the *same* plan-creation call at the moment landing fires — tiers never restart, they always build from wherever the clock is.

**Ember floor.** `engine.ts#updateSketchSpawning`'s spawn-rate ramp used to hit a hard cutoff at 11s (`elapsed > 11000 → return`), leaving the canvas dead for the rest of a 19s hold; it now decays to a steady 4/s floor instead.

**Reduced motion.** `planBuild(..., reducedMotion)` zeroes all stagger and forces every path's duration to a flat 300ms, and skips particle scheduling entirely (`emptyParticleBlock`) — tiers crossfade in order (plain alpha over the full shape, `frames.ts#drawBuildPathInk`'s reduced-motion branch) instead of sweeping a dash reveal.

**Paper-pitch reallocation (Phase A should-fix).** `engine.ts#setPaperParams` used to drop all live `ink`/`tint`/`fieldTint` state on a Pitch change (new `DotGrid`, old one discarded). It now resamples every dot on the new grid from its nearest dot on the old one before swapping, so an in-flight build or wash survives the reallocation.

**New "Build" DialKit panel** (`persistKey("build")`, after Cinders & land): Flight speed (0.5-2, default 1), Arc (0-0.5, default 0.18), Density frame/blocks/details (2.5/2.0/1.2), Tier gap (-200…300ms, default -100, negative = overlap), Speculative frame (Off/Construction/Full ink, default Construction), Guide dots (Off/Lit dots/Lit dots + faint lines, default Lit dots), Arrival (Dots lead/Comet, default Dots lead), Snap to grid (default on), Dot pop (0-1, default 0.6).

**Preset changes.** `sequence.ts#BASE.landing.inkStaggerMs` moved from 0 (no-op before Phase B) to 40 — it is now the per-path stagger within a build tier, consumed by `planBuild`. No preset beat timelines or other values changed.
