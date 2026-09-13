import { notFound } from "next/navigation";
import { InkOptions } from "./InkOptions";

// Dev-only comparison of per-element draw treatments for the streaming
// sketch, driven by one replayed spike run (docs/plans/riff-real-stream.html,
// decision 1 picked per element).
export default function InkOptionsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <InkOptions />;
}
