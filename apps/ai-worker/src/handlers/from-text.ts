import type { FromTextResponse, ParseWorkoutInput } from "@training/ai-contracts";
import { FromTextRequestSchema, FromTextResponseSchema } from "@training/ai-contracts";
import { readJson, validate } from "../body.js";
import { resolveLocalDate } from "../dates.js";
import { AiHttpError } from "../http-error.js";
import { textSize } from "../log.js";
import type { RequestContext } from "./context.js";

/**
 * `POST /v1/workout-drafts/from-text`.
 *
 * Typed entry, and the fallback the voice flow needs when a microphone is
 * unavailable (brief 7.1). Returns a draft; saves nothing.
 */
export async function handleFromText(context: RequestContext): Promise<FromTextResponse> {
  const { config, providers, requestId, logger, user } = context;

  const body = await readJson(
    context.request,
    FromTextRequestSchema,
    config.limits.maxJsonBodyBytes,
    "Request body",
  );

  // The schema caps text at the shared default; an environment may lower it.
  if (body.text.length > config.limits.maxTextChars) {
    throw new AiHttpError("payload_too_large", "Text is longer than the configured limit.", {
      maxTextChars: config.limits.maxTextChars,
    });
  }

  const nowLocalDate = resolveLocalDate(body.timezone, body.localDate);
  const input: ParseWorkoutInput = {
    text: body.text,
    nowLocalDate,
    timezone: body.timezone,
    preferredUnits: body.preferredUnits,
    source: "manual",
    exerciseAliases: body.context.exerciseAliases,
    recentExerciseNames: body.context.recentExerciseNames,
    // Namespaced by the athlete so two users cannot collide on a shared key, and
    // stable across retries so a re-sent draft upserts instead of duplicating.
    clientRequestKey: `text:${user.userId}:${body.idempotencyKey}`,
    requestId,
  };

  const draft = await providers.workoutParser.parseWorkout(input);
  const response = validate(FromTextResponseSchema, draft, "Parser response");

  logger.info("workout_draft_from_text", {
    userId: user.userId,
    provider: providers.name,
    // Counts and sizes only: never the text itself (brief section 12).
    inputChars: textSize(body.text),
    sessions: response.sessions.length,
    warnings: response.warnings.length,
    unconsumedFragments: response.unconsumedFragments.length,
    attempts: response.metadata.attempts,
    latencyMs: response.metadata.latencyMs,
  });

  return response;
}
