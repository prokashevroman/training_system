import { z } from "zod";

/**
 * Where a draft came from, carried on every AI response.
 *
 * `provider` and `model` are recorded rather than assumed: when a Cloudflare
 * model is deprecated and the configured ID changes, existing drafts still say
 * which model produced them. `promptVersion` makes a prompt change auditable
 * the same way.
 */
export const ModelMetadataSchema = z.object({
  /** `cloudflare`, `mock`, later `modal` / `ollama`. Never a model ID. */
  provider: z.string().min(1),
  /** The exact model identifier the provider was configured with. */
  model: z.string().min(1),
  /** Bumped whenever the prompt text changes in a way that alters output. */
  promptVersion: z.string().min(1),
  /** Echoes the response `x-request-id`; ties a draft to its server log line. */
  requestId: z.string().min(1),
  latencyMs: z.number().int().nonnegative(),
  /** Number of model calls made, including the single permitted schema repair. */
  attempts: z.number().int().positive().default(1),
});
export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

/** Transcription provenance. The transcript itself lives on the draft. */
export const TranscriptionMetadataSchema = ModelMetadataSchema.extend({
  /** Detected or requested language tag, null when the provider is unsure. */
  language: z.string().nullable().default(null),
  /** Duration the provider reported, null when it reports none. */
  durationSeconds: z.number().nonnegative().nullable().default(null),
});
export type TranscriptionMetadata = z.infer<typeof TranscriptionMetadataSchema>;
