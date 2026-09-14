// node --test tests/ (Node's type stripping; no bundler). Pure level math the
// voice engine applies to injected audio (src/lib/voiceLab/tuning.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TUNED,
  calibrateLevels,
  hasLevels,
  type LevelCalibration,
} from "../src/lib/voiceLab/tuning.ts";

const NEUTRAL: LevelCalibration = { gain: 1, floor: 0, curve: 1 };

function one(value: number, cal: LevelCalibration): number {
  return calibrateLevels(new Float32Array([value]), new Uint8Array(1), cal)[0];
}

test("default calibration is neutral for both roles", () => {
  assert.deepEqual(TUNED.calibration.human, NEUTRAL);
  assert.deepEqual(TUNED.calibration.riff, NEUTRAL);
});

test("neutral byte data copies through unchanged and never aliases the source", () => {
  const src = new Uint8Array([0, 18, 128, 255]);
  const out = new Uint8Array(8).fill(99);
  assert.equal(calibrateLevels(src, out, NEUTRAL), out);
  assert.deepEqual([...out], [0, 18, 128, 255, 0, 0, 0, 0]);
  out[1] = 7;
  assert.equal(src[1], 18);
});

test("Float32 input is read as 0-1 and clamped", () => {
  const out = calibrateLevels(
    new Float32Array([0, 0.5, 1, 2]),
    new Uint8Array(4),
    NEUTRAL,
  );
  assert.deepEqual([...out], [0, 128, 255, 255]);
});

test("floor gates quiet bins and rescales the rest to full range", () => {
  const cal = { gain: 1, floor: 0.2, curve: 1 };
  assert.equal(one(0.1, cal), 0);
  assert.equal(one(0.6, cal), 128);
  assert.equal(one(1, cal), 255);
});

test("gain scales and clamps; curve below 1 lifts quiet input", () => {
  assert.equal(one(0.25, { gain: 2, floor: 0, curve: 1 }), 128);
  assert.equal(one(0.8, { gain: 2, floor: 0, curve: 1 }), 255);
  assert.equal(one(0.25, { gain: 1, floor: 0, curve: 0.5 }), 128);
  assert.equal(one(0.25, { gain: 1, floor: 0, curve: 2 }), 16);
});

test("null or empty buffers are not a source", () => {
  assert.equal(hasLevels(null), false);
  assert.equal(hasLevels(undefined), false);
  assert.equal(hasLevels(new Uint8Array(0)), false);
  assert.equal(hasLevels(new Uint8Array(1024)), true);
});
