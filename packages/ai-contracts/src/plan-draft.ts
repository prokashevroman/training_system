import { IntensityEnum, ModalityEnum, ObjectiveEnum, ParseWarningSchema } from "@training/domain";
import { z } from "zod";
import { LocalDateStringSchema } from "./primitives.js";
import { ModelMetadataSchema } from "./metadata.js";
import { SafetyFlagSchema } from "./safety.js";

/** One prescribed piece of work. Targets only — never performed data. */
export const PlannedActivitySchema = z.object({
  sequence: z.number().int().positive(),
  modality: ModalityEnum.schema,
  objective: ObjectiveEnum.schema.default("unknown"),
  intensity: IntensityEnum.schema.default("unknown"),
  /** What to do, in the athlete's language. */
  prescription: z.string().min(1),
  targetDurationSeconds: z.number().positive().nullable().default(null),
  targetDistanceKm: z.number().positive().nullable().default(null),
  notes: z.string().nullable().default(null),
});
export type PlannedActivity = z.infer<typeof PlannedActivitySchema>;

export const PlannedSessionSchema = z.object({
  localDate: LocalDateStringSchema,
  title: z.string().min(1),
  /** Why this session exists in the block; shown next to the prescription. */
  rationale: z.string().min(1),
  activities: z.array(PlannedActivitySchema).min(1),
  /** Coarse planned load, null when the planner will not commit to a number. */
  estimatedLoad: z.number().nonnegative().nullable().default(null),
});
export type PlannedSession = z.infer<typeof PlannedSessionSchema>;

/**
 * Output of {@link TrainingPlannerProvider.generatePlan} and the body of
 * `POST /v1/plans/draft`. A proposal: nothing is scheduled until the athlete
 * approves it in the browser.
 */
export const PlanDraftSchema = z.object({
  startLocalDate: LocalDateStringSchema,
  endLocalDate: LocalDateStringSchema,
  /** Restatement of the goal the plan was built for, for confirmation. */
  goal: z.string().min(1),
  sessions: z.array(PlannedSessionSchema).default([]),
  warnings: z.array(ParseWarningSchema).default([]),
  /** Deterministically detected; a non-empty list forbids hard sessions. */
  safetyFlags: z.array(SafetyFlagSchema).default([]),
  metadata: ModelMetadataSchema,
});
export type PlanDraft = z.infer<typeof PlanDraftSchema>;

/** The model's share of a plan: metadata and safety flags are server-owned. */
export const ModelPlanDraftSchema = PlanDraftSchema.omit({
  metadata: true,
  safetyFlags: true,
});
export type ModelPlanDraft = z.infer<typeof ModelPlanDraftSchema>;

/** Output of {@link TrainingPlannerProvider.explainAdjustment}. */
export const PlanExplanationSchema = z.object({
  summary: z.string().min(1),
  /** Ordered, each a single reason. Empty means "no adjustment was needed". */
  reasons: z.array(z.string().min(1)).default([]),
  safetyFlags: z.array(SafetyFlagSchema).default([]),
  metadata: ModelMetadataSchema,
});
export type PlanExplanation = z.infer<typeof PlanExplanationSchema>;

export const ModelPlanExplanationSchema = PlanExplanationSchema.omit({
  metadata: true,
  safetyFlags: true,
});
export type ModelPlanExplanation = z.infer<typeof ModelPlanExplanationSchema>;
