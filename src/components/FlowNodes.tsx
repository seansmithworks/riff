import { Handle, Position, type NodeProps } from "@xyflow/react";

const handles = (
  <>
    <Handle type="target" position={Position.Left} className="!bg-zinc-400" />
    <Handle type="source" position={Position.Right} className="!bg-zinc-400" />
  </>
);

export function ScreenNode({ data }: NodeProps) {
  return (
    <div className="flex min-w-[160px] items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-3 text-center text-sm font-medium text-zinc-800 shadow-sm">
      {handles}
      {String(data.label)}
    </div>
  );
}

export function ActionNode({ data }: NodeProps) {
  return (
    <div className="flex min-w-[160px] items-center justify-center rounded-lg border border-dashed border-zinc-400 bg-zinc-50 px-4 py-3 text-center text-sm font-medium text-zinc-700 shadow-sm">
      {handles}
      {String(data.label)}
    </div>
  );
}

export function DecisionNode({ data }: NodeProps) {
  return (
    <div className="relative flex h-[90px] w-[160px] items-center justify-center">
      {handles}
      <div className="absolute inset-0 rotate-45 rounded-md border border-[#ff6b4a]/60 bg-[#ff6b4a]/10" />
      <span className="relative px-6 text-center text-xs font-medium text-zinc-800">
        {String(data.label)}
      </span>
    </div>
  );
}

export function TerminalNode({ data }: NodeProps) {
  const isStart = data.variant === "start";
  return (
    <div
      className={`flex min-w-[110px] items-center justify-center rounded-full px-5 py-2.5 text-center text-sm font-semibold shadow-sm ${
        isStart ? "bg-[#ff6b4a] text-white" : "bg-zinc-900 text-white"
      }`}
    >
      {handles}
      {String(data.label)}
    </div>
  );
}

export const nodeTypes = {
  screen: ScreenNode,
  action: ActionNode,
  decision: DecisionNode,
  terminal: TerminalNode,
};
