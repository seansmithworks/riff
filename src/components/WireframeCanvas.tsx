"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type FitViewOptions,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { BatteryFull, SignalHigh, Wifi } from "lucide-react";
import type { Artifact, Element } from "@/lib/artifact";
import {
  artifactSlots,
  sketchSlots,
  type CanvasSlot,
} from "@/lib/canvas-slots";
import type { Sketch as SketchDraft } from "@/lib/store";
import { Sketch } from "./Sketch";
import { WireframeElement } from "./WireframeElement";
import { DesktopFrame, DESKTOP_FRAME_WIDTH } from "./DesktopFrame";
import {
  BODY_INK,
  InkScope,
  ScreenInkProvider,
  StaleWash,
  contentKey,
  elementKeys,
  frameInk,
  useReducedMotion,
} from "./InkScope";

const FRAME_WIDTH = 340;
const GUTTER = 96;
const NO_EDGES: never[] = [];

// Static iOS status bar — time left, connectivity glyphs right. Monochrome,
// quiet, never interactive.
function StatusBar() {
  return (
    <div className="flex shrink-0 items-center justify-between px-3 pb-1 pt-2">
      <span className="text-[13px]/[16px] font-semibold text-zinc-900">
        9:41
      </span>
      <div className="flex items-center gap-1.5 text-zinc-500">
        <SignalHigh className="h-3.5 w-3.5" strokeWidth={1.75} />
        <Wifi className="h-3.5 w-3.5" strokeWidth={1.75} />
        <BatteryFull className="h-4 w-4" strokeWidth={1.75} />
      </div>
    </div>
  );
}

// Home indicator lives in its own flex row below the tab bar (which now
// renders as its own shrink-0 row, not inside the scroll column), so it
// never overlaps the tab bar or scrolls out of view regardless of content.
function HomeIndicator({ seedKey }: { seedKey: string }) {
  return (
    <div className="flex shrink-0 items-center justify-center py-2">
      <div className="relative h-[5px] w-[134px]">
        <Sketch kind="line" seedKey={`home-indicator:${seedKey}`} />
      </div>
    </div>
  );
}

type CanvasState = {
  slots: Map<string, CanvasSlot>;
  jobId: number | null;
  reducedMotion: boolean;
};

// Slot content reaches frames through context, not node data: React Flow
// re-adopts and re-measures (hidden) any node whose object changes, so nodes
// change only when the slot ids or platform do.
const CanvasContext = createContext<CanvasState | null>(null);

function ScreenFrameNode({ id, data }: NodeProps) {
  const canvas = useContext(CanvasContext);
  const slot = canvas?.slots.get(id);
  // React Flow applies node changes a commit after the slots change, so a
  // removed slot's node can render once more.
  if (!canvas || !slot) return null;
  return (
    <ScreenInkProvider
      slot={slot}
      jobId={canvas.jobId}
      reducedMotion={canvas.reducedMotion}
    >
      {data.platform === "desktop" ? (
        <DesktopFrame slot={slot} />
      ) : (
        <PhoneFrame slot={slot} />
      )}
    </ScreenInkProvider>
  );
}

function PhoneFrame({ slot }: { slot: CanvasSlot }) {
  const tabbar = slot.elements.find(
    (element): element is Extract<Element, { type: "tabbar" }> =>
      element.type === "tabbar",
  );
  const rest = slot.elements.filter((element) => element.type !== "tabbar");
  const keys = elementKeys(rest);

  return (
    <div className="flex shrink-0 flex-col items-center gap-3">
      <span className="text-xs font-medium tracking-wide text-zinc-500">
        {slot.name}
      </span>
      <div
        data-screen-frame={slot.id}
        data-ink-frame={slot.state}
        className="relative flex h-[640px] w-[340px] flex-col overflow-hidden rounded-[28px] border border-transparent bg-white shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)]"
        style={frameInk(slot)}
      >
        <Sketch
          kind="rect"
          radius={28}
          strokeWidth={1.5}
          seedKey={`frame:${slot.id}`}
        />
        <StatusBar />
        <div className="relative flex min-h-0 flex-1 flex-col" style={BODY_INK}>
          <div
            data-slot-body={slot.id}
            data-ink-key={contentKey(slot.elements)}
            className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto py-3"
          >
            {rest.map((element, i) => (
              <InkScope key={keys[i]} inkKey={keys[i]}>
                <WireframeElement element={element} />
              </InkScope>
            ))}
          </div>
          {tabbar ? (
            <div className="shrink-0">
              <InkScope key={contentKey(tabbar)} inkKey={contentKey(tabbar)}>
                <WireframeElement element={tabbar} />
              </InkScope>
            </div>
          ) : null}
          {slot.state === "stale" ? <StaleWash /> : null}
        </div>
        <HomeIndicator seedKey={slot.id} />
      </div>
    </div>
  );
}

const nodeTypes = { screenFrame: ScreenFrameNode };

type FitRecord = {
  at: number;
  slots: number;
  platform: string;
  rightInset: number;
  duration: number;
};

// Dev-only camera log: window.__riffFitCount and window.__riffFits.
function recordFit(fit: Omit<FitRecord, "at">) {
  const w = window as unknown as {
    __riffFitCount?: number;
    __riffFits?: FitRecord[];
  };
  w.__riffFitCount = (w.__riffFitCount ?? 0) + 1;
  (w.__riffFits ??= []).push({ at: Math.round(performance.now()), ...fit });
}

type WireframeArtifact = Extract<Artifact, { kind: "wireframe" }>;

function WireframeCanvasInner({
  artifact,
  sketch,
  rightInset,
}: {
  artifact: WireframeArtifact | null;
  sketch: SketchDraft | null;
  rightInset: number;
}) {
  const { fitView } = useReactFlow();
  const reducedMotion = useReducedMotion();
  // The draft while one exists (a superseded job's holds until the next
  // head), otherwise the committed artifact.
  const slots = useMemo(
    () =>
      sketch ? sketchSlots(sketch) : artifactSlots(artifact?.screens ?? []),
    [sketch, artifact],
  );
  const platform = (sketch ? sketch.platform : artifact?.platform) ?? "mobile";
  const frameWidth = platform === "desktop" ? DESKTOP_FRAME_WIDTH : FRAME_WIDTH;
  const jobId = sketch?.jobId ?? null;

  const canvas = useMemo<CanvasState>(
    () => ({
      slots: new Map(slots.map((slot) => [slot.id, slot])),
      jobId,
      reducedMotion,
    }),
    [slots, jobId, reducedMotion],
  );

  const idsKey = JSON.stringify(slots.map((slot) => slot.id));
  const nodes: Node[] = useMemo(
    () =>
      (JSON.parse(idsKey) as string[]).map((id, i) => ({
        id,
        type: "screenFrame",
        data: { platform },
        position: { x: i * (frameWidth + GUTTER), y: 0 },
        draggable: true,
        connectable: false,
      })),
    [idsKey, platform, frameWidth],
  );

  // Camera. Frames are fixed-size and placed by index, so the bounds change
  // only with the slot count or platform; element and screen events never
  // refit. ReactFlow's fitView prop frames the first layout at mount,
  // instantly; this effect's fitView() only handles later count, platform or
  // inset changes (animated). Calling fitView() at mount as well would
  // replace the queued mount options with a 400ms swoop, and in dev
  // StrictMode's second pass of ReactFlow's prop sync cancels a fit queued
  // from here.
  //
  // Bottom padding keeps artifacts clear of the always-on mic overlay
  // (~160px tall) without shrinking the ReactFlow container itself — that
  // shrinking is what used to detach <Controls /> from the true viewport
  // corner (see page.tsx main, which no longer carries pb-40).
  const fitOptions = useMemo<FitViewOptions>(
    () => ({
      padding: {
        top: 0.15,
        right: rightInset ? `${rightInset + 24}px` : 0.15,
        bottom: "180px",
        left: 0.15,
      },
      minZoom: 0.15,
      maxZoom: 1.5,
    }),
    [rightInset],
  );
  const slotCount = slots.length;
  const framed = useRef<{
    slotCount: number;
    platform: string;
    rightInset: number;
  } | null>(null);
  useEffect(() => {
    const last = framed.current;
    if (
      last?.slotCount === slotCount &&
      last.platform === platform &&
      last.rightInset === rightInset
    ) {
      return; // Already framed (StrictMode re-runs effects in dev).
    }
    framed.current = { slotCount, platform, rightInset };
    if (slotCount === 0) return;
    const duration = !last || last.slotCount === 0 ? 0 : 400;
    if (last) void fitView({ ...fitOptions, duration });
    if (process.env.NODE_ENV !== "production") {
      recordFit({ slots: slotCount, platform, rightInset, duration });
    }
  }, [slotCount, platform, rightInset, fitOptions, fitView]);

  return (
    <div
      className="h-full w-full"
      style={{
        background:
          "radial-gradient(ellipse 60% 50% at 12% 15%, rgba(0,245,241,0.08), transparent 60%), radial-gradient(ellipse 55% 45% at 88% 85%, rgba(183,255,0,0.07), transparent 60%)",
      }}
    >
      <CanvasContext.Provider value={canvas}>
        <ReactFlow
          nodes={nodes}
          edges={NO_EDGES}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          fitView
          fitViewOptions={fitOptions}
          minZoom={0.15}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          style={{ background: "transparent" }}
        >
          <Background color="#d4d4d8" gap={20} />
          <Controls />
        </ReactFlow>
      </CanvasContext.Provider>
    </div>
  );
}

export function WireframeCanvas({
  artifact,
  sketch,
  rightInset,
}: {
  artifact: WireframeArtifact | null;
  sketch: SketchDraft | null;
  rightInset: number;
}) {
  return (
    <ReactFlowProvider>
      <WireframeCanvasInner
        artifact={artifact}
        sketch={sketch}
        rightInset={rightInset}
      />
    </ReactFlowProvider>
  );
}
