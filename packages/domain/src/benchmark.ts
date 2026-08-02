import { z } from "zod";
import { BenchmarkScoringEnum } from "./enums.js";

/**
 * One split within a benchmark.
 *
 * The Full Murph cell (R24C8) records *cumulative elapsed* times, not
 * durations — `200 push ups (29:15 after the start of pull ups)`. Worse, its
 * reference point shifts: `run 1 - 8:57` is a duration, while `finished at
 * 39:56` is measured from the start of the pull-ups.
 *
 * So `elapsedSeconds` holds the number exactly as written, `referenceFrame`
 * records what it was measured from, and `splitSeconds` — the duration of this
 * segment alone — stays **null** unless the subtraction is unambiguous. The
 * alternative, silently subtracting across mixed reference frames, produces
 * plausible numbers that are wrong.
 */
export const BenchmarkSplitDraftSchema = z.object({
  splitOrder: z.number().int().positive(),
  /** `run 1`, `100 pull ups`, `300 squats`. */
  label: z.string().min(1),
  reps: z.number().int().nullable().default(null),
  distanceKm: z.number().nullable().default(null),
  /** The timing figure as written in the source. */
  elapsedSeconds: z.number().nullable().default(null),
  /** Duration of this segment alone. Null when it cannot be derived safely. */
  splitSeconds: z.number().nullable().default(null),
  /** True when `elapsedSeconds` is cumulative rather than a standalone duration. */
  isCumulative: z.boolean().default(false),
  /** What `elapsedSeconds` is measured from, verbatim from the source. */
  referenceFrame: z
    .enum(["segment", "workout_start", "movement_block_start", "unknown"])
    .default("segment"),
  paceSecondsPerKm: z.number().nullable().default(null),
  heartRateBpm: z.number().int().nullable().default(null),
  cadenceSpm: z.number().nullable().default(null),
  notes: z.string().nullable().default(null),
  originalText: z.string(),
});
export type BenchmarkSplitDraft = z.infer<typeof BenchmarkSplitDraftSchema>;

export const BenchmarkResultDraftSchema = z.object({
  /** Slug of a row in `benchmark_definitions` (`murph`, `half-murph`, `cindy`). */
  definitionSlug: z.string().min(1),
  /** `60% murph`, `75% murph` — a partial attempt of a standard benchmark. */
  variantLabel: z.string().nullable().default(null),
  scoring: BenchmarkScoringEnum.schema.default("time"),
  totalSeconds: z.number().nullable().default(null),
  roundsCompleted: z.number().nullable().default(null),
  score: z.string().nullable().default(null),
  vestKg: z.number().nullable().default(null),
  asPrescribed: z.boolean().nullable().default(null),
  /** `started doing sets of 4 at 30, sets of 3 at 38` — kept verbatim. */
  partitionStrategy: z.string().nullable().default(null),
  splits: z.array(BenchmarkSplitDraftSchema).default([]),
  notes: z.string().nullable().default(null),
  originalText: z.string(),
});
export type BenchmarkResultDraft = z.infer<typeof BenchmarkResultDraftSchema>;
