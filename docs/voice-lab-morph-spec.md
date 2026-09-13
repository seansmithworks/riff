# Voice-lab morph spec: 5 transition options on one motion layer

Verified against `feat/voice-lab` @ `6771c2c`, Blend preset, fresh session, 390px and 1440px captures (`docs/evidence/morph/`, untracked).

**Why it jumps.** One shared cause produces most of the jumps. Across a state change, the only value that interpolates is per-role alpha (`presence`). Its tweens run 100–320ms on an ease-out that covers 60% of the fade in one frame at 100ms, and 60% by frame two at 200ms. Everything else is recomputed from discrete state every frame, so it steps: shape type, center, footprint, talking-vs-silence alpha, ray visibility, onset size, and the wash's shape and intensity (the wash is slaved to that same fast `presence`). The job channel has the same flaw at its edges: clear and job-start have no exit. One clock bug also flashes the cards opaque white for one frame at landing. Two tells: `handoff.style` (cut / crossfade / throughDisc) is never read, and no mark reads `g.presence`. Every preset's handoff is the same alpha fade at different speeds.

**Fix model.** A motion layer (`morph.ts`) sits between voice/job state and drawing. Every visual property becomes a spring or envelope stepped once per frame on one clock. The 5 options are choreographies on that layer, not easing swaps.

| # | Option | Feel on a phone | Character |
|---|---|---|---|
| 1 | **Still Breath** | The old mark exhales and shrinks away while the new one inhales in; the watercolor just changes tint. | Quiet |
| 2 | **Shapeshift** | The human's loop opens up and its bulges grow into Riff's rays; on barge-in the rays pull back and close into a loop. | Continuous morph |
| 3 | **Relay** | The speaker pulls its mark into one ink bead, holds a beat on brand green, and the other voice blooms out of it like a baton pass. | Handoff |
| 4 | **Ink & Wash** | The old mark sinks into the paper as a fading dotted stain while the new one is drawn on, stroke by stroke. | Ink metaphor |
| 5 | **Elastic** | A rubbery creature winds up, swaps mid-squash, overshoots into the new pose and wobbles to rest. | Expressive |

- **Lab control:** new DialKit "Morph" panel second in the stack, key `voiceLab.morph`, select Off + 1–5. Hotkey `M` cycles forward and `Shift+M` backward; neither collides with 1–0, B, Shift+1–5, `, Z, S or L.
- **Default on fresh install:** Ink & Wash. It is the most native to the ink-and-wash sketchbook, and it keeps human and Riff as two speakers (see Decisions).
- **Three foundation bug fixes ship in every mode, Off included:** the landing white-card flash, construction dots re-lighting after clear, and the landing fade under Cinders off. A/B compares choreography, not bugs.

---

## 1. Diagnosis

Blend beat times are loop-relative. Loop 1 starts idle; loops 2+ start in silence, because no beat returns to idle. Evidence strips are 60fps unless noted.

| Transition (Blend ms) | Snaps | Eases | Source |
|---|---|---|---|
| **T1 idle → you** (600, loop 1) | Idle squiggle removed the frame human presence passes 0.02. Amoeba reaches 60% alpha in 1 frame. Blue wash appears in ~3 frames. First onset 200ms later grows the radius ~+40% in 1 frame. | Glow opacity follower (attack 80ms) | engine.ts:1078-1080, 1290, 829, 837; marks.ts:93-96. `t1` frames 1-4, 15 |
| **T2 backchannel** (1700, 2900, 7600) | ~7 faint Burst rays blink inside the Amoeba for ~270ms (hardcoded 80ms in, 110ms out). The whole wash swings blue→teal→blue because wash follows presence. The release runs on `setTimeout`, off the frame clock. | None | engine.ts:537, 541, 1291; marks.ts:166. `t4` (30fps) |
| **T3 yield** (3800, 8700) | Nothing visible. Anticipation squashes only the mic disc, which is off by default. The only spring in the system draws on a hidden shape. | Disc spring (hidden) | engine.ts:902-925, 1053; Panels.tsx:220 |
| **T4 you → riff** (3950, 9100) | Amoeba's mode flips talking→silence in 1 frame (alpha 0.75→0.3) on top of its fade. Burst hits 60% alpha by frame 2. The shape type swaps: a 37px loop centered at o.y−30 becomes a 28-ray fan from r=26 around o, about 4× wider. Each ray pops on at ≥12px when its band crosses threshold. The wash blob layout swaps, because each role has its own seeded blobs, so the cloud changes shape and hue within ~200ms. Riff's first onset (+300ms) lengthens every ray 24px in 1 frame. | Glow opacity follower | engine.ts:1027, 1031; marks.ts:1161-1162, 97, 179, 166, 174, 177; fluidGlow.ts:71-72, 270-271; engine.ts:854-857. `t2` frames 1-6, 21; `m-t2` |
| **T5 job start** (4600) | Every cinder from the previous job vanishes in 1 frame (loops 2+). A 120-particle dust puff fires at the origin. | Dust puffs fade 700-1000ms | engine.ts:649; frames.ts:364. `t7` (20fps) |
| **T6 riff → you** (barge-in, 6500) | Burst drops to 44% in 1 frame. In the same frame Amoeba reaches 60% and its mode flips alpha 0.3→0.75. Wash goes yellow→blue in 2 frames. The onset pop lands at +200ms. | None | Same as T4. `t3` frames 1-3, 15 |
| **T7 riff → silence + landing** (11600, same tick) | Riff presence falls 1→0.25 in ~50ms while bands drop to silence, so most rays cull at once and Burst effectively vanishes. The wash collapses in ~70ms because its activity follows presence, bypassing the 500ms glow release. **One-frame opaque white cards:** `landStartedAt` comes from `performance.now()`, later than the rAF `t` used to draw. Alpha goes negative, canvas ignores it and draws at 1. The riffNod pulse and 40 tip sparks fire from a mark that is disappearing. | Card fill 600ms linear; ink build; dot decay | engine.ts:1290 vs 1235-1246; frames.ts:495-497, 690-692; engine.ts:724-735. `m-t5` frame 3 (30fps), `t5` frames 1-2 (15fps) |
| **T8 job clear** (14000) | Both cards, their ink and the build plan vanish in 1 frame. Construction dots re-light within ~3 frames, because the speculative layer draws whenever no plan exists, whatever the job state. Drift cinders keep orbiting until T5 wipes them. | None | engine.ts:670-673; frames.ts:684-687; engine.ts:1398-1411. `t6` frames 2→3, 4-8 |
| **T9 silence → you** (loop wrap, 15600) | Same as T6, starting from Burst at 0.25: stubs gone in 1-2 frames, Amoeba and blue wash in 1 frame, pop at +200ms. | None | `t8` |
| **W within a turn** | Onsets are zero-attack steps every 460-840ms (human) and 500-900ms (Riff). Rays pop on and off at threshold. Burst re-rolls its rough seed every 90ms (~11Hz boil) and angle jitter every 150ms. | Onset decay ×0.86/frame | engine.ts:832, 858, 1060-1061; marks.ts:166, 181, 154. `t9` |

<details><summary>Measured baseline: Off fires a scene cut at every state change</summary>

ffmpeg `select='gt(scene,0.02)'` on the 390px mark crop fired at loop-relative 0.60, 3.95, 6.50, 9.10, 11.57 and 13.98s, identically in both loops, and nowhere else. The card crop at 0.04 fired only at 11.57 (landing) and 13.98 (clear). This is the acceptance baseline in §5.
</details>

---

## 2. Shared foundation

### F0. Bug fixes (every mode, including Off)

- **One frame clock.** `renderFrame` stores `this.frameT = t` before `player.tick`. Add `private now() { return this.frameT || performance.now(); }` and use it in place of `performance.now()` at engine.ts:492, 523, 536, 548, 591, 652 and 687. `frames.ts#beginLanding`, `spawnDustPuff` and `spawnTipSparks` take `t` instead of reading the clock (frames.ts:372, 402, 495). This removes the T7 flash at its source.
- **Landing timestamp ownership.** Set `f.landStartedAt = now` in `engine.beginLanding` before the `cindersOn` branch. Today Cinders off never sets it, so cards appear at full alpha with no fade.
- **Speculative dots only while sketching.** At engine.ts:1387 pass `speculativeFrame: jobState === "sketching" ? cfg.speculativeFrame : "off"`.

### F1. Motion primitives (`src/lib/voiceLab/morph.ts`, new)

```ts
export type SpringSpec = { response: number; damping: number }; // response = undamped period ms (ω=2π/response), damping = ζ
export class Spring { value = 0; velocity = 0; target = 0; step(dtMs: number, s: SpringSpec): void; set(v: number): void }
export class Envelope { value = 0; step(dtMs: number, target: number, attackMs: number, releaseMs: number): void } // one-pole
export class Pulse { value = 0; trigger(peak: number): void; step(dtMs: number, attackMs: number): void } // linear rise over attackMs, then ×0.86^(dt/16.7); attackMs 0 = today's step

export type MorphId = "off" | "breath" | "shapeshift" | "relay" | "inkwash" | "elastic";
export type RolePose = {
  alpha: number; scale: number; sx: number; sy: number; // sx/sy only ever applied to Amoeba
  radial: number;   // Burst ray-length multiplier (Elastic, Shapeshift)
  reveal: number;   // 0..1 draw-on (Ink & Wash); 1 = full
  lineMul: number;  // stroke width multiplier
  pivot?: { x: number; y: number }; // default = mark's own visual center
};
export type MotionState = {
  presence: Record<Role, Spring>; talk: Record<Role, Spring>; // talk: 0 silence-mode .. 1 talking-mode
  morph: Spring;                  // 0 human form .. 1 riff form (Shapeshift)
  body: { aspect: Spring; radial: Spring; scale: Spring }; // one shared body (Elastic, Breath scale)
  bead: Spring;                   // Relay
  wash: Record<Role, Envelope>; energy: Record<Role, Envelope>; onset: Record<Role, Pulse>;
  handoff: { from: Role | null; to: Role | null; at: number };
  backchannel: { at: number; until: number; amount: number };
  jobOut: Spring;                 // 1 visible .. 0 cleared
};
export type MorphStyle = {
  id: MorphId; label: string;
  humanIn: SpringSpec; humanOut: SpringSpec; riffIn: SpringSpec; riffOut: SpringSpec; talk: SpringSpec;
  wash: { attackMs: number; releaseMs: number; overlap: number };
  onsetAttackMs: number; onsetScale: number; clearMs: number; cinderDieMs: number;
  pose(role: Role, m: MotionState, now: number): RolePose;
  onHandoff?(m: MotionState, from: Role | null, to: Role | null, now: number): void;
  onBackchannel?(m: MotionState, amount: number, ms: number, now: number): void;
  onLanding?(m: MotionState, now: number): void;
};
export const MORPH_STYLES: Record<Exclude<MorphId, "off">, MorphStyle>;
```

- **Integration:** springs use semi-implicit Euler in substeps of ≤4ms, on raw `dt` capped at 250ms. Reduced motion renders every 100ms (engine.ts:1477-1481), while `renderFrame`'s dt is clamped to 48 (engine.ts:1359), so springs would otherwise run at half speed.
- **Retargeting:** a spring always continues from its current value and velocity, so interrupts such as barge-in mid-handoff never jump.
- **Off:** the engine keeps today's tween path untouched. The motion layer is not consulted. Delete the Off branch when a style ships.

### F2-F7. What the layer replaces (Morph ≠ Off)

- **F2 continuous talk-mode.** Sample both roles' bands every frame in a new `sampleRole(role)`, split out of `drawRole` (engine.ts:976-1013). Blend `bands = lerp(silenceBands, talkingBands, talk)` before the existing 0.6/0.4 smoothing. Amoeba alpha becomes `lerp(0.3, max(0.25, 0.6 + level·0.3), talk)` (marks.ts:1161-1162). Pass `mode = talk ≥ 0.5 ? "talking" : "silence"` to other marks.
- **F3 rays fade, never pop.** Extract `burstRays(g)` in marks.ts, shared by `draw` and `getTipEmitters`, so the two stop being hand-mirrored copies. Replace the cull at marks.ts:166 with `vis = smoothstep(threshold − 0.08, threshold + 0.04, lvl)`, applied as alpha × vis and base length × vis. Skip a ray only when vis < 0.02; emit from it only when vis > 0.5. Also multiply length by `radial`.
- **F4 onset attack.** `onsetPulse` and `riffOnsetPulse` become `Pulse`s (engine.ts:837, 857, 1060-1061), with attack from the style.
- **F5 wash decoupled from presence.** At engine.ts:1290-1291, activity = `wash[role].value × (0.4 + 0.6·energy[role].value)`. The wash envelope targets the presence spring's *target*, with style attack/release. Add `overlap` to `FluidGlowParams`: the riff blob anchors lerp toward the human blob anchors (`bx`, `by`) in `projectRole` (fluidGlow.ts:254-271), so the cloud changes tint rather than jumping shape. Both roles already use the same blob count.
- **F6 job exits.**
  - **Clear:** `setJobState("none")` keeps the plan alive and drives `jobOut` to 0 over `clearMs`. `drawFrames` gains an `alphaMul` param applied to the card fill and to `strokeShape` (frames.ts:565, which currently forces alpha 1). Once `jobOut` < 0.01, run `resetFrames` and null the plan.
  - **Cinders:** they gain `dieAt?: number` (frames.ts:324). Job start and clear set `dieAt = now` on live cinders instead of wiping the array (engine.ts:649). `drawCinders` fades by `1 − (t − dieAt)/cinderDieMs`, and the engine prunes dead ones.
- **F7 idle squiggle fades.** Draw it with `setAlphaMul(clamp01(1 − presence.human·3.3))` rather than cutting at 0.02 (engine.ts:1078-1080).

### Pose application (engine `drawRole`, Morph ≠ Off)

- **Alpha and stroke width:** `setAlphaMul(preset.markPeak × pose.alpha)`, plus a new module-level `setLineMul(pose.lineMul)` in marks.ts beside `alphaMul`.
- **Transform:** `ctx.save(); translate(pivot); scale(pose.scale·sx, pose.scale·sy); translate(−pivot)`, then draw and restore. Default pivot is (o.x, o.y−30) for Amoeba and o for Burst. Map tip emitters through the same affine so sparks leave the drawn geometry.
- **No per-frame React:** every value lives on the engine instance. `updateGlow` still writes the wash canvas `opacity` and `transform` directly, and the mask wrapper never moves. Status emits only on `setMorph`.

### Ownership vs presets

- **The morph style owns:** handoff timing (replacing `preset.handoff` tweens, `smearFrames`, `entryPunch`), onset attack, the backchannel's look, and the clear and job-start exits.
- **The preset keeps:** beats, backchannel timing and amount (read as intensity), anticipation, `silenceHolder`, breathe, `stepFps`, `markPeak`, glow levels and envelope, job emit/duck, and landing policy, tipBurst, riffNod and impact.
- **Reduced motion (toggle or OS), every style:**
  - scale, sx, sy and radial are pinned to 1, reveal to 1, and bead to 0;
  - all presence springs use `{response 330, damping 1}` (~250ms);
  - wash envelopes stay as they are;
  - clear becomes a 400ms alpha fade;
  - Ink & Wash keeps its stain at half amount (color, not motion).

---

## 3. Per-transition matrix

Shared in every style: T3 behaves as today except in Elastic; old cinders fade (F6); construction dots stay off after clear (F0); rays fade at threshold (F3).

| | 1 Still Breath | 2 Shapeshift | 3 Relay | 4 Ink & Wash | 5 Elastic |
|---|---|---|---|---|---|
| **T1 idle → you** | Squiggle fades while Amoeba inhales from 0.88 scale (~145ms) | Squiggle fades; loop fades in at morph 0 (~145ms) | Squiggle collapses to a bead (60ms), then Amoeba blooms out, visible ≤120ms | Squiggle stains into dots; Amoeba is inked clockwise from the top in 140ms | Squiggle flattens (60ms); Amoeba pops out stretched and wobbles to rest |
| **T2 backchannel** | No rays: a yellow glaze swells into the wash (~0.6s) and Amoeba nods +3% | The loop grows 3-4 short green spokes (morph 0.18), then reabsorbs them | A small green bead pops out of Amoeba's top bulge and springs back | One short green tick is inked off Amoeba's top, then stains away | Amoeba hiccups vertically; one green ray flicks out and snaps back |
| **T3 yield** | Disc only | Disc only | Disc only | Disc only | Amoeba pre-squashes (preset depth ×2, preset ms), now visible |
| **T4 you → riff** | Amoeba exhales (to 0.88, ~360ms) under Burst inhaling (~300ms); the wash retints over ~0.8s | The loop opens upward and its bulges grow into rays (~300ms); one cloud retints | Amoeba gathers to a bead (140ms) and holds 60ms on the brand-green wash; Burst blooms out with 7% overshoot | Amoeba sinks into the paper (fade + dotted stain); Burst is inked root→tip, left→right, in 280ms | Amoeba squashes wide (90ms) and swaps at max squash; rays overshoot 20% and wobble ~550ms |
| **T5 job start** | Cinders fade 400ms | Cinders fade 400ms | Cinders fade 400ms | Cinders fade 400ms | Cinders fade 250ms |
| **T6 riff → you** | Burst fades in 140ms while Amoeba inhales in ≤145ms | Rays retract and the loop closes in ~135ms | Burst gathers in 90ms with no hold; Amoeba blooms from 60ms, visible ≤150ms | Burst stains out in 140ms while Amoeba is inked in 140ms | Rays snap in (50ms); Amoeba pops out stretched by 90ms and wobbles |
| **T7 silence + landing** | Burst exhales to 0.25 (~360ms) and the wash eases down over 0.8s | The fan stays open; rays shrink to silence length and fade to 0.25 | Burst coils (scale 0.55, alpha 0.25); its bead launches to the sketch and bursts into the tip sparks | Burst stains down to 0.25; its tips bleed a pulse into the paper as the build starts | Burst exhales (rays 0.6, soft wobble); riffNod becomes a ray overshoot to 1.35 |
| **T8 clear** | Cards and ink fade 600ms | Fade 450ms | Fade 450ms | Card fill fades first and ink last (700ms); the outline bleeds a dotted ghost into the paper (~1s) | Cards shrink 4% and fade in 350ms |
| **T9 silence → you** | As T6 | As T6, from a faint fan | As T6 | As T6 | As T6 |
| **W onsets** | 60ms attack, punch ×0.6 | 40ms attack | 35ms attack | 45ms attack | Onsets kick the body spring (a squash-stretch pulse), 30ms attack |

---

## 4. Options

Spring shorthand `{r, ζ}` = `{response ms, damping}`. At ζ=1 a spring reaches 95% at 0.755·r. Overshoot is 2.8% at ζ .75, 6.8% at .65, 16% at .5, and 20% at .45. **(dial)** marks a DialKit control, defined in §5. The global **Speed** dial divides every r and ms; the global **Intensity** dial multiplies every spatial amount (scale deltas, sprout, bead punch, stain, squash).

### 1 · Still Breath (quiet)

- **Presence springs:** humanIn {190, 1} (≈145ms); riffIn {400, 1} (≈300ms); humanOut {480, 1} (≈360ms, so the old voice lingers under the new); riffOut {185, 1} (≈140ms, barge-in asymmetry). Talk {350, 1}.
- **Pose:** `scale = S + (1 − S)·presence`, with **Breath scale S = 0.88 (dial)**; alpha = presence. Backchannel adds `scale × (1 + 0.03·bcEnv)` to Amoeba, where bcEnv is an Envelope over the backchannel window (attack 120, release 300).
- **Backchannel look:** `wash.riff` target = backchannel amount × 0.7 for the window; no Burst draw.
- **Wash:** attack 350, release 800, overlap 0.6. Onset attack 60ms, onsetScale 0.6. clearMs 600; cinderDieMs 400.
- **Files:** morph.ts (style), engine.ts (pose application, F-layer).
- **Risk and cost:** cheapest option. Both marks sit at ~40% for ~150ms during overlap. If that reads muddy, shorten humanOut; the scale difference is what keeps them separable.

### 2 · Shapeshift (continuous morph)

- **Geometry:** new `drawRadialMorph(g, humanCfg, riffCfg, humanBands, riffBands, m)` in marks.ts, used instead of both role draws. It applies only when human = Amoeba and Riff = Burst; any other assignment falls back to Still Breath poses.
  - **Slots:** K = `round(riffCfg.rayCount)`, one per Burst ray.
  - **Angle:** θ_h(i) = −90° + 360°·i/K and θ_r(i) = Burst's ray angle (spread + posJitter), with θ = lerp(θ_h, θ_r, easeInOut(m)). The loop gathers upward into the fan.
  - **Center and radii:** cy = lerp(o.y − 30, o.y, m). Inner radius = lerp(amoebaRadiusAt(θ), 26, m), where `amoebaRadiusAt` interpolates `amoebaOutline` by angle.
  - **Rays:** tip = inner + `sprout(m)`·burstLen(i)·vis(i), with `sprout = smoothstep(Sd, 1, m)` and **Sprout delay Sd = 0.15 (dial)**.
  - **Loop:** a closed chain through the slot inner points at 2× subdivision, alpha × (1 − smoothstep(0.35, 0.85, m)).
  - **Stroke:** color = sRGB lerp(humanColor, riffColor, m); width = lerp(Amoeba thickness, Burst width, m); seed bucket = floor(t / lerp(220, 90, m)).
  - **Emitters:** loop local maxima while m < 0.5, ray tips after.
- **Springs:** morph toward Riff {420, .9} (≈290ms, ~0% overshoot, m clamped to [0, 1.04]); toward human {180, 1} (≈135ms). Pick by sign of target − value.
  - **Morph target:** you → 0; riff → 1; silence with holder riff → 1.
- **Alpha:** `max(presence.human, presence.riff)`, so the body never vanishes mid-handoff. Presence springs as Still Breath.
- **Backchannel:** morph target **Backchannel sprout = 0.18 (dial)** for the window, then 0.
- **Wash:** attack 250, release 600, overlap 0.8. Onset attack 40. clearMs 450.
- **Risk and cost:** highest geometry work, but it avoids point-resampling between topologies: both forms are sampled on the same K slots, so there is nothing to resample. Draw cost is about equal to today's two-role overlap. It only works for the Amoeba/Burst pairing. Semantically it reads as one creature changing (see Decisions).

### 3 · Relay (handoff)

- **Handoff timeline (A → B, from `handoff.at`):**
  - **Gather:** `body.scale` for A goes to 0.08 via {gatherMs/0.755, 1}; A's alpha = smoothstep(0.1, 0.35, scale); pivot = bead anchor (o.x, o.y − 15), or o when the disc is on.
  - **Bead:** a roughEllipse, radius 9 logical × `bead.value`, with color lerping A→B. Its spring targets 1 from 60% of gather {120, .7} and 0 at release start {120, 1}.
  - **Hold:** `holdMs`. Both wash envelopes target 0.5, so the pigment mix reads brand green at the hand-off.
  - **Release:** B's scale goes 0.08 → 1 via {360, .65} (7% overshoot), alpha 0 → 1 over its first 60ms, and B gets `onset.trigger(releasePunch)`.
- **Timings:**
  - you → riff: **gatherMs 140 (dial)**, **holdMs 60 (dial)**, **releasePunch 0.6 (dial)**.
  - riff → you and loop wrap: gather 90, hold 0, human release starts at 60ms via {240, .75}.
  - idle → you: squiggle alpha → 0 in 60ms into the bead, then release.
- **Backchannel:** a green bead (radius 5) springs from Amoeba's top emitter 10px outward and back via {260, .5}, alpha = min(0.85, amount × 2.4).
- **Silence (holder riff):** Burst scale → 0.55 {400, 1}, alpha 0.25.
- **Landing bead (dial, default on):** in `onLanding`, the coiled bead travels to the nearest frame's bottom-center over 260ms (EASE_INOUT). `spawnTipSparks` then uses that arrival point as its single emitter instead of the mark tips.
- **Wash:** attack 180, release 500, overlap 0.5. Onset attack 35. clearMs 450.
- **Files:** morph.ts, engine.ts (bead state and draw call after roles), marks.ts `drawBead(o, r, color)` (roughEllipse, same pattern as `drawMicDisc`), frames.ts (`spawnTipSparks` arrival point).
- **Risk and cost:**
  - **Hold latency:** the hold adds 60ms before Riff appears. That is the intended cadence; barge-in has no hold.
  - **Phone scale:** the bead is ~2px at 390px, so the beat reads mostly through the green wash moment.
  - **Disc on:** the bead can read as the disc when the disc is on, hence the pivot moves to o.

### 4 · Ink & Wash (ink metaphor) — default

- **Outgoing (stain):** alpha via humanOut {420, 1} (≈320ms) or riffOut {185, 1} (≈140ms). `lineMul = 1 + 0.35·(1 − alpha)` as the ink spreads.
  - **Bleed while fading:** while 0.05 < alpha < 0.9, every 50ms (throttled per role) take ≤6 points from A's outline or ray tips and call `dotGrid.bleedAlongPath(points, A stroke color, glowBleedAmount × Stain × alpha)`, with **Stain = 0.6 (dial)**.
  - **Fade-out:** the dots fade over ~1.1s via the existing decay (dotGrid.ts:149).
- **Incoming (draw-on):** alpha 1 immediately (pen ink is opaque). `reveal = EASE_PEN((now − at)/revealMs)`, with new token `EASE_PEN = bezier(0.33, 0, 0.2, 1)` in sequence.ts.
  - **Durations:** revealMs is 140 for human (the ≤150ms feedback rule) and 280 for Riff.
  - **Amoeba:** `strokeChainPartial(pts, reveal)` starting at −90°, clockwise.
  - **Burst:** per-ray `r_i = clamp01(reveal·(1 + St) − St·i/(pool − 1))` with **Stagger St = 0.6 (dial)**; length × EASE_PEN(r_i); emit only from rays with r_i ≥ 0.9.
  - **Nib (dial, default on):** a 1.6px dot at the reveal head in the stroke color, alpha 0.6.
- **Wet bloom (dial) = 0.15:** on each handoff, `edgeAmount = glowEdgeAmount + bloomEnv`, where bloomEnv is an Envelope (attack 80, release 500) targeting the dial value for 150ms.
- **Backchannel:** one roughLine from Amoeba's topmost point 18px outward in the Riff color, revealed over 120ms, then faded over 300ms with stain bleed.
- **Silence (holder riff):** stains down to 0.25 (bleed at 0.3×).
- **Landing:** at `onLanding`, one bleed pulse (amount 0.5) at Burst's tips.
- **Clear:** clearMs 700. Card fill alpha = jobOut remapped over the first 60%; strokes over the last 60%. Each frame, bleed every 4th sample of each frame outline (`paths.outline.samples`) at 0.3 × (1 − jobOut).
- **Other constants:** wash attack 300, release 700, overlap 0.4; onset attack 45; talk {300, 1}.
- **Files:** marks.ts (`reveal` in `MarkDrawArgs`, `strokeChainPartial`, Burst per-ray reveal via `burstRays`), engine.ts (stain throttle `lastStainAt[role]`, bloom passthrough in `updateGlow`, clear bleed), sequence.ts (EASE_PEN).
- **Risk and cost:**
  - **Wash ceiling:** stains add dot activity where the wash already tints dots, pushing toward the "too much" ceiling. That is why Stain defaults to 0.6× the bleed dial and is dialable.
  - **Stain color:** human stains are INK gray, not blue, by design (stroke color, not wash color).
  - **Perf:** `bleedAlongPath` touches ~9 dots per point, so cost is negligible.

### 5 · Elastic (expressive)

- **Principle:** hide the swap inside fast motion (the smear-frame trick) instead of morphing geometry. One shared `body` spring set is inherited by whichever mark is drawn.
- **Squash respects the disc rule:** aspect squash (`sy = 1 + a`, `sx = 1/(1 + a)`) applies only to the closed Amoeba. Burst squashes radially: `radial` scales ray length and spread × (0.9 + 0.1·radial).
- **Handoff timeline:**
  - **Wind-up (A):** 0 to windupMs; `body.aspect` → −Sq for Amoeba, or `body.radial` → 1 − 1.4·Sq for Burst, via {120, 1}. **Squash Sq = 0.18 (dial)**.
  - **Swap:** A's alpha → 0 over 40ms from windupMs; B's alpha → 1 over 40ms from windupMs − 20.
  - **B starts compressed:** it inherits the body's value and velocity, re-expressed (Amoeba aspect −Sq ↔ Burst radial 1 − 1.4·Sq).
  - **Settle:** body targets rest (aspect 0, radial 1) via {380, ζ}, **Wobble ζ = 0.45 (dial)** (20% overshoot, ~550ms settle).
- **Timings:** windupMs is 90 for you → riff. For riff → you, loop wrap and idle → you it is 50, with settle {300, ζ + 0.05}; the squiggle flattens via the same body.
- **Yield:** `body.aspect` target −2·preset.anticipation.depth for anticipation.ms, then 0.
- **Onsets:** `body.scale.velocity += onsetScale × 0.0025 /ms` (Amoeba) or `body.radial.velocity += 0.004 /ms` (Burst); Pulse attack 30ms.
- **Backchannel:** `body.aspect.velocity += 0.003 /ms`, plus one green ray from Amoeba's top, length spring 0 → 22px → 0 via {200, .4}.
- **Silence (holder riff):** `radial` → 0.6 via {500, .7}, alpha 0.25. riffNod: `radial.velocity += 0.006 /ms` (peaks ≈ 1.35).
- **Clear:** clearMs 350. Cards scale about their centers to 0.96 via {300, .6} while alpha → 0. cinderDieMs 250.
- **Wash:** attack 120, release 450, overlap 0.5. Wash canvas `transform: scale(1 + min(0.06, (body.scale − 1)·0.3))`, written in `updateGlow`; the mask wrapper stays static.
- **Risk and cost:**
  - **Fatigue:** handoffs happen dozens of times a session, so the wobble can tire. Wobble lets Sean damp it toward ζ 1.
  - **Phone scale:** amplitudes are sized for 20-45px phone marks and may feel big on desktop.
  - **Barge-in:** the 20ms overlap is effectively a cut; it only works while the body is visibly moving.

---

## 5. Lab control, build order, acceptance

**Panel.** Add `MorphPanel` in Panels.tsx, inserted directly after `<SequencePanel />` (Panels.tsx:682). It uses `useDialKitController("Morph", …, { persist: persistKey("morph") })`, mirroring SequencePanel's idempotent sync against `engine.getMorph()`.

```ts
{
  style: { type: "select", default: "inkwash", options: [
    { value: "off", label: "Off (current)" }, { value: "breath", label: "1 · Still Breath" },
    { value: "shapeshift", label: "2 · Shapeshift" }, { value: "relay", label: "3 · Relay" },
    { value: "inkwash", label: "4 · Ink & Wash" }, { value: "elastic", label: "5 · Elastic" } ] },
  speed: [1, 0.5, 2, 0.05],
  intensity: [1, 0, 1.5, 0.05],
  breath:     { _collapsed: true, scale: [0.88, 0.7, 1, 0.01] },
  shapeshift: { _collapsed: true, sproutDelay: [0.15, 0, 0.6, 0.05], backchannelSprout: [0.18, 0, 0.5, 0.02] },
  relay:      { _collapsed: true, gatherMs: [140, 60, 300, 10], holdMs: [60, 0, 200, 10], releasePunch: [0.6, 0, 1.5, 0.05], landingBead: true },
  inkwash:    { _collapsed: true, stagger: [0.6, 0, 1.5, 0.05], stain: [0.6, 0, 1, 0.05], wetBloom: [0.15, 0, 0.4, 0.01], nib: true },
  elastic:    { _collapsed: true, squash: [0.18, 0, 0.4, 0.01], wobble: [0.45, 0.2, 1, 0.05] },
}
```

- **Engine surface:** `setMorph(id)`, `getMorph()`, `cycleMorph(±1)`, and `config.morph` holding dial values. `EngineStatus` gains `morphId` and `morphLabel`.
- **Live switching:** changing style does not restart the loop, so Sean can A/B mid-loop. Switching away from Off seeds each presence spring from the current tween value with velocity 0.
- **Hotkey:** in Stage.tsx `onKey`, `m` calls `cycleMorph(1)` and `Shift+M` calls `cycleMorph(−1)`, placed before the S/L branch.
- **Caption:** the status line (Stage.tsx:299-304) appends `— morph: Ink & Wash`, so recordings label themselves. The phone uses the select, since it has no keyboard.

**Build order** (one implementer, batch saves — builder saves hot-reload Sean's open lab):
1. F0 fixes (engine.ts, frames.ts), then verify the T7 flash is gone at 390px.
2. `morph.ts` primitives and types; F2-F7 in engine.ts, marks.ts (`burstRays`, `setLineMul`, talk lerp), fluidGlow.ts (`overlap`), frames.ts (`alphaMul`, `dieAt`).
3. Styles in order 1 → 4 → 3 → 5 → 2 (cheapest first; Shapeshift's geometry last).
4. MorphPanel, hotkey, caption.
5. Evidence: record each style at 390px and 1440px to `docs/evidence/morph/<id>-{mobile,desktop}.mp4`, plus T4/T6/T7/T8 strips.

**Acceptance.** The 390px capture of a Blend loop is fresh session, Play on, B pressed.

- **Card crop:** `ffmpeg -i <clip> -vf "crop=260:110:65:300,select='gt(scene,0.04)',showinfo" -f null -` fires **0 times** for every style. Off fires at landing and clear.
- **Mark crop:** `crop=110:80:141:428` with `gt(scene,0.02)` fires **0 times within ±150ms of T4, T6 and T9** for styles 1-4. Elastic is judged by eye, since its motion is intentionally fast.
- **Reduced motion on:** no style changes scale, reveal or position; only opacity and color move.

---

## 6. Noticed, not in scope

- **Fresh load comes up paused:** VoicePanel's mount effect calls `autoplay.stop()` after SequencePanel starts it (Panels.tsx:168-172 vs 123-127), and `play:false` is persisted. Verified in a fresh session: the caption shows ❚❚.
- **Landing particle and ink-bleed color follows the wrong role:** both use `activeRoleAndMarkId`, which reports human during silence (engine.ts:1143, 1423). Blend's landing sparks are human ink, and a maxHold landing during riff-talking would flip color mid-build.
- **`burstUnderlay` is dead:** it is typed and set by presets but never read (sequence.ts:68).
- **Burst boil runs at ~11Hz:** above the doc's 3Hz reduced-motion guidance. It is ambient, not a transition cause.

## Decisions for Sean

1. **One creature or two speakers?** Shapeshift and Elastic make human and Riff read as one body changing form; Relay and Ink & Wash keep them as two parties passing the floor. **Recommended: two speakers.** The Amoeba = human / Burst = Riff split exists to show whose turn it is, and a continuous morph blurs that. That is why Ink & Wash is the default.
2. **Which view decides the winner, phone or desktop?** At 390px the whole stage is 358×223 and the marks are 20-45px, so the wash is most of what you see. **Recommended: judge on the phone,** since that is where the jumps bothered you.
