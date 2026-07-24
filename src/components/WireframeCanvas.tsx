"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Screen } from "@/lib/artifact";
import { WireframeElement } from "./WireframeElement";

const FRAME_WIDTH = 340;
const GUTTER = 96;

function PhoneFrameNode({ data }: NodeProps) {
  const screen = data.screen as Screen;
  return (
    <div className="flex shrink-0 flex-col items-center gap-3">
      <span className="text-xs font-medium tracking-wide text-zinc-400">
        {screen.name}
      </span>
      <div className="flex h-[640px] w-[340px] flex-col overflow-hidden rounded-[28px] border border-zinc-300 bg-white shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)]">
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto py-3">
          {screen.elements.map((element, i) => (
            <WireframeElement key={i} element={element} />
          ))}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { screenFrame: PhoneFrameNode };

export function WireframeCanvas({ screens }: { screens: Screen[] }) {
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

  return (
    <div className="h-full w-full">
      <ReactFlow
        key={screens.map((s) => s.id).join("-")}
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.15, minZoom: 0.4, maxZoom: 1.5 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#27272a" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
