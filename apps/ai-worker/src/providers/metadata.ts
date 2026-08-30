import type { ModelMetadata } from "@training/ai-contracts";

/**
 * Provenance for a model response, built the same way by every provider so a
 * transcript can always be traced back to the provider, model and prompt
 * revision that produced it.
 */
export interface MetadataInput {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly requestId: string;
  readonly startedAtMs: number;
  readonly attempts: number;
  /** Injectable clock for tests. */
  readonly nowMs?: number;
}

export function buildMetadata(input: MetadataInput): ModelMetadata {
  const now = input.nowMs ?? Date.now();
  return {
    provider: input.provider,
    model: input.model,
    promptVersion: input.promptVersion,
    requestId: input.requestId,
    latencyMs: Math.max(0, now - input.startedAtMs),
    attempts: input.attempts,
  };
}
