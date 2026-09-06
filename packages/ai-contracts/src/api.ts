import { z } from "zod";
import { AI_LIMITS } from "./limits.js";
import { ModelMetadataSchema, TranscriptionMetadataSchema } from "./metadata.js";

/**
 * Wire schemas for the AI Worker.
 *
 * Two jobs, both text-out: turn a recording into a transcript, and rewrite a
 * chaotic entry into the line notation the deterministic parser reads. No
 * request carries a user id — the Worker derives it from the verified bearer
 * token, so a `userId` field would be a lie the server would have to ignore.
 *
 * Neither response is structured training data. The browser runs the shared
 * deterministic parser over the text, shows the result for review, and saves
 * through the athlete's own RLS-protected rows; no model output is ever
 * persisted unvalidated.
 */

/** The non-audio half of a transcription request: the `meta` multipart field. */
export const TranscribeMetaSchema = z.object({
  mimeType: z.string().min(1).max(120),
  /** Client-measured; the Worker rejects anything over the duration limit. */
  durationSeconds: z
    .number()
    .positive()
    .max(AI_LIMITS.maxAudioDurationSeconds)
    .nullable()
    .default(null),
  /** BCP-47 hint, e.g. `en`. Null lets the model auto-detect. */
  language: z.string().min(2).max(16).nullable().default(null),
});
export type TranscribeMeta = z.infer<typeof TranscribeMetaSchema>;

/**
 * `POST /v1/transcriptions`. The audio itself is discarded after this
 * response; the transcript is returned so the athlete can check what was
 * heard before anything is saved.
 */
export const TranscribeResponseSchema = z.object({
  transcript: z.string().min(1),
  transcription: TranscriptionMetadataSchema,
});
export type TranscribeResponse = z.infer<typeof TranscribeResponseSchema>;

/** `YYYY-MM-DD`. Local copy: the contracts package deliberately has no domain dep. */
export const ApiLocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * `POST /v1/normalizations`. Free-form entry text in, parser notation out.
 *
 * `todayLocalDate` comes from the client because "yesterday" only resolves in
 * the athlete's timezone, which the Worker does not know.
 */
export const NormalizeRequestSchema = z.object({
  text: z.string().min(1).max(AI_LIMITS.maxNormalizeTextChars),
  todayLocalDate: ApiLocalDateSchema,
});
export type NormalizeRequest = z.infer<typeof NormalizeRequestSchema>;

/**
 * The rewrite is *text*, not a draft: structure is produced by the shared
 * deterministic parser in the browser, where every ambiguity still becomes a
 * visible warning instead of a value.
 */
export const NormalizeResponseSchema = z.object({
  /** Line notation for the deterministic parser. Never empty. */
  notation: z.string().min(1),
  /** The date the text states the work happened, when it states one. */
  localDate: ApiLocalDateSchema.nullable(),
  normalization: ModelMetadataSchema,
});
export type NormalizeResponse = z.infer<typeof NormalizeResponseSchema>;

/** `GET /health`. Reports configuration, never secrets. */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("ai-worker"),
  provider: z.string().min(1),
  /** Configured model IDs, so a deploy can be checked without a token. */
  models: z.object({
    stt: z.string().min(1),
    normalizer: z.string().min(1),
  }),
  requestId: z.string().min(1),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
