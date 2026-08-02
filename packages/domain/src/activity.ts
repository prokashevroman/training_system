import { z } from "zod";
import { BenchmarkResultDraftSchema } from "./benchmark.js";
import { CardioIntervalDraftSchema } from "./cardio.js";
import { CircuitDraftSchema } from "./circuit.js";
import { IntensityEnum, ModalityEnum, ObjectiveEnum } from "./enums.js";
import { StrengthSetDraftSchema } from "./strength.js";

/**
 * One activity inside a session.
 *
 * A session is "one logically coherent workout"; an activity is one modality
 * within it. `Swimming training` + `4 km easy run` in the same block (R20C6)
 * is one session with two activities — the modality of each is preserved, so
 * splitting them into separate sessions later is a data edit, not a re-parse.
 *
 * Every metric is nullable. Missing data stays missing.
 */
export const ActivityDraftSchema = z.object({
  /** 1-based order within the session. */
  sequence: z.number().int().positive(),
  modality: ModalityEnum.schema,
  /** Free-form refinement: `air_bike`, `treadmill`, `outdoor`, `hex_bar`. */
  subtype: z.string().nullable().default(null),
  objective: ObjectiveEnum.schema.default("unknown"),
  intensity: IntensityEnum.schema.default("unknown"),

  durationSeconds: z.number().nullable().default(null),
  distanceKm: z.number().nullable().default(null),
  calories: z.number().nullable().default(null),
  avgHeartRateBpm: z.number().int().nullable().default(null),
  maxHeartRateBpm: z.number().int().nullable().default(null),
  cadenceSpm: z.number().nullable().default(null),
  elevationGainM: z.number().nullable().default(null),
  avgPowerWatts: z.number().nullable().default(null),
  /** Load carried during the activity (`vest 9 kg`), not a lifted load. */
  externalLoadKg: z.number().nullable().default(null),

  /** Modality-specific facts with no column of their own (`floors`, `steps`). */
  details: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().nullable().default(null),
  /** Exact source lines this activity was built from. Drives reconciliation. */
  originalText: z.string(),

  strengthSets: z.array(StrengthSetDraftSchema).default([]),
  cardioIntervals: z.array(CardioIntervalDraftSchema).default([]),
  circuit: CircuitDraftSchema.nullable().default(null),
  benchmark: BenchmarkResultDraftSchema.nullable().default(null),
});
export type ActivityDraft = z.infer<typeof ActivityDraftSchema>;
