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
  const label = String(data.label);
  // Scale the diamond to the label so longer text doesn't clip the rotated
  // shape's readable center; clamp so short labels still read as a diamond.
  const width = Math.min(260, Math.max(160, label.length * 9 + 90));
  const height = Math.round(width * 0.65);
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width, height }}
    >
      {handles}
      <div className="absolute inset-0 rotate-45 rounded-md border border-[#ff6b4a]/60 bg-[#ff6b4a]/10" />
      <span className="relative max-w-[62%] px-1 text-center text-xs font-semibold leading-tight text-zinc-50">
        {label}
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
