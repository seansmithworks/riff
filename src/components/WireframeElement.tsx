import type { Element } from "@/lib/artifact";

// Diagonal-cross placeholder box used for images.
function ImageBox({
  label,
  aspect = "wide",
}: {
  label?: string;
  aspect?: "square" | "wide" | "tall";
}) {
  const heightClass =
    aspect === "square" ? "h-32" : aspect === "tall" ? "h-56" : "h-24";
  return (
    <div
      className={`relative w-full ${heightClass} overflow-hidden rounded-md border border-zinc-300 bg-zinc-100`}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          y1="0"
          x2="100%"
          y2="100%"
          stroke="#d4d4d8"
          strokeWidth="1"
        />
        <line
          x1="100%"
          y1="0"
          x2="0"
          y2="100%"
          stroke="#d4d4d8"
          strokeWidth="1"
        />
      </svg>
      {label ? (
        <span className="absolute bottom-1 left-1.5 rounded bg-white/80 px-1 text-[10px] text-zinc-500">
          {label}
        </span>
      ) : null}
    </div>
  );
}

function Button({
  label,
  variant = "primary",
}: {
  label: string;
  variant?: "primary" | "secondary";
}) {
  if (variant === "secondary") {
    return (
      <button
        type="button"
        className="w-full rounded-full border border-zinc-300 px-4 py-2 text-center text-sm font-medium text-zinc-700"
      >
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="w-full rounded-full bg-[#1F7A4D] px-4 py-2 text-center text-sm font-semibold text-white"
    >
      {label}
    </button>
  );
}

export function WireframeElement({ element }: { element: Element }) {
  switch (element.type) {
    case "navbar":
      return (
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5">
          <span className="text-sm font-semibold text-zinc-900">
            {element.title}
          </span>
          {element.actions?.length ? (
            <div className="flex gap-2">
              {element.actions.map((action) => (
                <span key={action} className="text-xs text-zinc-500">
                  {action}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      );

    case "heading":
      return (
        <h3 className="px-3 text-base font-semibold text-zinc-900">
          {element.text}
        </h3>
      );

    case "text":
      return (
        <p className="px-3 text-xs leading-relaxed text-zinc-500">
          {element.text}
        </p>
      );

    case "button":
      return (
        <div className="px-3">
          <Button label={element.label} variant={element.variant} />
        </div>
      );

    case "input":
      return (
        <div className="flex flex-col gap-1 px-3">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            {element.label}
          </span>
          <div className="rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-xs text-zinc-400">
            {element.placeholder ?? ""}
          </div>
        </div>
      );

    case "searchbar":
      return (
        <div className="px-3">
          <div className="flex items-center gap-1.5 rounded-full border border-zinc-300 bg-zinc-50 px-3 py-2">
            <span className="text-zinc-400">⌕</span>
            <span className="text-xs text-zinc-400">
              {element.placeholder ?? "Search"}
            </span>
          </div>
        </div>
      );

    case "image":
      return (
        <div className="px-3">
          <ImageBox label={element.label} aspect={element.aspect} />
        </div>
      );

    case "list":
      return (
        <div className="flex flex-col divide-y divide-zinc-100 px-3">
          {element.items.map((item, i) => (
            <div key={i} className="flex items-center gap-2.5 py-2.5">
              {item.hasImage ? (
                <div className="h-9 w-9 shrink-0 rounded-md border border-zinc-300 bg-zinc-100" />
              ) : null}
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-xs font-medium text-zinc-800">
                  {item.title}
                </span>
                {item.subtitle ? (
                  <span className="truncate text-[11px] text-zinc-400">
                    {item.subtitle}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      );

    case "card":
      return (
        <div className="mx-3 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
          {element.hasImage ? <ImageBox aspect="wide" /> : null}
          <span className="text-xs font-semibold text-zinc-800">
            {element.title}
          </span>
          {element.body ? (
            <span className="text-[11px] leading-relaxed text-zinc-500">
              {element.body}
            </span>
          ) : null}
        </div>
      );

    case "row":
      return (
        <div className="flex gap-2 px-3">
          {element.children.map((child, i) => (
            <div key={i} className="flex-1">
              <WireframeElement element={child} />
            </div>
          ))}
        </div>
      );

    case "tabbar":
      return (
        <div className="mt-auto flex items-center justify-around border-t border-zinc-200 bg-white py-2.5">
          {element.tabs.map((tab, i) => (
            <span
              key={tab}
              className={`text-[10px] font-medium ${
                i === element.active ? "text-[#1F7A4D]" : "text-zinc-400"
              }`}
            >
              {tab}
            </span>
          ))}
        </div>
      );

    case "divider":
      return <div className="mx-3 border-t border-zinc-200" />;

    case "avatar":
      return (
        <div className="flex items-center gap-2 px-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-zinc-100 text-[10px] font-medium text-zinc-500">
            {element.name?.slice(0, 1) ?? "?"}
          </div>
          {element.name ? (
            <span className="text-xs text-zinc-600">{element.name}</span>
          ) : null}
        </div>
      );

    default:
      return null;
  }
}
