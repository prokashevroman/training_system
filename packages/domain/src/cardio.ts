import { z } from "zod";
import { IntervalTypeEnum } from "./enums.js";

/**
 * One interval or split.
 *
 * Speed is stored as a value plus a *nullable* unit. The corpus writes
 * `speed = 7.0` on a treadmill with no unit at all (R5C6); that is recorded
 * faithfully with `speedUnit: null` and an `AMBIGUOUS_SPEED_UNIT` warning
 * rather than being assumed to be km/h.
 */
export const CardioIntervalDraftSchema = z.object({
  intervalIndex: z.number().int().positive(),
  intervalType: IntervalTypeEnum.schema.default("work"),
  durationSeconds: z.number().nullable().default(null),
  restSeconds: z.number().nullable().default(null),
  distanceKm: z.number().nullable().default(null),
  /** Seconds per kilometre. `6:49 per km` → 409. */
  paceSecondsPerKm: z.number().nullable().default(null),
  /** Rowing/ski convention: seconds per 500 m. `2:14.9/500m` → 134.9. */
  splitSecondsPer500m: z.number().nullable().default(null),
  speedValue: z.number().nullable().default(null),
  /** Null when the source stated a bare number. Never assumed. */
  speedUnit: z.enum(["kmh", "mph"]).nullable().default(null),
  heartRateBpm: z.number().int().nullable().default(null),
  powerWatts: z.number().nullable().default(null),
  cadenceSpm: z.number().nullable().default(null),
  calories: z.number().nullable().default(null),
  notes: z.string().nullable().default(null),
  originalText: z.string(),
});
export type CardioIntervalDraft = z.infer<typeof CardioIntervalDraftSchema>;
