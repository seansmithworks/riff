"use client";

// DialKit ships in production on this route only — it's imported exclusively
// from src/app/voice-lab, so it never reaches the `/` bundle. `productionEnabled`
// overrides DialKit's own dev-only default; do not remove it here.
//
// mode="inline" is DialKit's own library mechanism for docking (README:
// "Use mode='inline' to render DialKit directly in your layout instead of as
// a floating popover. The panel fills its container and scrolls internally,
// which is useful for embedding in a sidebar"). The caller (VoiceLabLayout)
// provides that container; in inline mode `position`/`defaultOpen` are
// ignored by the library, so they're not passed here.
import "dialkit/styles.css";
import { DialRoot } from "dialkit";

export default function DialKitRoot() {
  return <DialRoot mode="inline" productionEnabled theme="light" />;
}
