import { z } from "zod";
import { BodySideEnum, LoadScopeEnum, LoadUnitEnum, SetTypeEnum } from "./enums.js";
import { ExerciseRefSchema } from "./exercise.js";

/**
 * One performed set.
 *
 * `loadValue` + `loadUnit` + `loadScope` are the source's own claim; `loadKg`
 * is the derived canonical figure and is null whenever conversion would be a
 * guess. In particular `loadScope: "machine_setting"` always has `loadKg: null`
 * — a lat-pulldown `value = 6` is a pin position, not six kilograms.
 */
export const StrengthSetDraftSchema = z
  .object({
    /** 1-based position within the activity, across all exercises, in source order. */
    setIndex: z.number().int().positive(),
    exercise: ExerciseRefSchema,
    setType: SetTypeEnum.schema.default("working"),
    reps: z.number().int().nonnegative().nullable().default(null),
    loadValue: z.number().nullable().default(null),
    loadUnit: LoadUnitEnum.schema.default("none"),
    loadKg: z.number().nullable().default(null),
    loadScope: LoadScopeEnum.schema.default("unknown"),
    side: BodySideEnum.schema.nullable().default(null),
    rir: z.number().int().nullable().default(null),
    rpe: z.number().nullable().default(null),
    tempo: z.string().nullable().default(null),
    restSeconds: z.number().int().nullable().default(null),
    /** Hold duration for isometrics (`Plank: 4x1 min`, `1 minute dead hang`). */
    holdSeconds: z.number().nullable().default(null),
    completed: z.boolean().default(true),
    notes: z.string().nullable().default(null),
    /** The exact source substring this set came from. */
    originalText: z.string(),
  })
  .superRefine((set, ctx) => {
    if (set.loadScope === "machine_setting" && set.loadKg !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["loadKg"],
        message: "A machine setting must not be normalized to kilograms.",
      });
    }
    if (set.loadUnit === "none" && set.loadKg !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["loadKg"],
        message: "loadKg cannot be derived from a load with no stated unit.",
      });
    }
  });
export type StrengthSetDraft = z.infer<typeof StrengthSetDraftSchema>;
