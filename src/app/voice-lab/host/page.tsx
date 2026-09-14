import { notFound } from "next/navigation";
import HostHarness from "@/components/voiceLab/HostHarness";

// Dev-only evidence route for the engine's host mode; 404 in production.
export default function VoiceLabHostPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <HostHarness />;
}
