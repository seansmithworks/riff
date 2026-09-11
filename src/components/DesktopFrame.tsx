import type { Element, Screen } from "@/lib/artifact";
import { Sketch } from "./Sketch";
import { WireframeElement } from "./WireframeElement";

export const DESKTOP_FRAME_WIDTH = 720;
const DESKTOP_FRAME_HEIGHT = 480;
const TITLE_BAR_HEIGHT = 32;

// Browser-chrome frame for desktop-platform wireframes: same white fill and
// drop-shadow treatment as the phone frame, sized wide (720x480) instead of
// tall. Content renders in a single column with equal-width row children so
// side-by-side cards/buttons read correctly at this width.
export function DesktopFrame({ screen }: { screen: Screen }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-3">
      <span className="text-xs font-medium tracking-wide text-zinc-500">
        {screen.name}
      </span>
      <div
        className="relative flex flex-col overflow-hidden rounded-[12px] border border-transparent bg-white shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)]"
        style={{ width: DESKTOP_FRAME_WIDTH, height: DESKTOP_FRAME_HEIGHT }}
      >
        <Sketch
          kind="rect"
          radius={12}
          seedKey={`desktop-frame:${screen.id}`}
        />
        <div
          className="relative flex shrink-0 items-center gap-3 px-3"
          style={{ height: TITLE_BAR_HEIGHT }}
        >
          <div className="absolute inset-x-0 bottom-0 h-px">
            <Sketch
              kind="line"
              seedKey={`desktop-titlebar-rule:${screen.id}`}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {["a", "b", "c"].map((k) => (
              <div key={k} className="relative h-2.5 w-2.5">
                <Sketch
                  kind="ellipse"
                  seedKey={`desktop-titlebar-dot:${screen.id}:${k}`}
                />
              </div>
            ))}
          </div>
          <div className="relative flex-1 rounded-full border border-transparent px-3 py-1">
            <Sketch
              kind="rect"
              radius={999}
              seedKey={`desktop-titlebar-pill:${screen.id}`}
            />
            <span className="truncate text-[11px]/[14px] text-zinc-500">
              {screen.name}
            </span>
          </div>
        </div>
        <div className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-3">
          {screen.elements.map((element, i) => (
            <DesktopElement key={i} element={element} />
          ))}
        </div>
      </div>
    </div>
  );
}

// "row" children get equal widths on desktop so side-by-side cards/buttons
// fill the wide frame instead of the phone frame's flex-none wrapping.
function DesktopElement({ element }: { element: Element }) {
  if (element.type === "row") {
    return (
      <div className="desktop-row flex gap-3">
        {element.children.map((child, i) => (
          <div key={i} className="flex-1">
            <WireframeElement element={child} />
          </div>
        ))}
      </div>
    );
  }
  return <WireframeElement element={element} />;
}
