import { z } from "zod";
import { AI_LIMITS } from "./limits.js";
import { TranscriptionMetadataSchema } from "./metadata.js";

/**
 * Wire schemas for the AI Worker.
 *
 * One job: turn a recording into text. No request carries a user id — the
 * Worker derives it from the verified bearer token, so a `userId` field would
 * be a lie the server would have to ignore.
 *
 * The transcript is the product. Structuring it into sessions and sets is the
 * athlete's edit, done in the browser against their own RLS-protected rows;
 * no model is ever asked to guess reps out of prose.
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

/** `GET /health`. Reports configuration, never secrets. */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("ai-worker"),
  provider: z.string().min(1),
  /** Configured model IDs, so a deploy can be checked without a token. */
  models: z.object({
    stt: z.string().min(1),
  }),
  requestId: z.string().min(1),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
