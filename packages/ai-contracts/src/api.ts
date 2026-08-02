import { PreferredUnitsEnum } from "@training/domain";
import { z } from "zod";
import { AI_LIMITS } from "./limits.js";
import { PlanDraftSchema, PlanExplanationSchema } from "./plan-draft.js";
import {
  ExerciseAliasHintSchema,
  IdempotencyKeySchema,
  LocalDateStringSchema,
  TimezoneSchema,
} from "./primitives.js";
import { TranscriptionMetadataSchema } from "./metadata.js";
import { WorkoutDraftSchema } from "./workout-draft.js";

/**
 * Wire schemas for the AI Worker.
 *
 * No request carries a user id: the Worker derives it from the verified bearer
 * token (brief 7.3). A `userId` field would be a lie the server would have to
 * ignore, so it does not exist.
 */

/** Parser context the client may attach from its local cache. */
export const ParseContextSchema = z
  .object({
    exerciseAliases: z.array(ExerciseAliasHintSchema).max(AI_LIMITS.maxAliasHints).default([]),
    recentExerciseNames: z
      .array(z.string().min(1).max(120))
      .max(AI_LIMITS.maxRecentExerciseNames)
      .default([]),
  })
  .default({ exerciseAliases: [], recentExerciseNames: [] });
export type ParseContext = z.infer<typeof ParseContextSchema>;

const commonEntryFields = {
  timezone: TimezoneSchema,
  /** Overrides "today"; the client sends it so a midnight upload keeps its date. */
  localDate: LocalDateStringSchema.nullable().default(null),
  preferredUnits: PreferredUnitsEnum.schema.default("metric"),
  idempotencyKey: IdempotencyKeySchema,
  context: ParseContextSchema,
};

export const FromTextRequestSchema = z.object({
  text: z.string().min(1).max(AI_LIMITS.maxTextChars),
  ...commonEntryFields,
});
export type FromTextRequest = z.infer<typeof FromTextRequestSchema>;

/**
 * The non-audio half of a `from-audio` request. Sent either as the `meta` field
 * of a multipart upload or alongside `audioBase64` in a JSON body.
 */
export const FromAudioMetaSchema = z.object({
  ...commonEntryFields,
  mimeType: z.string().min(1).max(120),
  /** Client-measured; the Worker rejects anything over the duration limit. */
  durationSeconds: z
    .number()
    .positive()
    .max(AI_LIMITS.maxAudioDurationSeconds)
    .nullable()
    .default(null),
  language: z.string().min(2).max(16).nullable().default(null),
});
export type FromAudioMeta = z.infer<typeof FromAudioMetaSchema>;

/** JSON variant of `from-audio`, for clients that cannot send multipart. */
export const FromAudioJsonRequestSchema = FromAudioMetaSchema.extend({
  audioBase64: z.string().min(1),
});
export type FromAudioJsonRequest = z.infer<typeof FromAudioJsonRequestSchema>;

export const RecentSessionSummarySchema = z.object({
  localDate: LocalDateStringSchema,
  title: z.string().min(1).max(200),
  modalities: z.array(z.string().min(1).max(40)).default([]),
  durationSeconds: z.number().nonnegative().nullable().default(null),
  sessionRpe: z.number().min(0).max(10).nullable().default(null),
});

export const PlanDraftRequestSchema = z.object({
  timezone: TimezoneSchema,
  startLocalDate: LocalDateStringSchema.nullable().default(null),
  weeks: z.number().int().min(1).max(AI_LIMITS.maxPlanWeeks).default(1),
  goal: z.string().min(1).max(500),
  preferredUnits: PreferredUnitsEnum.schema.default("metric"),
  constraints: z.array(z.string().min(1).max(300)).max(20).default([]),
  recentSessions: z
    .array(RecentSessionSummarySchema)
    .max(AI_LIMITS.maxPlanContextSessions)
    .default([]),
  notes: z.string().max(2000).nullable().default(null),
});
export type PlanDraftRequest = z.infer<typeof PlanDraftRequestSchema>;

export const PlanExplainRequestSchema = z.object({
  timezone: TimezoneSchema,
  previousSummary: z.string().min(1).max(2000),
  proposedSummary: z.string().min(1).max(2000),
  signals: z.array(z.string().min(1).max(300)).max(20).default([]),
  notes: z.string().max(2000).nullable().default(null),
});
export type PlanExplainRequest = z.infer<typeof PlanExplainRequestSchema>;

/** `POST /v1/workout-drafts/from-text`. */
export const FromTextResponseSchema = WorkoutDraftSchema;
export type FromTextResponse = z.infer<typeof FromTextResponseSchema>;

/**
 * `POST /v1/workout-drafts/from-audio`. Carries the transcript so the athlete
 * can check what was heard; the audio itself is discarded after this response.
 */
export const FromAudioResponseSchema = WorkoutDraftSchema.extend({
  transcript: z.string(),
  transcription: TranscriptionMetadataSchema,
});
export type FromAudioResponse = z.infer<typeof FromAudioResponseSchema>;

/** `POST /v1/plans/draft`. */
export const PlanDraftResponseSchema = PlanDraftSchema;
export type PlanDraftResponse = z.infer<typeof PlanDraftResponseSchema>;

/** `POST /v1/plans/explain` (optional endpoint). */
export const PlanExplainResponseSchema = PlanExplanationSchema;
export type PlanExplainResponse = z.infer<typeof PlanExplainResponseSchema>;

/** `GET /health`. Reports configuration, never secrets. */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("ai-worker"),
  provider: z.string().min(1),
  /** Configured model IDs, so a deploy can be checked without a token. */
  models: z.object({
    stt: z.string().min(1),
    workoutParser: z.string().min(1),
    planner: z.string().min(1),
  }),
  requestId: z.string().min(1),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
