import { z } from "zod";

/**
 * The closed set of failures the AI API is allowed to report.
 *
 * Deliberately small: every code maps to exactly one HTTP status and one
 * client-side recovery action. `schema_invalid` in particular is a *refusal* —
 * the model produced something that did not validate, so the caller gets an
 * error instead of a partially-guessed draft.
 */
export const AiErrorCodeEnum = z.enum([
  /** Missing, expired, malformed or unverifiable bearer token. 401. */
  "unauthorized",
  /** `Origin` header absent from the configured allowlist. 403. */
  "forbidden_origin",
  /** Request body exceeded the configured byte limit. 413. */
  "payload_too_large",
  /** Audio longer than the configured maximum duration. 413. */
  "audio_too_long",
  /** The model provider failed, timed out, or returned nothing usable. 502. */
  "upstream_error",
  /** Request body, or a model result after one repair attempt, failed validation. 422. */
  "schema_invalid",
  /** App-level rate limit for the authenticated user. 429. */
  "rate_limited",
  /** Unknown route or method, so even a typo answers in this envelope. 404. */
  "not_found",
]);
export type AiErrorCode = z.infer<typeof AiErrorCodeEnum>;

/**
 * Every non-2xx response has this shape. `requestId` is echoed in the
 * `x-request-id` header and in server logs, so a user-reported failure can be
 * traced without the user pasting a token or a transcript.
 */
export const AiErrorSchema = z.object({
  code: AiErrorCodeEnum,
  /** Safe to show a user. Never contains tokens, audio or transcript text. */
  message: z.string().min(1),
  requestId: z.string().min(1),
  /** Machine-readable extras: schema issue paths, limits, retry hints. */
  details: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type AiError = z.infer<typeof AiErrorSchema>;

/** Response envelope. Success bodies are never wrapped; errors always are. */
export const AiErrorResponseSchema = z.object({ error: AiErrorSchema });
export type AiErrorResponse = z.infer<typeof AiErrorResponseSchema>;

/** One status per code, so transports cannot disagree about semantics. */
export const AI_ERROR_STATUS: Readonly<Record<AiErrorCode, number>> = {
  unauthorized: 401,
  forbidden_origin: 403,
  payload_too_large: 413,
  audio_too_long: 413,
  upstream_error: 502,
  schema_invalid: 422,
  rate_limited: 429,
  not_found: 404,
};

export function aiError(
  code: AiErrorCode,
  message: string,
  requestId: string,
  details: Record<string, unknown> | null = null,
): AiErrorResponse {
  return { error: { code, message, requestId, details } };
}

export function statusForAiError(code: AiErrorCode): number {
  return AI_ERROR_STATUS[code];
}
