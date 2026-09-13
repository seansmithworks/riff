// Dev-only spike bench for the real-stream plan, Step 1
// (docs/plans/riff-real-stream.html). One POST runs one arm of the matrix
// N times, sequentially, straight against Fireworks with no retry or
// failover, so every recorded number is exactly one glm-5p2 call. Each run's
// content chunks + timestamps are saved as a fixture; results.json holds
// every run's metrics, per-arm aggregates and the six gate checks.
//
//   curl -s localhost:3320/api/dev/stream-bench -H 'content-type: application/json' \
//     -d '{"arm":"R2","runs":5,"reasoning":"none"}'
//
// Arms R0/R1 are today's request: the body comes from the real builder in
// src/lib/generate.ts. The candidate schema and outline rules are bench-local.

import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  ARTIFACT_JSON_SCHEMA,
  validateArtifact,
  type Artifact,
  type Element,
  type Screen,
} from "@/lib/artifact";
import { buildRequestBodyForBrief } from "@/lib/generate";

const FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
const OUT_DIR = path.join(
  process.cwd(),
  "docs/evidence/stream/spike-2026-09-13",
);
const RESULTS_PATH = path.join(OUT_DIR, "results.json");
const BASE_ARTIFACT_PATH = path.join(
  process.cwd(),
  "docs/evidence/artifact-before.json",
);
// Measurement, not UX: long enough that a slow evolve still yields a t_done.
const RUN_TIMEOUT_MS = 150_000;
const MAX_RUNS_PER_REQUEST = 5;

// Briefs from docs/evidence/EVOLVE-MOMENT.md:11,14 plus the plan's R4 brief.
const INITIAL_BRIEF =
  "A mobile app for booking a dog walker. Browse walkers nearby, view a walker profile, and confirm a booking.";
const TIMESLOT_BRIEF = "Add a screen where they pick a time slot and pay.";
const TABBAR_BRIEF = "Add a tab bar to every screen.";

type SchemaMode = "today" | "candidate";
type Reasoning = "default" | "none";
type Variant = "prompt-only" | "outline-idname" | "key-order";

type ArmSpec = {
  schema: SchemaMode;
  stream: boolean;
  brief: string;
  evolve: boolean;
  // Fixed reasoning for the calibration arms; the rest take the R1/R1b winner.
  reasoning?: Reasoning;
};

const ARMS: Record<string, ArmSpec> = {
  R0: {
    schema: "today",
    stream: false,
    brief: INITIAL_BRIEF,
    evolve: false,
    reasoning: "default",
  },
  R1: {
    schema: "today",
    stream: true,
    brief: INITIAL_BRIEF,
    evolve: false,
    reasoning: "default",
  },
  R1b: {
    schema: "today",
    stream: true,
    brief: INITIAL_BRIEF,
    evolve: false,
    reasoning: "none",
  },
  R2: {
    schema: "candidate",
    stream: true,
    brief: INITIAL_BRIEF,
    evolve: false,
  },
  R3: {
    schema: "candidate",
    stream: true,
    brief: TIMESLOT_BRIEF,
    evolve: true,
  },
  "R3-control": {
    schema: "today",
    stream: true,
    brief: TIMESLOT_BRIEF,
    evolve: true,
  },
  R4: { schema: "candidate", stream: true, brief: TABBAR_BRIEF, evolve: true },
};

const VARIANTS: Variant[] = ["prompt-only", "outline-idname", "key-order"];

// ---------------------------------------------------------------------------
// Candidate request (bench-local)

function candidateSchema(idNameOnly: boolean) {
  const [wireframe, flow] = ARTIFACT_JSON_SCHEMA.anyOf;
  const outlineItem = idNameOnly
    ? {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
        additionalProperties: false,
      }
    : {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          status: { type: "string", enum: ["new", "keep", "changed"] },
        },
        required: ["id", "name", "status"],
        additionalProperties: false,
      };
  return {
    $schema: ARTIFACT_JSON_SCHEMA.$schema,
    title: ARTIFACT_JSON_SCHEMA.title,
    anyOf: [
      {
        type: "object",
        properties: {
          kind: wireframe.properties.kind,
          platform: wireframe.properties.platform,
          title: wireframe.properties.title,
          outline: { type: "array", items: outlineItem },
          screens: wireframe.properties.screens,
        },
        required: ["kind", "platform", "title", "outline", "screens"],
        additionalProperties: false,
      },
      flow,
    ],
  };
}

const OUTLINE_RULES = `- For wireframes, "outline" lists every screen of the resulting wireframe in display order, one entry per screen: {"id", "name", "status"}. "status" is "new" for a screen that is not in the CURRENT ARTIFACT (every screen when there is no CURRENT ARTIFACT), "keep" for an existing screen whose name and elements stay exactly as they are, and "changed" for an existing screen whose name or any element changes.
- "screens" holds the full content of every outline entry marked "new" or "changed", in outline order. Never put a "keep" screen in "screens": kept screens are reused from the CURRENT ARTIFACT exactly as they are. If the brief affects a screen at all, mark it "changed" and include it in full.
`;

const OUTLINE_RULES_IDNAME = `- For wireframes, "outline" lists every screen of the resulting wireframe in display order, one entry per screen: {"id", "name"}.
- "screens" holds the full content of every screen that is new or changes, in outline order. Leave out screens that stay exactly as they are in the CURRENT ARTIFACT: they are reused unchanged. If the brief affects a screen at all, include it in full.
`;

const KEY_ORDER_RULE = `- Write the top-level keys in exactly this order: "kind", "platform", "title", "outline", "screens". Finish "outline" before starting "screens".
`;

const SCHEMA_ANCHOR = "- Output must strictly conform to this JSON Schema:";

function buildBody(
  spec: ArmSpec,
  reasoning: Reasoning,
  variant: Variant | null,
  base: Artifact,
): Record<string, unknown> {
  const real = buildRequestBodyForBrief(
    spec.brief,
    spec.evolve ? base : undefined,
  );
  let system = real.messages[0].content;
  const body: Record<string, unknown> = { ...real };

  if (spec.schema === "candidate") {
    const todaySchema = JSON.stringify(ARTIFACT_JSON_SCHEMA);
    if (!system.includes(todaySchema) || !system.includes(SCHEMA_ANCHOR)) {
      throw new Error(
        "generate.ts system prompt changed shape; update the bench splice",
      );
    }
    const schema = candidateSchema(variant === "outline-idname");
    const rules =
      variant === "outline-idname" ? OUTLINE_RULES_IDNAME : OUTLINE_RULES;
    system = system
      .replace(todaySchema, () => JSON.stringify(schema))
      .replace(SCHEMA_ANCHOR, () => rules + SCHEMA_ANCHOR);
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "Artifact", schema: { ...schema, type: "object" } },
    };
  }
  if (variant === "key-order") {
    system = system.replace(
      SCHEMA_ANCHOR,
      () => KEY_ORDER_RULE + SCHEMA_ANCHOR,
    );
  }
  if (variant === "prompt-only") delete body.response_format;

  body.messages = [
    { role: "system", content: system },
    ...real.messages.slice(1),
  ];
  if (spec.stream) body.stream = true;
  if (reasoning === "none") body.reasoning_effort = "none";
  return body;
}

// ---------------------------------------------------------------------------
// Incremental JSON scanner: records when each object/array closes, by path.

type PathSeg = string | number;
type Close = { path: PathSeg[]; start: number; end: number; t: number };

class JsonCloseScanner {
  private stack: {
    kind: "obj" | "arr";
    path: PathSeg[];
    start: number;
    key: string | null;
    index: number;
    expectKey: boolean;
  }[] = [];
  private inString = false;
  private escape = false;
  private stringIsKey = false;
  private keyBuf = "";
  private pos = 0;
  topKeys: { key: string; t: number }[] = [];
  closes: Close[] = [];

  feed(text: string, t: number) {
    for (const ch of text) {
      if (this.inString) {
        if (this.escape) {
          this.escape = false;
          if (this.stringIsKey) this.keyBuf += ch;
        } else if (ch === "\\") {
          this.escape = true;
        } else if (ch === '"') {
          this.inString = false;
          const top = this.stack[this.stack.length - 1];
          if (this.stringIsKey && top) {
            top.key = this.keyBuf;
            top.expectKey = false;
            if (this.stack.length === 1)
              this.topKeys.push({ key: this.keyBuf, t });
          }
        } else if (this.stringIsKey) {
          this.keyBuf += ch;
        }
      } else {
        const top = this.stack[this.stack.length - 1];
        if (ch === '"') {
          this.inString = true;
          this.stringIsKey = !!top && top.kind === "obj" && top.expectKey;
          this.keyBuf = "";
        } else if (ch === "{" || ch === "[") {
          const childPath: PathSeg[] = top
            ? [...top.path, top.kind === "obj" ? (top.key ?? "") : top.index]
            : [];
          this.stack.push({
            kind: ch === "{" ? "obj" : "arr",
            path: childPath,
            start: this.pos,
            key: null,
            index: 0,
            expectKey: ch === "{",
          });
        } else if (ch === "}" || ch === "]") {
          const closed = this.stack.pop();
          if (closed) {
            this.closes.push({
              path: closed.path,
              start: closed.start,
              end: this.pos + 1,
              t,
            });
          }
        } else if (ch === "," && top) {
          if (top.kind === "obj") top.expectKey = true;
          else top.index++;
        }
      }
      this.pos += ch.length;
    }
  }
}

// ---------------------------------------------------------------------------
// One call

type Chunk = { t: number; c: string };
type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
  prompt_tokens_details?: { cached_tokens?: number } | null;
};

type RawCall = {
  httpStatus: number | null;
  error: string | null;
  t_headers: number | null;
  t_firstByte: number | null;
  t_firstReasoning: number | null;
  t_firstContent: number | null;
  t_done: number | null;
  sseEvents: number;
  sawDoneMarker: boolean;
  chunks: Chunk[];
  reasoning: string;
  content: string;
  finishReason: string | null;
  usage: Usage | null;
  scanner: JsonCloseScanner;
};

async function callOnce(
  body: Record<string, unknown>,
  stream: boolean,
  apiKey: string,
): Promise<RawCall> {
  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  const call: RawCall = {
    httpStatus: null,
    error: null,
    t_headers: null,
    t_firstByte: null,
    t_firstReasoning: null,
    t_firstContent: null,
    t_done: null,
    sseEvents: 0,
    sawDoneMarker: false,
    chunks: [],
    reasoning: "",
    content: "",
    finishReason: null,
    usage: null,
    scanner: new JsonCloseScanner(),
  };

  const handleEvent = (data: string, t: number) => {
    if (data === "[DONE]") {
      call.sawDoneMarker = true;
      return;
    }
    let evt: {
      usage?: Usage;
      error?: unknown;
      choices?: {
        finish_reason?: string | null;
        delta?: { content?: string | null; reasoning_content?: string | null };
      }[];
    };
    try {
      evt = JSON.parse(data);
    } catch {
      return;
    }
    call.sseEvents++;
    if (evt.usage) call.usage = evt.usage;
    if (evt.error)
      call.error = `stream error event: ${JSON.stringify(evt.error).slice(0, 300)}`;
    const choice = evt.choices?.[0];
    if (choice?.finish_reason) call.finishReason = choice.finish_reason;
    const reasoningDelta = choice?.delta?.reasoning_content;
    if (typeof reasoningDelta === "string" && reasoningDelta) {
      call.t_firstReasoning ??= t;
      call.reasoning += reasoningDelta;
    }
    const delta = choice?.delta?.content;
    if (typeof delta === "string" && delta) {
      call.t_firstContent ??= t;
      call.chunks.push({ t, c: delta });
      call.content += delta;
      call.scanner.feed(delta, t);
    }
  };

  try {
    const res = await fetch(FIREWORKS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    });
    call.t_headers = at();
    call.httpStatus = res.status;
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      call.error = `Fireworks API error ${res.status}: ${text.slice(0, 500)}`;
      call.t_done = at();
      return call;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      const t = at();
      if (done) break;
      call.t_firstByte ??= t;
      buf += decoder.decode(value, { stream: true });
      if (!stream) continue;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("data:")) handleEvent(line.slice(5).trim(), t);
      }
    }
    call.t_done = at();

    if (stream) {
      const tail = buf.trim();
      if (tail.startsWith("data:"))
        handleEvent(tail.slice(5).trim(), call.t_done);
    } else {
      const data = JSON.parse(buf);
      const choice = data?.choices?.[0];
      call.usage = data?.usage ?? null;
      call.finishReason = choice?.finish_reason ?? null;
      call.reasoning = choice?.message?.reasoning_content ?? "";
      const content: string = choice?.message?.content ?? "";
      call.content = content;
      call.sseEvents = 1;
      if (content) {
        call.t_firstContent = call.t_done;
        call.chunks.push({ t: call.t_done, c: content });
        call.scanner.feed(content, call.t_done);
      }
    }
  } catch (err) {
    call.error = `network/stream: ${err instanceof Error ? err.message : String(err)}`;
    call.t_done ??= at();
  }
  return call;
}

// ---------------------------------------------------------------------------
// Analysis

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const hasTabbar = (s: Screen | undefined) =>
  !!s?.elements?.some(
    (e: Element) =>
      e.type === "tabbar" ||
      (e.type === "row" && e.children?.some((c) => c.type === "tabbar")),
  );

type OutlineEntry = { id: string; name: string; status?: string };

type OutlineReport = {
  id: string;
  name: string;
  status: string | null;
  inBase: boolean;
  inScreens: boolean;
  identicalToBase: boolean | null;
  actual:
    "new" | "reused-from-base" | "changed" | "resent-identical" | "missing";
  hasTabbar: boolean;
};

function analyze(label: string, spec: ArmSpec, call: RawCall, base: Artifact) {
  const baseScreens =
    spec.evolve && base.kind === "wireframe" ? base.screens : [];
  const baseById = new Map(baseScreens.map((s) => [s.id, s]));
  const isChangedVsBase = (s: Screen) => {
    const b = baseById.get(s.id);
    return !b || canonical(b) !== canonical(s);
  };

  const closes = call.scanner.closes;
  const headClose = closes.find(
    (c) => c.path.length === 1 && c.path[0] === "outline",
  );
  const screenCloses = closes.filter(
    (c) =>
      c.path.length === 2 &&
      c.path[0] === "screens" &&
      typeof c.path[1] === "number",
  );
  const elementCloses = closes.filter(
    (c) =>
      c.path.length === 4 &&
      c.path[0] === "screens" &&
      c.path[2] === "elements",
  );
  const firstElementClosedPerScreen = screenCloses.map((_, i) => {
    const hit = elementCloses.find((c) => c.path[1] === i);
    return hit ? hit.t : null;
  });
  let t_firstChangedScreenClosed: number | null = null;
  if (spec.evolve) {
    for (const c of screenCloses) {
      try {
        const s = JSON.parse(call.content.slice(c.start, c.end)) as Screen;
        if (isChangedVsBase(s)) {
          t_firstChangedScreenClosed = c.t;
          break;
        }
      } catch {
        // an unparseable slice can't count as a landed screen
      }
    }
  }

  const topLevelKeyOrder = call.scanner.topKeys.map((k) => k.key);
  const idx = (k: string) => topLevelKeyOrder.indexOf(k);
  const orderCorrect =
    spec.schema === "candidate"
      ? ["kind", "platform", "title", "outline"].every(
          (k) => idx(k) >= 0 && idx("screens") > idx(k),
        )
      : null;

  let parsed: Record<string, unknown> | null = null;
  let parseError: string | null = null;
  const first = call.content.indexOf("{");
  const last = call.content.lastIndexOf("}");
  try {
    parsed = JSON.parse(call.content.slice(first, last + 1));
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  const emitted = (
    Array.isArray(parsed?.screens) ? parsed.screens : []
  ) as Screen[];
  const emittedById = new Map(emitted.map((s) => [s.id, s]));
  let outline: OutlineReport[] | null = null;
  let merged: Screen[] = emitted;
  let outlineResolved: boolean | null = null;

  if (spec.schema === "candidate" && parsed) {
    const entries = (
      Array.isArray(parsed.outline) ? parsed.outline : []
    ) as OutlineEntry[];
    merged = entries
      .map((o) => emittedById.get(o.id) ?? baseById.get(o.id))
      .filter((s): s is Screen => !!s);
    outlineResolved = entries.length > 0 && merged.length === entries.length;
    outline = entries.map((o) => {
      const inBase = baseById.has(o.id);
      const sent = emittedById.get(o.id);
      const identical = inBase && sent ? !isChangedVsBase(sent) : null;
      const resolved = sent ?? baseById.get(o.id);
      return {
        id: o.id,
        name: o.name,
        status: o.status ?? null,
        inBase,
        inScreens: !!sent,
        identicalToBase: identical,
        actual: !resolved
          ? "missing"
          : !inBase
            ? "new"
            : !sent
              ? "reused-from-base"
              : identical
                ? "resent-identical"
                : "changed",
        hasTabbar: hasTabbar(resolved),
      };
    });
  }

  const mergedArtifact = parsed
    ? spec.schema === "candidate"
      ? {
          kind: parsed.kind,
          title: parsed.title,
          platform: parsed.platform,
          screens: merged,
        }
      : parsed
    : null;
  const validates = validateArtifact(mergedArtifact);
  const valid = !!parsed && validates && outlineResolved !== false;

  const byId = new Map(merged.map((s) => [s.id, s]));
  const stat = (id: string) =>
    outline?.find((o) => o.id === id)?.status ?? null;
  let honesty: Record<string, unknown> | null = null;
  if (spec.schema === "candidate" && outline) {
    const outlineIds = new Set(outline.map((o) => o.id));
    const entriesHonest = outline.every((o) =>
      o.status === "new"
        ? !o.inBase && o.inScreens
        : o.status === "keep"
          ? o.inBase && !o.inScreens
          : o.status === "changed"
            ? o.inBase && o.inScreens && o.identicalToBase === false
            : false,
    );
    const strayScreenIds = emitted
      .map((s) => s.id)
      .filter((id) => !outlineIds.has(id));
    const keepInScreens = outline.some(
      (o) => o.status === "keep" && o.inScreens,
    );
    const s1s2Keep = stat("s1") === "keep" && stat("s2") === "keep";
    const newPresent = outline.some((o) => !o.inBase && o.inScreens);
    const allTabbar = merged.length > 0 && merged.every(hasTabbar);
    const pass = label.startsWith("R3")
      ? s1s2Keep && newPresent && !keepInScreens
      : label.startsWith("R4")
        ? allTabbar
        : entriesHonest && strayScreenIds.length === 0;
    honesty = {
      pass,
      entriesHonest,
      strayScreenIds,
      keepInScreens,
      s1s2Keep,
      newPresent,
      s3MarkedChanged: stat("s3") === "changed",
      allTabbar,
    };
  } else if (spec.evolve && parsed) {
    const s3 = byId.get("s3");
    honesty = {
      s3Rewritten: !s3 || isChangedVsBase(s3),
      s3MissingId: !s3,
      s1s2Identical: ["s1", "s2"].every((id) => {
        const s = byId.get(id);
        return !!s && !isChangedVsBase(s);
      }),
      allTabbar: merged.length > 0 && merged.every(hasTabbar),
    };
  }

  return {
    t_headers: call.t_headers,
    t_firstByte: call.t_firstByte,
    t_firstReasoning: call.t_firstReasoning,
    t_firstContent: call.t_firstContent,
    t_headClosed: headClose ? headClose.t : null,
    t_screensKey:
      call.scanner.topKeys.find((k) => k.key === "screens")?.t ?? null,
    t_firstElementClosed0: firstElementClosedPerScreen[0] ?? null,
    t_firstElementClosedPerScreen: firstElementClosedPerScreen,
    t_screenClosed: screenCloses.map((c) => c.t),
    t_firstChangedScreenClosed,
    t_done: call.t_done,
    contentChunks: call.chunks.length,
    sseEvents: call.sseEvents,
    sawDoneMarker: call.sawDoneMarker,
    reasoningChars: call.reasoning.length,
    contentBytes: Buffer.byteLength(call.content),
    finishReason: call.finishReason,
    usage: call.usage,
    topLevelKeyOrder,
    orderCorrect,
    parseOk: !!parsed,
    parseError,
    validateArtifact: validates,
    outlineResolved,
    valid,
    screenIds: merged.map((s) => s.id),
    emittedScreenIds: emitted.map((s) => s.id),
    outline,
    honesty,
  };
}

// ---------------------------------------------------------------------------
// Aggregation + gate

type RunRecord = {
  label: string;
  arm: string;
  variant: Variant | null;
  n: number;
  startedAt: string;
  request: {
    model: unknown;
    stream: boolean;
    reasoning: Reasoning;
    responseFormat: boolean;
    schema: string;
    brief: string;
    evolve: boolean;
  };
  httpStatus: number | null;
  error: string | null;
  metrics: ReturnType<typeof analyze> | null;
};

type Results = { runs: RunRecord[] };

function stats(values: (number | null | undefined)[]) {
  const v = values
    .filter((x): x is number => typeof x === "number")
    .sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
  return { median, min: v[0], max: v[v.length - 1], n: v.length };
}

function aggregate(runs: RunRecord[]) {
  const ok = runs.filter((r) => !r.error && r.metrics);
  const m = ok.map((r) => r.metrics!);
  const count = (pred: (x: (typeof m)[number]) => boolean) =>
    m.filter(pred).length;
  const sum = (pick: (u: Usage) => number | undefined) =>
    m.reduce((acc, x) => acc + (x.usage ? (pick(x.usage) ?? 0) : 0), 0);
  return {
    calls: runs.length,
    succeeded: ok.length,
    errors: runs
      .filter((r) => r.error)
      .map((r) => `${r.label}-${r.n}: ${r.error}`),
    firstContent: stats(m.map((x) => x.t_firstContent)),
    headClosed: stats(m.map((x) => x.t_headClosed)),
    firstElementClosed0: stats(m.map((x) => x.t_firstElementClosed0)),
    screen0Closed: stats(m.map((x) => x.t_screenClosed[0])),
    firstChangedScreenClosed: stats(m.map((x) => x.t_firstChangedScreenClosed)),
    done: stats(m.map((x) => x.t_done)),
    minContentChunks: m.length
      ? Math.min(...m.map((x) => x.contentChunks))
      : null,
    orderCorrect: count((x) => x.orderCorrect === true),
    valid: count((x) => x.valid),
    honestPass: count((x) => x.honesty?.pass === true),
    s1s2Keep: count((x) => x.honesty?.s1s2Keep === true),
    newPresent: count((x) => x.honesty?.newPresent === true),
    keepInScreensRuns: count((x) => x.honesty?.keepInScreens === true),
    s3MarkedChanged: count((x) => x.honesty?.s3MarkedChanged === true),
    s3Rewritten: count((x) => x.honesty?.s3Rewritten === true),
    allTabbar: count((x) => x.honesty?.allTabbar === true),
    finishReasons: m.map((x) => x.finishReason),
    keyOrders: [...new Set(m.map((x) => x.topLevelKeyOrder.join(",")))],
    usage: {
      prompt: sum((u) => u.prompt_tokens),
      completion: sum((u) => u.completion_tokens),
      reasoning: sum((u) => u.completion_tokens_details?.reasoning_tokens),
      cachedPrompt: sum((u) => u.prompt_tokens_details?.cached_tokens),
      runsWithUsage: count((x) => !!x.usage),
    },
  };
}

type Agg = ReturnType<typeof aggregate>;

function gate(arms: Record<string, Agg>) {
  const med = (label: string, key: keyof Agg) =>
    (arms[label]?.[key] as { median: number } | null | undefined)?.median ??
    null;
  const le = (x: number | null, limit: number) => x !== null && x <= limit;

  const r0Done = med("R0", "done");
  const scale = r0Done !== null && r0Done > 12_800 ? r0Done / 12_800 : 1;
  const streamLabels = Object.keys(arms).filter((l) => l !== "R0");
  const minChunks = Math.min(
    ...streamLabels.map((l) => arms[l].minContentChunks ?? Infinity),
  );

  const r1 = med("R1", "firstContent");
  const r1b = med("R1b", "firstContent");
  const candidate = ["R2", "R3", "R4"].map((l) => arms[l]).filter(Boolean);
  const candidateRuns = candidate.reduce((a, x) => a + x.calls, 0);
  const r3 = arms.R3;
  const control = arms["R3-control"];
  const r4 = arms.R4;

  return {
    r0MedianDone: r0Done,
    evolveThresholdScale: Number(scale.toFixed(3)),
    reasoningWinner: le(r1b, 1500) ? "none (R1b)" : "default (R1)",
    P1: {
      pass: (le(r1, 1500) || le(r1b, 1500)) && minChunks >= 20,
      r1MedianFirstContent: r1,
      r1bMedianFirstContent: r1b,
      minContentChunksAnyStreamRun: Number.isFinite(minChunks)
        ? minChunks
        : null,
    },
    P2: {
      pass:
        le(med("R2", "headClosed"), 2500) &&
        le(arms.R2?.headClosed?.max ?? null, 3500) &&
        le(med("R3", "headClosed"), 3000 * scale),
      r2HeadClosed: arms.R2?.headClosed ?? null,
      r3MedianHeadClosed: med("R3", "headClosed"),
      r3Limit: Math.round(3000 * scale),
    },
    P3: {
      pass: le(med("R2", "firstElementClosed0"), 3000),
      r2MedianFirstElementClosed0: med("R2", "firstElementClosed0"),
      r2MedianScreen0Closed: med("R2", "screen0Closed"),
      decision1: le(med("R2", "screen0Closed"), 3000)
        ? "per screen"
        : "to Sean with both numbers",
    },
    P4: {
      pass: le(med("R3", "firstChangedScreenClosed"), 5000 * scale),
      r3MedianFirstChangedScreenClosed: med("R3", "firstChangedScreenClosed"),
      limit: Math.round(5000 * scale),
    },
    P5: {
      pass:
        candidateRuns === 15 &&
        candidate.every(
          (a) => a.orderCorrect === a.calls && a.valid === a.calls,
        ),
      orderCorrect: candidate.reduce((a, x) => a + x.orderCorrect, 0),
      valid: candidate.reduce((a, x) => a + x.valid, 0),
      of: candidateRuns,
    },
    P6: {
      pass:
        !!r3 &&
        !!control &&
        !!r4 &&
        r3.s1s2Keep >= 4 &&
        r3.newPresent >= 4 &&
        r3.keepInScreensRuns === 0 &&
        r3.s3MarkedChanged >= control.s3Rewritten - 1 &&
        r4.allTabbar >= 4,
      r3S1S2Keep: r3?.s1s2Keep ?? null,
      r3NewPresent: r3?.newPresent ?? null,
      r3KeepInScreensRuns: r3?.keepInScreensRuns ?? null,
      r3S3MarkedChanged: r3?.s3MarkedChanged ?? null,
      controlS3Rewritten: control?.s3Rewritten ?? null,
      r4AllTabbar: r4?.allTabbar ?? null,
    },
  };
}

// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "FIREWORKS_API_KEY is not set" },
      { status: 500 },
    );
  }

  const input = (await req.json().catch(() => ({}))) as {
    arm?: string;
    runs?: number;
    reasoning?: Reasoning;
    variant?: Variant;
  };
  const spec = input.arm ? ARMS[input.arm] : undefined;
  if (!input.arm || !spec) {
    return NextResponse.json(
      { error: `arm must be one of ${Object.keys(ARMS).join(", ")}` },
      { status: 400 },
    );
  }
  const variant = input.variant ?? null;
  if (variant && !VARIANTS.includes(variant)) {
    return NextResponse.json(
      { error: `variant must be one of ${VARIANTS.join(", ")}` },
      { status: 400 },
    );
  }
  const reasoning = spec.reasoning ?? input.reasoning;
  if (reasoning !== "default" && reasoning !== "none") {
    return NextResponse.json(
      {
        error: `${input.arm} needs reasoning: "default" | "none" (the R1/R1b winner)`,
      },
      { status: 400 },
    );
  }
  const runs = Math.min(
    Math.max(1, Math.floor(input.runs ?? 1)),
    MAX_RUNS_PER_REQUEST,
  );
  const label = variant ? `${input.arm}+${variant}` : input.arm;

  await fs.mkdir(OUT_DIR, { recursive: true });
  const base = JSON.parse(
    await fs.readFile(BASE_ARTIFACT_PATH, "utf8"),
  ) as Artifact;
  const results: Results = await fs
    .readFile(RESULTS_PATH, "utf8")
    .then((s) => JSON.parse(s) as Results)
    .catch(() => ({ runs: [] }));

  const body = buildBody(spec, reasoning, variant, base);
  const batch: RunRecord[] = [];

  for (let i = 0; i < runs; i++) {
    const n = results.runs.filter((r) => r.label === label).length + 1;
    const startedAt = new Date().toISOString();
    const call = await callOnce(body, spec.stream, apiKey);
    const metrics = call.content ? analyze(label, spec, call, base) : null;
    const record: RunRecord = {
      label,
      arm: input.arm,
      variant,
      n,
      startedAt,
      request: {
        model: body.model,
        stream: spec.stream,
        reasoning,
        responseFormat: "response_format" in body,
        schema:
          spec.schema === "candidate" && variant === "outline-idname"
            ? "candidate-idname"
            : spec.schema,
        brief: spec.brief,
        evolve: spec.evolve,
      },
      httpStatus: call.httpStatus,
      error: call.error,
      metrics,
    };
    results.runs.push(record);
    batch.push(record);

    await fs.writeFile(
      path.join(OUT_DIR, `${label}-${n}.json`),
      JSON.stringify(
        {
          ...record,
          requestBody: body,
          content: call.content,
          reasoning: call.reasoning,
          chunks: call.chunks,
        },
        null,
        2,
      ),
    );
    console.log(
      `[stream-bench] ${label}-${n} status ${call.httpStatus} firstContent ${call.t_firstContent}ms head ${metrics?.t_headClosed}ms s0 ${metrics?.t_screenClosed[0]}ms done ${call.t_done}ms chunks ${call.chunks.length}${call.error ? ` error ${call.error.slice(0, 160)}` : ""}`,
    );
  }

  const labels = [...new Set(results.runs.map((r) => r.label))];
  const arms = Object.fromEntries(
    labels.map((l) => [
      l,
      aggregate(results.runs.filter((r) => r.label === l)),
    ]),
  );
  const all = aggregate(results.runs);
  const output = {
    updatedAt: new Date().toISOString(),
    totals: { calls: results.runs.length, usage: all.usage },
    gate: gate(arms),
    arms,
    runs: results.runs,
  };
  await fs.writeFile(RESULTS_PATH, JSON.stringify(output, null, 2));

  return NextResponse.json({
    label,
    batch: batch.map((r) => ({
      n: r.n,
      httpStatus: r.httpStatus,
      error: r.error,
    })),
    arm: arms[label],
    totals: output.totals,
    gate: output.gate,
  });
}
