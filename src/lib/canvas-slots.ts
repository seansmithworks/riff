// What each wireframe canvas slot draws right now
// (docs/plans/riff-real-stream.html, Step 5). Slots come from the sketch
// draft while one exists (including a superseded job's, held until the next
// head), otherwise from the committed artifact.

import type { Element, Screen } from "./artifact";
import { mergeDraft, sameJson } from "./artifact-stream";
import type { Sketch } from "./store";

/**
 * outline: planned, nothing landed (pencil frame, no body).
 * stale:   will change, not re-landed yet (old body under a wash).
 * inking:  its elements are landing (pencil frame, partial body).
 * inked:   landed or unchanged.
 */
export type SlotState = "outline" | "stale" | "inking" | "inked";

export type CanvasSlot = {
  id: string;
  name: string;
  state: SlotState;
  elements: Element[];
  /**
   * Elements that mount in this body ink in. Bodies are keyed by element
   * content, so an element already on the canvas never mounts again.
   */
  live: boolean;
};

/**
 * The next slots by id, keeping the previous object for every slot that
 * draws the same thing, so a screen node re-renders only when its own slot
 * changes (WireframeCanvas.tsx). Elements compare by reference first (the
 * store carries landed elements across events) and deep-equal otherwise (a
 * closed screen or done re-parses the same content).
 */
export function reuseUnchangedSlots(
  previous: ReadonlyMap<string, CanvasSlot>,
  next: CanvasSlot[],
): Map<string, CanvasSlot> {
  return new Map(
    next.map((slot) => {
      const prior = previous.get(slot.id);
      const same =
        prior !== undefined &&
        prior.name === slot.name &&
        prior.state === slot.state &&
        prior.live === slot.live &&
        prior.elements.length === slot.elements.length &&
        prior.elements.every(
          (element, i) =>
            element === slot.elements[i] || sameJson(element, slot.elements[i]),
        );
      return [slot.id, same ? prior : slot];
    }),
  );
}

export function artifactSlots(screens: Screen[]): CanvasSlot[] {
  return screens.map((screen) => ({
    id: screen.id,
    name: screen.name,
    state: "inked",
    elements: screen.elements,
    live: false,
  }));
}

export function sketchSlots(sketch: Sketch): CanvasSlot[] {
  const { slots } = mergeDraft(sketch.base, sketch.outline, sketch.closed);
  // `screens` holds the new and changed outline entries in outline order and
  // closes them one at a time, so the screen whose elements are landing is
  // the first of those that hasn't closed.
  const closedIds = new Set(sketch.closed.map((screen) => screen.id));
  const streamingId = sketch.outline.find(
    (entry) => entry.status !== "keep" && !closedIds.has(entry.id),
  )?.id;
  const landing = (sketch.elements[sketch.closed.length] ?? []).filter(Boolean);

  return slots.map((slot): CanvasSlot => {
    const id = slot.id;
    const name = slot.entry?.name ?? slot.screen?.name ?? id;
    const incoming = id === streamingId ? landing : [];

    if (slot.source === "closed") {
      return {
        id,
        name,
        state: "inked",
        elements: slot.screen!.elements,
        live: slot.changed,
      };
    }
    if (slot.source === "pending") {
      return incoming.length
        ? { id, name, state: "inking", elements: incoming, live: true }
        : { id, name, state: "outline", elements: [], live: true };
    }

    const base = slot.screen!.elements;
    if (slot.entry === null || slot.entry.status === "keep") {
      return { id, name, state: "inked", elements: base, live: false };
    }
    // While the landing elements match the old body, keep the old body (a
    // screen resent unchanged never clears). The first difference clears it,
    // so old and new never mix.
    if (incoming.every((element, i) => sameJson(element, base[i]))) {
      return { id, name, state: "stale", elements: base, live: false };
    }
    return { id, name, state: "inking", elements: incoming, live: true };
  });
}
