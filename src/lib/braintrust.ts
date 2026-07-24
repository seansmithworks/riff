// Braintrust logging for artifact generation — observability only.
// This module must never throw and must never block the caller on network
// I/O; a Braintrust outage or misconfiguration can't be allowed to break
// artifact generation.

import { initLogger, type Logger } from "braintrust";
import type { Artifact } from "./artifact";

const PROJECT_NAME = "riff";

// Lazily created, memoized singleton. `undefined` = not yet attempted,
// `null` = attempted and unavailable (no key, or initLogger threw).
let cachedLogger: Logger<true> | null | undefined;

function getLogger(): Logger<true> | null {
  if (cachedLogger !== undefined) return cachedLogger;
  try {
    cachedLogger = initLogger({
      projectName: PROJECT_NAME,
      apiKey: process.env.BRAINTRUST_API_KEY,
      asyncFlush: true, // log() returns synchronously; upload happens in the background
    });
  } catch {
    cachedLogger = null;
  }
  return cachedLogger;
}

function normalizeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

export interface LogGenerationParams {
  /** The spoken design brief that triggered generation. */
  brief: string;
  /** Which artifact kind was requested/produced. */
  artifactKind: Artifact["kind"];
  /** The generated artifact JSON. Omitted when generation failed. */
  artifact?: Artifact;
  /** The model id used for generation. */
  model: string;
  /** Wall-clock generation latency in milliseconds. */
  latencyMs: number;
  /** The error that occurred, if any. */
  error?: unknown;
}

/**
 * Fire-and-forget log of a single artifact generation to Braintrust.
 *
 * - No-ops silently if BRAINTRUST_API_KEY is unset.
 * - Never throws — a Braintrust failure can't break generation.
 * - Never blocks — does not await network I/O.
 */
export function logGeneration({
  brief,
  artifactKind,
  artifact,
  model,
  latencyMs,
  error,
}: LogGenerationParams): void {
  try {
    if (!process.env.BRAINTRUST_API_KEY) return;

    const logger = getLogger();
    if (!logger) return;

    const result = logger.log({
      input: brief,
      output: artifact,
      error: error === undefined ? undefined : normalizeError(error),
      metadata: {
        model,
        latencyMs,
        artifactKind,
        success: error === undefined,
      },
    });

    // Defensive: with asyncFlush true (set above), log() resolves
    // synchronously. Guard anyway so an unawaited call can never surface an
    // unhandled rejection if that ever changes.
    if (
      result &&
      typeof (result as unknown as Promise<unknown>).catch === "function"
    ) {
      (result as unknown as Promise<unknown>).catch(() => {});
    }
  } catch {
    // Braintrust logging must never break artifact generation.
  }
}
