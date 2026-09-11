"use client";

// Agentation mounted route-scoped, in production, with no endpoint/webhook
// prop — it never issues a network request (annotations stay in
// localStorage only).
import { Agentation } from "agentation";

export default function AgentationMount() {
  return <Agentation />;
}
