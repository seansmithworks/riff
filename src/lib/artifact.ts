// Artifact schema — the contract between AI generation and the renderers.
// Match this shape EXACTLY when wiring structured LLM output.

export type Artifact =
  | {
      kind: "wireframe";
      title: string;
      screens: Screen[];
      platform?: "mobile" | "desktop";
    }
  | { kind: "flow"; title: string; nodes: FlowNode[]; edges: FlowEdge[] };

export interface Screen {
  id: string; // slug
  name: string; // "Home", "Checkout"
  elements: Element[]; // vertical stack, top to bottom
}

export type Element =
  | { type: "navbar"; title: string; actions?: string[] }
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "button"; label: string; variant?: "primary" | "secondary" }
  | { type: "input"; label: string; placeholder?: string }
  | { type: "searchbar"; placeholder?: string }
  | { type: "image"; label?: string; aspect?: "square" | "wide" | "tall" }
  | {
      type: "list";
      items: { title: string; subtitle?: string; hasImage?: boolean }[];
    }
  | { type: "card"; title: string; body?: string; hasImage?: boolean }
  | { type: "row"; children: Element[] } // horizontal group, max depth 1
  | { type: "tabbar"; tabs: string[]; active?: number }
  | { type: "divider" }
  | { type: "avatar"; name?: string };

// One entry of the streamed outline (ARTIFACT_STREAM_JSON_SCHEMA): every
// screen of the resulting wireframe, in display order, with the model's claim
// about it relative to the CURRENT ARTIFACT.
export type OutlineStatus = "new" | "keep" | "changed";

export interface OutlineEntry {
  id: string;
  name: string;
  status: OutlineStatus;
}

export interface FlowNode {
  id: string;
  label: string;
  type: "screen" | "decision" | "action" | "start" | "end";
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

// Plain JSON Schema (no Zod) for LLM structured output / function calling.
// Note: `row` children are restricted to non-`row` element types to enforce
// max depth 1 at the schema level.
const ELEMENT_SCHEMA_BASE = {
  navbar: {
    type: "object",
    properties: {
      type: { const: "navbar" },
      title: { type: "string" },
      actions: { type: "array", items: { type: "string" } },
    },
    required: ["type", "title"],
    additionalProperties: false,
  },
  heading: {
    type: "object",
    properties: {
      type: { const: "heading" },
      text: { type: "string" },
    },
    required: ["type", "text"],
    additionalProperties: false,
  },
  text: {
    type: "object",
    properties: {
      type: { const: "text" },
      text: { type: "string" },
    },
    required: ["type", "text"],
    additionalProperties: false,
  },
  button: {
    type: "object",
    properties: {
      type: { const: "button" },
      label: { type: "string" },
      variant: { type: "string", enum: ["primary", "secondary"] },
    },
    required: ["type", "label"],
    additionalProperties: false,
  },
  input: {
    type: "object",
    properties: {
      type: { const: "input" },
      label: { type: "string" },
      placeholder: { type: "string" },
    },
    required: ["type", "label"],
    additionalProperties: false,
  },
  searchbar: {
    type: "object",
    properties: {
      type: { const: "searchbar" },
      placeholder: { type: "string" },
    },
    required: ["type"],
    additionalProperties: false,
  },
  image: {
    type: "object",
    properties: {
      type: { const: "image" },
      label: { type: "string" },
      aspect: { type: "string", enum: ["square", "wide", "tall"] },
    },
    required: ["type"],
    additionalProperties: false,
  },
  list: {
    type: "object",
    properties: {
      type: { const: "list" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            subtitle: { type: "string" },
            hasImage: { type: "boolean" },
          },
          required: ["title"],
          additionalProperties: false,
        },
      },
    },
    required: ["type", "items"],
    additionalProperties: false,
  },
  card: {
    type: "object",
    properties: {
      type: { const: "card" },
      title: { type: "string" },
      body: { type: "string" },
      hasImage: { type: "boolean" },
    },
    required: ["type", "title"],
    additionalProperties: false,
  },
  tabbar: {
    type: "object",
    properties: {
      type: { const: "tabbar" },
      tabs: { type: "array", items: { type: "string" } },
      active: { type: "number" },
    },
    required: ["type", "tabs"],
    additionalProperties: false,
  },
  divider: {
    type: "object",
    properties: {
      type: { const: "divider" },
    },
    required: ["type"],
    additionalProperties: false,
  },
  avatar: {
    type: "object",
    properties: {
      type: { const: "avatar" },
      name: { type: "string" },
    },
    required: ["type"],
    additionalProperties: false,
  },
} as const;

const LEAF_ELEMENT_SCHEMAS = Object.values(ELEMENT_SCHEMA_BASE);

const ROW_ELEMENT_SCHEMA = {
  type: "object",
  properties: {
    type: { const: "row" },
    children: {
      type: "array",
      // max depth 1: row children may not themselves be rows
      items: { anyOf: LEAF_ELEMENT_SCHEMAS },
    },
  },
  required: ["type", "children"],
  additionalProperties: false,
};

const ELEMENT_SCHEMA = {
  anyOf: [...LEAF_ELEMENT_SCHEMAS, ROW_ELEMENT_SCHEMA],
};

const SCREEN_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    elements: { type: "array", items: ELEMENT_SCHEMA },
  },
  required: ["id", "name", "elements"],
  additionalProperties: false,
};

const FLOW_NODE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    type: {
      type: "string",
      enum: ["screen", "decision", "action", "start", "end"],
    },
  },
  required: ["id", "label", "type"],
  additionalProperties: false,
};

const FLOW_EDGE_SCHEMA = {
  type: "object",
  properties: {
    from: { type: "string" },
    to: { type: "string" },
    label: { type: "string" },
  },
  required: ["from", "to"],
  additionalProperties: false,
};

export const ARTIFACT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Artifact",
  anyOf: [
    {
      type: "object",
      properties: {
        kind: { const: "wireframe" },
        title: { type: "string" },
        screens: { type: "array", items: SCREEN_SCHEMA },
        platform: { type: "string", enum: ["mobile", "desktop"] },
      },
      required: ["kind", "title", "screens"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "flow" },
        title: { type: "string" },
        nodes: { type: "array", items: FLOW_NODE_SCHEMA },
        edges: { type: "array", items: FLOW_EDGE_SCHEMA },
      },
      required: ["kind", "title", "nodes", "edges"],
      additionalProperties: false,
    },
  ],
} as const;

const OUTLINE_ENTRY_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    status: { type: "string", enum: ["new", "keep", "changed"] },
  },
  required: ["id", "name", "status"],
  additionalProperties: false,
};

// The streamed variant, exactly the candidate schema that passed the Step 1
// gate spike (src/app/api/dev/stream-bench/route.ts, 15/15 order-correct and
// valid). Wireframe properties are listed head-first (kind, platform, title,
// outline) so the outline lands before any screen. Key order is NOT enforced
// by constrained decoding, so the stream tracker never relies on it.
// Validated wireframes still map to Artifact: outline is dropped at merge.
export const ARTIFACT_STREAM_JSON_SCHEMA = {
  $schema: ARTIFACT_JSON_SCHEMA.$schema,
  title: ARTIFACT_JSON_SCHEMA.title,
  anyOf: [
    {
      type: "object",
      properties: {
        kind: { const: "wireframe" },
        platform: { type: "string", enum: ["mobile", "desktop"] },
        title: { type: "string" },
        outline: { type: "array", items: OUTLINE_ENTRY_SCHEMA },
        screens: { type: "array", items: SCREEN_SCHEMA },
      },
      required: ["kind", "platform", "title", "outline", "screens"],
      additionalProperties: false,
    },
    ARTIFACT_JSON_SCHEMA.anyOf[1],
  ],
} as const;

export function validateArtifact(value: unknown): value is Artifact {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "wireframe") {
    return Array.isArray(v.screens) && v.screens.length > 0;
  }
  if (v.kind === "flow") {
    return (
      Array.isArray(v.nodes) &&
      v.nodes.length > 0 &&
      Array.isArray(v.edges) &&
      v.edges.length > 0
    );
  }
  return false;
}
