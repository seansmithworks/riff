import { notFound } from "next/navigation";
import { InkOptions } from "./InkOptions";

// Dev-only A/B of the two ink rules for the streaming sketch, driven by one
// replayed spike run (docs/plans/riff-real-stream.html, decision 1).
export default function InkOptionsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <InkOptions />;
}
