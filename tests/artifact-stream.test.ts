// node --test tests/ (Node's type stripping; no bundler). Fixtures are raw
// glm-5p2 stream contents from the Step 1 spike (tests/fixtures/*.json).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createClosedObjectTracker,
  mergeDraft,
  pendingFromSuperseded,
  type StreamEvent,
} from "../src/lib/artifact-stream.ts";
import {
  validateArtifact,
  type Artifact,
  type OutlineEntry,
  type Screen,
} from "../src/lib/artifact.ts";

type Fixture = { label: string; content: string };

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;

const fixture = (label: string) =>
  readJson<Fixture>(`./fixtures/${label}.json`);
const STREAM_FIXTURES = ["R2-1", "R2-2", "R3-1", "R3-2"].map(fixture);
const REORDERED = fixture("reordered-keys");
const BEFORE = readJson<Artifact & { kind: "wireframe" }>(
  "../docs/evidence/artifact-before.json",
);
const AFTER = readJson<Artifact & { kind: "wireframe" }>(
  "../docs/evidence/artifact-after.json",
);

function feed(chunks: string[]): StreamEvent[] {
  const tracker = createClosedObjectTracker();
  return chunks.flatMap((chunk) => tracker.push(chunk));
}

// mulberry32: small seeded PRNG so random chunkings are reproducible.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomChunks(text: string, seed: number): string[] {
  const next = rng(seed);
  const chunks: string[] = [];
  for (let i = 0; i < text.length;) {
    const size = 1 + Math.floor(next() * 16);
    chunks.push(text.slice(i, i + size));
    i += size;
  }
  return chunks;
}

const byType = <T extends StreamEvent["type"]>(
  events: StreamEvent[],
  type: T,
) =>
  events.filter((e): e is Extract<StreamEvent, { type: T }> => e.type === type);

for (const fx of [...STREAM_FIXTURES, REORDERED]) {
  test(`${fx.label}: identical events whole, per char, at every split, and 50 random chunkings`, () => {
    const whole = feed([fx.content]);
    assert.ok(whole.length > 0);
    assert.deepEqual(feed([...fx.content]), whole, "one code unit at a time");
    for (let i = 1; i < fx.content.length; i++) {
      assert.deepEqual(
        feed([fx.content.slice(0, i), fx.content.slice(i)]),
        whole,
        `split at ${i}`,
      );
    }
    for (let seed = 1; seed <= 50; seed++) {
      assert.deepEqual(
        feed(randomChunks(fx.content, seed)),
        whole,
        `seed ${seed}`,
      );
    }
  });
}

for (const fx of STREAM_FIXTURES) {
  test(`${fx.label}: head first, element events before their screen, screens match the final JSON`, () => {
    const events = feed([fx.content]);
    const parsed = JSON.parse(fx.content) as {
      platform: string;
      title: string;
      outline: OutlineEntry[];
      screens: Screen[];
    };

    assert.equal(events[0].type, "head");
    assert.equal(byType(events, "head").length, 1);
    const head = byType(events, "head")[0];
    assert.deepEqual(head.outline, parsed.outline);
    assert.equal(head.platform, parsed.platform);
    assert.equal(head.title, parsed.title);

    const screens = byType(events, "screen");
    assert.deepEqual(
      screens.map((e) => e.screen),
      parsed.screens,
    );
    for (const s of screens) {
      const at = events.indexOf(s);
      const elements = byType(events, "element").filter(
        (e) => e.screenIndex === s.screenIndex,
      );
      assert.ok(
        elements.every((e) => events.indexOf(e) < at),
        `screen ${s.screenIndex} elements precede its screen event`,
      );
      assert.deepEqual(
        elements.map((e) => e.element),
        s.screen.elements,
        "one element event per top-level element (row children don't emit)",
      );
      assert.deepEqual(
        elements.map((e) => e.elementIndex),
        s.screen.elements.map((_, i) => i),
      );
    }
  });
}

test("reordered keys: screens that close before the outline are buffered and emitted right after head", () => {
  const source = STREAM_FIXTURES[0];
  const outlineAt = REORDERED.content.indexOf('"outline"');
  assert.ok(REORDERED.content.indexOf('"screens"') < outlineAt);

  const tracker = createClosedObjectTracker();
  const beforeOutline = tracker.push(REORDERED.content.slice(0, outlineAt));
  assert.deepEqual(beforeOutline, [], "nothing emits before head");
  const rest = tracker.push(REORDERED.content.slice(outlineAt));

  assert.equal(rest[0].type, "head");
  assert.deepEqual(
    rest,
    feed([source.content]),
    "same sequence as canonical order",
  );
});

for (const label of ["R3-1", "R3-2"]) {
  test(`${label}: mergeDraft(final) over artifact-before passes validateArtifact`, () => {
    const parsed = JSON.parse(fixture(label).content);
    const draft = mergeDraft(BEFORE, parsed.outline, parsed.screens, {
      final: true,
    });
    const artifact = {
      kind: "wireframe",
      title: parsed.title,
      platform: parsed.platform,
      screens: draft.slots.map((s) => s.screen),
    };
    assert.ok(validateArtifact(artifact));
    assert.deepEqual(
      draft.slots.map((s) => s.id),
      parsed.outline.map((e: OutlineEntry) => e.id),
    );
    for (const id of ["s1", "s2"]) {
      const slot = draft.slots.find((s) => s.id === id)!;
      assert.equal(slot.source, "base");
      assert.equal(slot.changed, false);
    }
    assert.deepEqual(draft.unmatched, []);
  });
}

const screen = (id: string) =>
  structuredClone(AFTER.screens.find((s) => s.id === id)!);
const baseScreen = (id: string) =>
  structuredClone(BEFORE.screens.find((s) => s.id === id)!);

test("synthetic before -> after (s1 keep, s2 keep, s3 changed, s4 new) deep-equals artifact-after screens", () => {
  const outline: OutlineEntry[] = [
    { id: "s1", name: "Browse Walkers", status: "keep" },
    { id: "s2", name: "Walker Profile", status: "keep" },
    { id: "s3", name: "Booking Details", status: "changed" },
    { id: "s4", name: "Select Time Slot & Pay", status: "new" },
  ];
  const draft = mergeDraft(BEFORE, outline, [screen("s3"), screen("s4")], {
    final: true,
  });
  assert.deepEqual(
    draft.slots.map((s) => s.screen),
    AFTER.screens,
  );
  assert.deepEqual(
    draft.slots.map((s) => s.changed),
    [false, false, true, true],
  );
});

test("a closed screen that deep-equals its base is unchanged, even marked changed and with keys reordered", () => {
  const outline: OutlineEntry[] = BEFORE.screens.map((s) => ({
    id: s.id,
    name: s.name,
    status: "changed",
  }));
  const s1 = baseScreen("s1");
  const resent = { elements: s1.elements, name: s1.name, id: s1.id } as Screen;
  const s2 = baseScreen("s2");
  s2.elements.push({ type: "tabbar", tabs: ["Walkers", "Bookings"] });

  const draft = mergeDraft(BEFORE, outline, [resent, s2]);
  const slot = (id: string) => draft.slots.find((s) => s.id === id)!;
  assert.equal(slot("s1").source, "closed");
  assert.equal(slot("s1").changed, false);
  assert.equal(slot("s2").changed, true);
  assert.equal(slot("s3").source, "base");
  assert.equal(slot("s3").changed, false);
});

test("M4: a closed screen whose id isn't in the outline becomes a new slot", () => {
  const outline: OutlineEntry[] = [
    { id: "s1", name: "Browse Walkers", status: "keep" },
    { id: "s2", name: "Walker Profile", status: "keep" },
    { id: "s3", name: "Confirm Booking", status: "keep" },
  ];
  const stray = { ...screen("s4"), id: "time-slot" };
  const draft = mergeDraft(BEFORE, outline, [stray]);
  assert.deepEqual(
    draft.slots.map((s) => [s.id, s.source, s.changed]),
    [
      ["s1", "base", false],
      ["s2", "base", false],
      ["s3", "base", false],
      ["time-slot", "closed", true],
    ],
  );
  assert.deepEqual(draft.unmatched, ["time-slot"]);
  assert.deepEqual(
    mergeDraft(BEFORE, outline, [stray], { final: true }).slots.map(
      (s) => s.id,
    ),
    ["s1", "s2", "s3", "time-slot"],
  );
});

test("M4: a changed entry that never closes reverts to base at final; a new one that never closes is dropped", () => {
  const outline: OutlineEntry[] = [
    { id: "s1", name: "Browse Walkers", status: "keep" },
    { id: "s2", name: "Walker Profile", status: "keep" },
    { id: "s3", name: "Booking Details", status: "changed" },
    { id: "s4", name: "Select Time Slot & Pay", status: "new" },
  ];
  const streaming = mergeDraft(BEFORE, outline, []);
  assert.deepEqual(
    streaming.slots.map((s) => [s.id, s.source]),
    [
      ["s1", "base"],
      ["s2", "base"],
      ["s3", "base"],
      ["s4", "pending"],
    ],
  );
  const final = mergeDraft(BEFORE, outline, [], { final: true });
  assert.deepEqual(
    final.slots.map((s) => s.screen),
    BEFORE.screens,
  );
});

test("base screens missing from the outline are retained until final", () => {
  const outline: OutlineEntry[] = [
    { id: "s1", name: "Browse Walkers", status: "keep" },
    { id: "s2", name: "Walker Profile", status: "keep" },
  ];
  assert.deepEqual(
    mergeDraft(BEFORE, outline, []).slots.map((s) => [s.id, s.source]),
    [
      ["s1", "base"],
      ["s2", "base"],
      ["s3", "retained"],
    ],
  );
  assert.deepEqual(
    mergeDraft(BEFORE, outline, [], { final: true }).slots.map((s) => s.id),
    ["s1", "s2"],
  );
});

test("a supersede after s1 yields the un-landed outline entries as pending", () => {
  const events = feed([STREAM_FIXTURES[0].content]);
  const head = byType(events, "head")[0];
  const firstScreen = byType(events, "screen")[0];
  const pending = pendingFromSuperseded(head.outline, [firstScreen.screen]);
  assert.deepEqual(
    pending.map((e) => e.id),
    head.outline.slice(1).map((e) => e.id),
  );

  const evolveOutline: OutlineEntry[] = [
    { id: "s1", name: "Browse Walkers", status: "keep" },
    { id: "s3", name: "Booking Details", status: "changed" },
    { id: "s4", name: "Select Time Slot & Pay", status: "new" },
  ];
  assert.deepEqual(
    pendingFromSuperseded(evolveOutline, [screen("s3")]).map((e) => e.id),
    ["s4"],
  );
});
