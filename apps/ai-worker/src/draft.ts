import type {
  ModelMetadata,
  ModelWorkoutDraft,
  ParseWorkoutInput,
  WorkoutDraft,
} from "@training/ai-contracts";

/**
 * Server-owned draft fields.
 *
 * A model is asked for training content only. Provenance (`source`), idempotency
 * (`clientRequestKey`), the verbatim source text and the metadata block are
 * filled in here, because they are facts about the request rather than
 * interpretations of it — and because a model that invents an idempotency key
 * would break duplicate suppression on retry.
 */

/** One key per session in the response, derived from the client's idempotency key. */
export function sessionRequestKey(base: string, index: number): string {
  return `${base}:${index + 1}`;
}

/**
 * Injects the server-owned fields into raw model JSON *before* validation, so the
 * model is never asked to produce them and never penalised for omitting them.
 * Defensive throughout: `raw` is untrusted model output, not a typed value.
 */
export function normaliseModelDraft(raw: unknown, input: ParseWorkoutInput): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const draft = raw as Record<string, unknown>;
  const sessions = Array.isArray(draft.sessions) ? draft.sessions : [];

  return {
    ...draft,
    resolvedLocalDate:
      typeof draft.resolvedLocalDate === "string" ? draft.resolvedLocalDate : input.nowLocalDate,
    sessions: sessions.map((session, index) => {
      if (typeof session !== "object" || session === null) return session;
      const fields = session as Record<string, unknown>;
      const rawText =
        typeof fields.rawText === "string" && fields.rawText.length > 0
          ? fields.rawText
          : input.text;
      return {
        ...fields,
        localDate: typeof fields.localDate === "string" ? fields.localDate : input.nowLocalDate,
        source: input.source,
        rawText,
        transcript: input.source === "voice" ? input.text : (fields.transcript ?? null),
        clientRequestKey: sessionRequestKey(input.clientRequestKey, index),
      };
    }),
  };
}

export interface MetadataInput {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly requestId: string;
  readonly startedAtMs: number;
  readonly attempts: number;
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

export function finaliseWorkoutDraft(
  model: ModelWorkoutDraft,
  metadata: ModelMetadata,
): WorkoutDraft {
  return { ...model, metadata };
}
