import type { Screen } from "@/lib/artifact";
import { WireframeElement } from "./WireframeElement";

function PhoneFrame({ screen }: { screen: Screen }) {
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

export function WireframeCanvas({ screens }: { screens: Screen[] }) {
  return (
    <div className="flex h-full w-full items-center overflow-x-auto px-10 py-10">
      <div className="flex gap-8">
        {screens.map((screen) => (
          <PhoneFrame key={screen.id} screen={screen} />
        ))}
      </div>
    </div>
  );
}
