// node --test tests/ (Node's type stripping; no bundler). The real app's
// voice-layer helpers (src/lib/voiceStage.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { stageLayout } from "../src/lib/voiceStage.ts";

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
