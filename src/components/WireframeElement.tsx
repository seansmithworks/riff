import "drawably/font.css";
import { ChevronRight, Search, Square } from "lucide-react";
import type { Element } from "@/lib/artifact";
import { Sketch, SKETCH_HAND_FONT } from "./Sketch";

// Drawably Pen only covers a–z A–Z, digits, and basic punctuation — fall
// back to the app's own Geist variable for anything it doesn't have a
// glyph for. Applied to navbar titles, headings, button labels, and
// list-item titles only; secondary/body text stays Geist.
const handFontClass = SKETCH_HAND_FONT
  ? "[font-family:'Drawably_Pen',var(--font-sans),system-ui,sans-serif]"
  : "";

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
      className={`relative w-full ${heightClass} overflow-hidden rounded-md border border-transparent bg-zinc-100`}
    >
      <Sketch
        kind="rect"
        radius={8}
        seedKey={`image-box:${label ?? "image"}`}
      />
      <Sketch kind="cross" seedKey={`image-cross:${label ?? "image"}`} />
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
        className="relative w-full rounded-full border border-transparent px-4 py-2 text-center text-[15px]/[19px] font-medium text-zinc-700"
      >
        <Sketch
          kind="rect"
          radius={999}
          seedKey={`button-secondary:${label}`}
        />
        <span className={handFontClass}>{label}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="relative w-full rounded-full bg-[#1F7A4D] px-4 py-2 text-center text-[15px]/[19px] font-semibold text-white"
    >
      <Sketch kind="rect" radius={999} seedKey={`button-primary:${label}`} />
      <span className={handFontClass}>{label}</span>
    </button>
  );
}

export function WireframeElement({ element }: { element: Element }) {
  switch (element.type) {
    case "navbar":
      return (
        <div className="relative flex items-center justify-between border-b border-transparent px-3 py-2.5">
          <div className="absolute inset-x-0 bottom-0 h-px">
            <Sketch kind="line" seedKey={`navbar-rule:${element.title}`} />
          </div>
          <span
            className={`min-w-0 truncate text-[15px]/[19px] font-semibold text-zinc-900 ${handFontClass}`}
          >
            {element.title}
          </span>
          {element.actions?.length ? (
            <div className="flex shrink-0 gap-2">
              {element.actions.map((action) => (
                <span key={action} className="text-[15px]/[19px] text-zinc-500">
                  {action}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      );

    case "heading":
      return (
        <h3
          className={`px-3 text-[19px]/[24px] font-bold text-zinc-900 ${handFontClass}`}
        >
          {element.text}
        </h3>
      );

    case "text":
      return (
        <p className="px-3 text-[13px] leading-relaxed text-zinc-500">
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
          <span className="text-[11px]/[14px] font-medium text-zinc-400">
            {element.label}
          </span>
          <div className="relative rounded-md border border-transparent bg-white px-2.5 py-2 text-[13px]/[16px] text-zinc-400">
            <Sketch kind="rect" radius={8} seedKey={`input:${element.label}`} />
            {element.placeholder ?? ""}
          </div>
        </div>
      );

    case "searchbar":
      return (
        <div className="px-3">
          <div className="relative flex items-center gap-1.5 rounded-full border border-transparent bg-zinc-50 px-3 py-2">
            <Sketch
              kind="rect"
              radius={999}
              seedKey={`searchbar:${element.placeholder ?? "Search"}`}
            />
            <Search
              className="h-3.5 w-3.5 shrink-0 text-zinc-400"
              strokeWidth={1.75}
            />
            <span className="text-[13px]/[16px] text-zinc-400">
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
        <div className="flex flex-col px-3">
          {element.items.map((item, i) => (
            <div key={i} className="relative flex items-center gap-2.5 py-2.5">
              {i < element.items.length - 1 ? (
                <div className="absolute inset-x-0 bottom-0 h-px">
                  <Sketch kind="line" seedKey={`list-rule:${item.title}`} />
                </div>
              ) : null}
              {item.hasImage ? (
                <div className="relative h-9 w-9 shrink-0 rounded-md border border-transparent bg-zinc-100">
                  <Sketch
                    kind="rect"
                    radius={8}
                    seedKey={`list-thumb:${item.title}`}
                  />
                </div>
              ) : null}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span
                  className={`truncate text-[15px]/[19px] font-medium text-zinc-900 ${handFontClass}`}
                >
                  {item.title}
                </span>
                {item.subtitle ? (
                  <span className="truncate text-[13px]/[16px] text-zinc-400">
                    {item.subtitle}
                  </span>
                ) : null}
              </div>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-zinc-400"
                strokeWidth={1.75}
              />
            </div>
          ))}
        </div>
      );

    case "card":
      return (
        <div className="relative mx-3 flex flex-col gap-2 rounded-lg border border-transparent bg-zinc-50/60 p-3">
          <Sketch kind="rect" radius={12} seedKey={`card:${element.title}`} />
          {element.hasImage ? <ImageBox aspect="wide" /> : null}
          <span
            className={`text-[15px]/[19px] font-semibold text-zinc-900 ${handFontClass}`}
          >
            {element.title}
          </span>
          {element.body ? (
            <span className="text-[13px]/[16px] text-zinc-500">
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
        <div className="relative flex items-center justify-around border-t border-transparent bg-white py-2.5">
          <div className="absolute inset-x-0 top-0 h-px">
            <Sketch
              kind="line"
              seedKey={`tabbar-rule:${element.tabs.join(",")}`}
            />
          </div>
          {element.tabs.map((tab, i) => (
            <div key={tab} className="flex flex-col items-center gap-1">
              <Square
                className={`h-5 w-5 ${
                  i === element.active ? "text-[#1F7A4D]" : "text-zinc-400"
                }`}
                strokeWidth={1.75}
              />
              <span
                className={`text-[10px] font-medium ${handFontClass} ${
                  i === element.active ? "text-[#1F7A4D]" : "text-zinc-400"
                }`}
              >
                {tab}
              </span>
            </div>
          ))}
        </div>
      );

    case "divider":
      return (
        <div className="relative mx-3 h-px">
          <Sketch kind="line" seedKey="divider" />
        </div>
      );

    case "avatar":
      return (
        <div className="flex items-center gap-2 px-3">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent bg-zinc-100 text-[10px] font-medium text-zinc-500">
            <Sketch kind="ellipse" seedKey={`avatar:${element.name ?? "?"}`} />
            {element.name?.slice(0, 1) ?? "?"}
          </div>
          {element.name ? (
            <span className="text-[13px]/[16px] text-zinc-600">
              {element.name}
            </span>
          ) : null}
        </div>
      );

    default:
      return null;
  }
}
