"use client";

// Agentation mounted route-scoped, in production, with no endpoint/webhook
// prop — it never issues a network request (annotations stay in
// localStorage only).
//
// Its default position is fixed bottom-right of the *viewport*, which lands
// on top of the DialKit sidebar in the side-by-side layout (>=600px). The
// `!` (important) utilities below override its inline fixed-position style:
// the right offset clears the 320px sidebar + gap at >=600px (flush right on
// phones, where the sidebar docks below instead); the bottom offset clears
// the stage status line's row (44px min-height + gap + page padding) at
// every width.
import { Agentation } from "agentation";

export default function AgentationMount() {
  return (
    <Agentation className="!bottom-24 !right-4 min-[600px]:!right-[336px]" />
  );
}
