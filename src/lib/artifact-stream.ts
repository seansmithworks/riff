// Streaming artifact contract (docs/plans/riff-real-stream.html, Step 2).
//
// The model streams one JSON object shaped by ARTIFACT_STREAM_JSON_SCHEMA.
// createClosedObjectTracker() turns that token stream into events the moment
// each meaningful object closes; mergeDraft() lays closed screens over the
// base artifact in outline order. Everything here is pure and uses type-only
// imports, so `node --test` loads it without a bundler.

import type { Artifact, Element, OutlineEntry, Screen } from "./artifact";

export type StreamHead = {
  kind: "wireframe";
  platform: "mobile" | "desktop";
  title: string;
  outline: OutlineEntry[];
};

export type StreamEvent =
  | ({ type: "head" } & StreamHead)
  // An object directly inside screens[i].elements closed (row children don't
  // emit on their own; they arrive inside their row).
  | {
      type: "element";
      screenIndex: number;
      elementIndex: number;
      element: Element;
    }
  | { type: "screen"; screenIndex: number; screen: Screen };

// ---------------------------------------------------------------------------
// Tracker

type Role = "root" | "outline" | "screens" | "screen" | "elements" | "element";

type Frame = {
  container: "obj" | "arr";
  role: Role | null;
  start: number;
  key: string | null; // obj: key of the value being read
  expectKey: boolean; // obj: the next string is a key
  index: number; // arr: index of the current item
  indexInParent: number;
  screenIndex: number;
};

function parseSlice(text: string, start: number, end: number): unknown {
  try {
    return JSON.parse(text.slice(start, end));
  } catch {
    return undefined;
  }
}

function childRole(
  parent: Frame | undefined,
  container: Frame["container"],
): Role | null {
  if (!parent) return container === "obj" ? "root" : null;
  if (parent.role === "root" && container === "arr") {
    return parent.key === "outline" || parent.key === "screens"
      ? parent.key
      : null;
  }
  if (parent.role === "screens" && container === "obj") return "screen";
  if (parent.role === "screen" && container === "arr") {
    return parent.key === "elements" ? "elements" : null;
  }
  if (parent.role === "elements" && container === "obj") return "element";
  return null;
}

/**
 * Feed raw content deltas with push(); each call returns the events that
 * became complete. The event sequence depends only on the concatenated text,
 * never on how it was chunked.
 *
 * `head` fires once the outline has closed and kind, platform and title are
 * known. Key order isn't schema-enforced (the spike saw today's schema write
 * platform after screens), so element/screen events that complete before the
 * head are buffered and emitted, in their original order, right after it.
 * Flow artifacts have no outline and emit nothing; they render at done.
 * Objects that fail to parse are skipped (only possible without
 * response_format).
 */
export function createClosedObjectTracker() {
  let text = "";
  let pos = 0;
  const stack: Frame[] = [];
  let inString = false;
  let escape = false;
  let stringStart = 0;
  let stringIsKey = false;

  const topStrings: Record<string, unknown> = {};
  let outline: OutlineEntry[] | null = null;
  let headSent = false;
  let buffered: StreamEvent[] = [];
  const ready: StreamEvent[] = [];

  const emit = (event: StreamEvent) => {
    if (headSent) ready.push(event);
    else buffered.push(event);
  };

  const maybeHead = () => {
    const { kind, platform, title } = topStrings;
    if (
      headSent ||
      !outline ||
      kind !== "wireframe" ||
      (platform !== "mobile" && platform !== "desktop") ||
      typeof title !== "string"
    ) {
      return;
    }
    headSent = true;
    ready.push({ type: "head", kind, platform, title, outline });
    ready.push(...buffered);
    buffered = [];
  };

  const onClose = (frame: Frame, end: number) => {
    if (frame.role === "outline") {
      const value = parseSlice(text, frame.start, end);
      if (Array.isArray(value)) {
        outline = value as OutlineEntry[];
        maybeHead();
      }
    } else if (frame.role === "element") {
      const element = parseSlice(text, frame.start, end);
      if (element) {
        emit({
          type: "element",
          screenIndex: frame.screenIndex,
          elementIndex: frame.indexInParent,
          element: element as Element,
        });
      }
    } else if (frame.role === "screen") {
      const screen = parseSlice(text, frame.start, end);
      if (screen) {
        emit({
          type: "screen",
          screenIndex: frame.screenIndex,
          screen: screen as Screen,
        });
      }
    }
  };

  function push(chunk: string): StreamEvent[] {
    text += chunk;
    // Walk UTF-16 code units: every structural character is ASCII, so a
    // surrogate pair split across chunks can't change what's detected.
    for (; pos < text.length; pos++) {
      const ch = text[pos];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
          const frame = stack[stack.length - 1];
          if (frame && stringIsKey) {
            frame.key = String(parseSlice(text, stringStart, pos + 1));
            frame.expectKey = false;
          } else if (
            frame?.role === "root" &&
            stack.length === 1 &&
            frame.key
          ) {
            topStrings[frame.key] = parseSlice(text, stringStart, pos + 1);
            maybeHead();
          }
        }
        continue;
      }

      const parent = stack[stack.length - 1];
      if (ch === '"') {
        inString = true;
        stringStart = pos;
        stringIsKey = parent?.container === "obj" && parent.expectKey;
      } else if (ch === "{" || ch === "[") {
        const container = ch === "{" ? "obj" : "arr";
        const role = childRole(parent, container);
        stack.push({
          container,
          role,
          start: pos,
          key: null,
          expectKey: container === "obj",
          index: 0,
          indexInParent: parent?.index ?? 0,
          screenIndex:
            role === "screen"
              ? (parent?.index ?? 0)
              : (parent?.screenIndex ?? -1),
        });
      } else if (ch === "}" || ch === "]") {
        const closed = stack.pop();
        if (closed) onClose(closed, pos + 1);
      } else if (ch === "," && parent) {
        if (parent.container === "obj") parent.expectKey = true;
        else parent.index++;
      }
    }
    return ready.splice(0);
  }

  return { push };
}

// ---------------------------------------------------------------------------
// Merge

/** Deep JSON equality, insensitive to object key order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJson(item, b[i]))
    );
  }
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  return (
    keys.length === Object.keys(bo).length &&
    keys.every((k) => Object.hasOwn(bo, k) && sameJson(ao[k], bo[k]))
  );
}

export type DraftSlot = {
  id: string;
  /** The outline entry for this slot; null for an unmatched or retained screen. */
  entry: OutlineEntry | null;
  /** What to draw now; null while a new screen is still outline-only. */
  screen: Screen | null;
  /**
   * closed: the stream delivered this screen. base: reused from the base
   * (kept, or changed but not landed yet). pending: outline only.
   * retained: a base screen missing from the outline, shown until final.
   */
  source: "closed" | "base" | "pending" | "retained";
  /**
   * Whether this slot's body differs from the base screen with the same id.
   * A closed screen that deep-equals its base is unchanged (the spike's R4
   * resent s1 byte-identical while marking it changed in 4/5 runs), so the
   * canvas never redraws it.
   */
  changed: boolean;
};

export type Draft = {
  slots: DraftSlot[];
  /** Closed screen ids that aren't in the outline, in close order. */
  unmatched: string[];
};

/**
 * Lay closed screens over the base in outline order.
 *
 * - Each outline entry shows its closed version, else its base version, else
 *   (not final) an empty pending slot; at final, entries with neither are
 *   omitted. The closed version wins whatever the entry's status says, so a
 *   "keep" screen that appears in screens is treated as changed and a
 *   "changed" entry that never closes reverts to base.
 * - A closed screen whose id isn't in the outline becomes a new slot after
 *   the outline slots (the caller logs `unmatched` once).
 * - Base screens missing from the outline are retained until final.
 */
export function mergeDraft(
  base: Artifact | null | undefined,
  outline: OutlineEntry[],
  closed: Screen[],
  { final = false }: { final?: boolean } = {},
): Draft {
  const baseScreens = base?.kind === "wireframe" ? base.screens : [];
  const baseById = new Map(baseScreens.map((s) => [s.id, s]));
  const closedById = new Map(closed.map((s) => [s.id, s]));
  const outlineById = new Map<string, OutlineEntry>();
  for (const entry of outline) {
    if (!outlineById.has(entry.id)) outlineById.set(entry.id, entry);
  }

  const slots: DraftSlot[] = [];
  for (const entry of outlineById.values()) {
    const done = closedById.get(entry.id);
    const prior = baseById.get(entry.id);
    if (done) {
      slots.push({
        id: entry.id,
        entry,
        screen: done,
        source: "closed",
        changed: !prior || !sameJson(prior, done),
      });
    } else if (prior) {
      slots.push({
        id: entry.id,
        entry,
        screen: prior,
        source: "base",
        changed: false,
      });
    } else if (!final) {
      slots.push({
        id: entry.id,
        entry,
        screen: null,
        source: "pending",
        changed: true,
      });
    }
  }

  const unmatched = [...closedById.keys()].filter((id) => !outlineById.has(id));
  for (const id of unmatched) {
    const done = closedById.get(id)!;
    const prior = baseById.get(id);
    slots.push({
      id,
      entry: null,
      screen: done,
      source: "closed",
      changed: !prior || !sameJson(prior, done),
    });
  }

  if (!final) {
    for (const prior of baseScreens) {
      if (outlineById.has(prior.id) || closedById.has(prior.id)) continue;
      slots.push({
        id: prior.id,
        entry: null,
        screen: prior,
        source: "retained",
        changed: false,
      });
    }
  }

  return { slots, unmatched };
}

/**
 * Outline entries a superseded job planned but never landed: new or changed
 * entries whose screen didn't close. Keep entries are already on the canvas.
 */
export function pendingFromSuperseded(
  outline: OutlineEntry[],
  closed: Screen[],
): OutlineEntry[] {
  const landed = new Set(closed.map((s) => s.id));
  return outline.filter((e) => e.status !== "keep" && !landed.has(e.id));
}
