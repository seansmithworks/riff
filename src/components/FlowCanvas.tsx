"use client";

import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowEdge, FlowNode } from "@/lib/artifact";
import { layoutNodes } from "@/lib/flow-layout";
import { nodeTypes } from "./FlowNodes";

function toReactFlowType(type: FlowNode["type"]) {
  if (type === "start" || type === "end") return "terminal";
  return type;
}

function FlowCanvasInner({
  nodes,
  edges,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
}) {
  const { fitView } = useReactFlow();

  const { layoutedNodes, flowEdges } = useMemo(() => {
    const rfNodes: Node[] = nodes.map((n) => ({
      id: n.id,
      type: toReactFlowType(n.type),
      data: { label: n.label, variant: n.type },
      position: { x: 0, y: 0 },
    }));
    const rfEdges: Edge[] = edges.map((e, i) => ({
      id: `${e.from}-${e.to}-${i}`,
      source: e.from,
      target: e.to,
      label: e.label,
      animated: true,
      style: { stroke: "#71717a" },
      labelStyle: { fill: "#d4d4d8", fontSize: 11 },
      labelBgStyle: { fill: "#18181b" },
    }));
    return { layoutedNodes: layoutNodes(rfNodes, rfEdges), flowEdges: rfEdges };
  }, [nodes, edges]);

  const nodeIds = layoutedNodes.map((n) => n.id).join("-");

  useEffect(() => {
    fitView({ padding: 0.15, minZoom: 0.5, maxZoom: 2.5, duration: 400 });
  }, [nodeIds, fitView]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        key={nodes.map((n) => n.id).join("-")}
        nodes={layoutedNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, minZoom: 0.5, maxZoom: 2.5 }}
        minZoom={0.2}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#27272a" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function FlowCanvas({
  nodes,
  edges,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
}) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner nodes={nodes} edges={edges} />
    </ReactFlowProvider>
  );
}
