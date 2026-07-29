"use client";

import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { BatteryFull, SignalHigh, Wifi } from "lucide-react";
import type { Screen } from "@/lib/artifact";
import { WireframeElement } from "./WireframeElement";

const FRAME_WIDTH = 340;
const GUTTER = 96;

// Static iOS status bar — time left, connectivity glyphs right. Monochrome,
// quiet, never interactive.
function StatusBar() {
  return (
    <div className="flex shrink-0 items-center justify-between px-5 pb-1 pt-2">
      <span className="text-[13px] font-semibold text-zinc-900">9:41</span>
      <div className="flex items-center gap-1.5 text-zinc-500">
        <SignalHigh className="h-3.5 w-3.5" strokeWidth={1.75} />
        <Wifi className="h-3.5 w-3.5" strokeWidth={1.75} />
        <BatteryFull className="h-4 w-4" strokeWidth={1.75} />
      </div>
    </div>
  );
}

// Home indicator lives in its own flex row below the scrollable screen
// content (which is where `tabbar` renders via `mt-auto`), so it never
// overlaps the tab bar regardless of screen content.
function HomeIndicator() {
  return (
    <div className="flex shrink-0 items-center justify-center py-2">
      <div className="h-[5px] w-[134px] rounded-full bg-zinc-300" />
    </div>
  );
}

function PhoneFrameNode({ data }: NodeProps) {
  const screen = data.screen as Screen;
  return (
    <div className="flex shrink-0 flex-col items-center gap-3">
      <span className="text-xs font-medium tracking-wide text-zinc-500">
        {screen.name}
      </span>
      <div className="flex h-[640px] w-[340px] flex-col overflow-hidden rounded-[28px] border border-zinc-300 bg-white shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)]">
        <StatusBar />
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto py-3">
          {screen.elements.map((element, i) => (
            <WireframeElement key={i} element={element} />
          ))}
        </div>
        <HomeIndicator />
      </div>
    </div>
  );
}

const nodeTypes = { screenFrame: PhoneFrameNode };

function WireframeCanvasInner({ screens }: { screens: Screen[] }) {
  const { fitView } = useReactFlow();

  const nodes: Node[] = useMemo(
    () =>
      screens.map((screen, i) => ({
        id: screen.id,
        type: "screenFrame",
        data: { screen },
        position: { x: i * (FRAME_WIDTH + GUTTER), y: 0 },
        draggable: true,
        connectable: false,
      })),
    [screens],
  );

  const nodeIds = nodes.map((n) => n.id).join("-");

  // Bottom padding keeps artifacts clear of the always-on mic overlay
  // (~160px tall) without shrinking the ReactFlow container itself — that
  // shrinking is what used to detach <Controls /> from the true viewport
  // corner (see page.tsx main, which no longer carries pb-40).
  useEffect(() => {
    fitView({
      padding: { top: 0.15, right: 0.15, bottom: "180px", left: 0.15 },
      minZoom: 0.15,
      maxZoom: 1.5,
      duration: 400,
    });
  }, [nodeIds, fitView]);

  return (
    <div
      className="h-full w-full"
      style={{
        background:
          "radial-gradient(ellipse 60% 50% at 12% 15%, rgba(0,245,241,0.08), transparent 60%), radial-gradient(ellipse 55% 45% at 88% 85%, rgba(183,255,0,0.07), transparent 60%)",
      }}
    >
      <ReactFlow
        key={screens.map((s) => s.id).join("-")}
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        fitView
        fitViewOptions={{
          padding: { top: 0.15, right: 0.15, bottom: "180px", left: 0.15 },
          minZoom: 0.4,
          maxZoom: 1.5,
        }}
        minZoom={0.15}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      >
        <Background color="#d4d4d8" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function WireframeCanvas({ screens }: { screens: Screen[] }) {
  return (
    <ReactFlowProvider>
      <WireframeCanvasInner screens={screens} />
    </ReactFlowProvider>
  );
}
