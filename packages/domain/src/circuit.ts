import { z } from "zod";
import { CircuitFormatEnum, LoadScopeEnum, LoadUnitEnum } from "./enums.js";
import { ExerciseRefSchema } from "./exercise.js";

/** One prescribed movement inside a circuit, in performed order. */
export const CircuitMovementDraftSchema = z.object({
  movementOrder: z.number().int().positive(),
  exercise: ExerciseRefSchema,
  targetReps: z.number().int().nullable().default(null),
  targetCalories: z.number().nullable().default(null),
  targetDistanceKm: z.number().nullable().default(null),
  targetSeconds: z.number().nullable().default(null),
  loadValue: z.number().nullable().default(null),
  loadUnit: LoadUnitEnum.schema.default("none"),
  loadKg: z.number().nullable().default(null),
  loadScope: LoadScopeEnum.schema.default("unknown"),
  notes: z.string().nullable().default(null),
  originalText: z.string(),
});
export type CircuitMovementDraft = z.infer<typeof CircuitMovementDraftSchema>;

/**
 * A conditioning circuit: `5 rounds: 50 jumping jacks / 10 push ups / ...`,
 * `12 rounds cindy (19:31)`, `150 push-ups (15 EMOM)`.
 *
 * `roundsPrescribed` is what the source said to do; `roundsCompleted` is what
 * was done. For the many `N rounds:` cells these coincide, but keeping them
 * apart means a cut-short workout stays honest.
 */
export const CircuitDraftSchema = z.object({
  format: CircuitFormatEnum.schema.default("rounds"),
  name: z.string().nullable().default(null),
  roundsPrescribed: z.number().int().nullable().default(null),
  roundsCompleted: z.number().nullable().default(null),
  partialRoundReps: z.number().int().nullable().default(null),
  timeCapSeconds: z.number().nullable().default(null),
  completionSeconds: z.number().nullable().default(null),
  /** Free-form score for formats where time and rounds do not apply. */
  score: z.string().nullable().default(null),
  /** `work` / `rest` seconds for interval circuits (`40 seconds work, 20 seconds rest`). */
  workSeconds: z.number().nullable().default(null),
  restSeconds: z.number().nullable().default(null),
  asPrescribed: z.boolean().nullable().default(null),
  movements: z.array(CircuitMovementDraftSchema).default([]),
  details: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().nullable().default(null),
  originalText: z.string(),
});
export type CircuitDraft = z.infer<typeof CircuitDraftSchema>;
