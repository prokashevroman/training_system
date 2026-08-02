import { ParseWarningSchema, SessionDraftSchema } from "@training/domain";
import { z } from "zod";
import { ModelMetadataSchema } from "./metadata.js";

/**
 * A source fragment the parser did not turn into structured data.
 *
 * The domain parser calls these `unconsumedLines` because its unit is a
 * workbook cell. Speech has no lines, so the AI contract keeps the fragment
 * plus a reason, and the review UI shows it verbatim next to the draft. Losing
 * spoken text silently is the failure mode this field exists to prevent.
 */
export const UnconsumedFragmentSchema = z.object({
  text: z.string().min(1),
  /** Why it was dropped, in the parser's own words. */
  reason: z.string().min(1),
});
export type UnconsumedFragment = z.infer<typeof UnconsumedFragmentSchema>;

/**
 * The output of {@link WorkoutParserProvider.parseWorkout}: the whole payload of
 * `POST /v1/workout-drafts/from-text` and, with a transcript attached, of
 * `from-audio`.
 *
 * This is a *draft*. The Worker never writes it anywhere; the browser saves an
 * approved draft through RLS-protected Supabase APIs.
 */
export const WorkoutDraftSchema = z.object({
  /**
   * The date the sessions were resolved to, in the athlete's timezone. Spoken
   * input says "yesterday"; the client shows this so a wrong day is visible
   * before saving.
   */
  resolvedLocalDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "resolvedLocalDate must be YYYY-MM-DD"),
  /** One entry per independent session found in the input. May be empty. */
  sessions: z.array(SessionDraftSchema).default([]),
  warnings: z.array(ParseWarningSchema).default([]),
  unconsumedFragments: z.array(UnconsumedFragmentSchema).default([]),
  metadata: ModelMetadataSchema,
});
export type WorkoutDraft = z.infer<typeof WorkoutDraftSchema>;

/**
 * The JSON contract handed to the model. Kept narrower than
 * {@link WorkoutDraftSchema}: metadata is filled in by the Worker, never by the
 * model, and `resolvedLocalDate` is the model's only date responsibility.
 */
export const ModelWorkoutDraftSchema = WorkoutDraftSchema.omit({ metadata: true });
export type ModelWorkoutDraft = z.infer<typeof ModelWorkoutDraftSchema>;
