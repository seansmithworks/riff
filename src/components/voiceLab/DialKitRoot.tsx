"use client";

// DialKit ships in production on this route only — it's imported exclusively
// from src/app/voice-lab, so it never reaches the `/` bundle. `productionEnabled`
// overrides DialKit's own dev-only default; do not remove it here.
import "dialkit/styles.css";
import { useEffect, useState } from "react";
import { DialRoot } from "dialkit";

// DialKit's popover panel is desktop-floating by default (280px expanded).
// On phone widths it must start collapsed to an icon so the stage and
// status line stay reachable and nothing forces horizontal scroll.
export default function DialKitRoot() {
  const [defaultOpen, setDefaultOpen] = useState(true);

  useEffect(() => {
    setDefaultOpen(window.innerWidth >= 768);
  }, []);

  return (
    <DialRoot
      productionEnabled
      position="top-right"
      theme="light"
      defaultOpen={defaultOpen}
    />
  );
}
