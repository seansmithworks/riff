// node --test tests/ (Node's type stripping; no bundler). The real app's
// voice-layer helpers (src/lib/voiceStage.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  engineVoiceState,
  inputLevel,
  stageLayout,
  stepTalkGate,
  syntheticSpeechFrames,
  type TalkGate,
} from "../src/lib/voiceStage.ts";

test("session states map to engine states", () => {
  const live = { fixture: false, talking: false };
  const talking = { fixture: false, talking: true };
  assert.equal(engineVoiceState("speaking", live), "riff-talking");
  assert.equal(engineVoiceState("listening", live), "silence");
  assert.equal(engineVoiceState("listening", talking), "you-talking");
  assert.equal(engineVoiceState("silence", talking), "you-talking");
  assert.equal(engineVoiceState("mic-blocked", talking), "dead-mic");
  for (const s of [
    "idle",
    "connecting",
    "allow-mic",
    "connect-failed",
    "dropped",
  ] as const)
    assert.equal(engineVoiceState(s, talking), "idle");
});

test("fixtures set the engine state without a gate", () => {
  const fixture = { fixture: true, talking: false };
  assert.equal(engineVoiceState("listening", fixture), "you-talking");
  assert.equal(engineVoiceState("silence", fixture), "silence");
  assert.equal(engineVoiceState("speaking", fixture), "riff-talking");
});

test("the listening gate opens at threshold and holds through the release", () => {
  const cfg = { threshold: 0.06, releaseMs: 350 };
  const gate: TalkGate = { talking: false, lastAboveAt: 0 };
  assert.equal(stepTalkGate(gate, 0.05, 0, cfg), false);
  assert.equal(stepTalkGate(gate, 0.06, 50, cfg), true);
  assert.equal(stepTalkGate(gate, 0.01, 300, cfg), true);
  assert.equal(stepTalkGate(gate, 0.01, 399, cfg), true);
  assert.equal(stepTalkGate(gate, 0.01, 400, cfg), false);
});

test("the stage centers the origin over the bar and scales with the viewport", () => {
  const base = {
    bar: { left: 570, top: 820, width: 300 },
    stageW: 1440,
    stageH: 900,
    origin: { x: 720, y: 810 },
    marksBelow: 90,
    marksAbove: 150,
    gap: 8,
  };
  const wide = stageLayout({ ...base, viewportW: 1440 });
  assert.equal(wide.scale, 1);
  assert.equal(wide.left + base.origin.x, 720);
  assert.equal(wide.top + base.origin.y, 820 - 8 - 90);
  assert.equal(wide.captionLift, 90 + 150 + 16);

  const phone = stageLayout({
    ...base,
    bar: { left: 45, top: 732, width: 300 },
    viewportW: 390,
  });
  assert.equal(phone.scale, 0.5);
  assert.equal(phone.width, 720);
  assert.equal(phone.left + base.origin.x * 0.5, 195);
  assert.equal(phone.captionLift, 120 + 16);
});

test("input level is the buffer mean, empty is silence", () => {
  assert.equal(inputLevel(new Uint8Array(0)), 0);
  assert.equal(inputLevel(null), 0);
  assert.equal(inputLevel(new Uint8Array(1024).fill(255)), 1);
  assert.equal(inputLevel(new Float32Array([0.5, 0.5])), 0.5);
});

test("synthetic speech has syllables above the gate and pauses below it", () => {
  const frames = syntheticSpeechFrames(4, 60, 1);
  assert.equal(frames.length, 240);
  assert.ok(frames.every((f) => f.length === 1024));
  assert.deepEqual(syntheticSpeechFrames(4, 60, 1)[100], frames[100]);
  const levels = frames.map((f) => inputLevel(f));
  assert.ok(
    levels.some((l) => l >= 0.06),
    "some frames open the gate",
  );
  assert.ok(
    levels.some((l) => l < 0.02),
    "some frames are pauses",
  );
});
