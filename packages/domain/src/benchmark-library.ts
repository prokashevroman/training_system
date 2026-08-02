import { z } from "zod";
import { BenchmarkScoringEnum } from "./enums.js";

/**
 * Seed rows for `benchmark_definitions`, defined once here and rendered into
 * `supabase/seed.sql` by `pnpm gen:seed-sql`.
 *
 * The definition carries more than the table stores today. `movements` and
 * `aliases` are what the import parser needs to recognise `Murph preperation`,
 * `Half murph (19:48)` and `60% murph` and to expand them into activities; the
 * table only has (slug, name, scoring, description) until a benchmark movement
 * table exists. Partial attempts (`60% murph`, `75% murph`) are NOT separate
 * definitions — they are `murph` with a `variantLabel`, see
 * BenchmarkResultDraftSchema.
 */
export const BenchmarkMovementSchema = z.object({
  order: z.number().int().positive(),
  /** Slug from EXERCISES, so the breakdown resolves to real exercises. */
  exerciseSlug: z.string().min(1),
  reps: z.number().int().positive().nullable().default(null),
  distanceKm: z.number().positive().nullable().default(null),
});
export type BenchmarkMovement = z.infer<typeof BenchmarkMovementSchema>;

export const BenchmarkDefinitionSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  scoring: BenchmarkScoringEnum.schema,
  description: z.string().min(1),
  /** True when the standard prescribes a weight vest (Murph does). */
  supportsVest: z.boolean().default(false),
  /** Source phrasings the importer must recognise, including misspellings. */
  aliases: z.array(z.string().min(1)).default([]),
  movements: z.array(BenchmarkMovementSchema).default([]),
});
export type BenchmarkDefinition = z.infer<typeof BenchmarkDefinitionSchema>;

/** One mile, the Murph run distance, in kilometres. */
const MILE_KM = 1.60934;

export const BENCHMARK_DEFINITIONS: readonly BenchmarkDefinition[] = [
  {
    slug: "murph",
    name: "Murph",
    scoring: "time",
    description:
      "1 mile run, 100 pull-ups, 200 push-ups, 300 air squats, 1 mile run, traditionally wearing a 9 kg vest. The middle movements may be partitioned in any order (the workbook logs Cindy-style rounds and hand-picked set sizes).",
    supportsVest: true,
    aliases: ["murph", "full murph", "murph preparation", "murph preperation"],
    movements: [
      { order: 1, exerciseSlug: "outdoor-run", reps: null, distanceKm: MILE_KM },
      { order: 2, exerciseSlug: "pull-ups", reps: 100, distanceKm: null },
      { order: 3, exerciseSlug: "push-ups", reps: 200, distanceKm: null },
      { order: 4, exerciseSlug: "air-squat", reps: 300, distanceKm: null },
      { order: 5, exerciseSlug: "outdoor-run", reps: null, distanceKm: MILE_KM },
    ],
  },
  {
    slug: "half-murph",
    name: "Half Murph",
    scoring: "time",
    description:
      "Half of Murph: 800 m run, 50 pull-ups, 100 push-ups, 150 air squats, 800 m run, vest optional. The workbook runs ~1.5 km on each end rather than exactly 800 m.",
    supportsVest: true,
    aliases: ["half murph", "half-murph", "1/2 murph"],
    movements: [
      { order: 1, exerciseSlug: "outdoor-run", reps: null, distanceKm: MILE_KM / 2 },
      { order: 2, exerciseSlug: "pull-ups", reps: 50, distanceKm: null },
      { order: 3, exerciseSlug: "push-ups", reps: 100, distanceKm: null },
      { order: 4, exerciseSlug: "air-squat", reps: 150, distanceKm: null },
      { order: 5, exerciseSlug: "outdoor-run", reps: null, distanceKm: MILE_KM / 2 },
    ],
  },
  {
    slug: "cindy",
    name: "Cindy",
    scoring: "rounds_reps",
    description:
      "20 minute AMRAP of 5 pull-ups, 10 push-ups, 15 air squats. The workbook usually logs a fixed number of rounds rather than a 20 minute cap, and often adds 50 jumping jacks per round or a loaded squat, which is a scaled variant.",
    supportsVest: true,
    aliases: ["cindy", "rounds cindy", "cindy bodyweight"],
    movements: [
      { order: 1, exerciseSlug: "pull-ups", reps: 5, distanceKm: null },
      { order: 2, exerciseSlug: "push-ups", reps: 10, distanceKm: null },
      { order: 3, exerciseSlug: "air-squat", reps: 15, distanceKm: null },
    ],
  },
  {
    slug: "row-1000m",
    name: "1000 m row",
    scoring: "time",
    description:
      "1000 m on the rowing machine for time. Secondary figure is the average 500 m split.",
    supportsVest: false,
    aliases: ["1000 m row", "1000m row", "row 1000m", "1k row"],
    movements: [{ order: 1, exerciseSlug: "row-erg", reps: null, distanceKm: 1 }],
  },
  {
    slug: "run-5k",
    name: "5 k run",
    scoring: "time",
    description: "5 km run for time, treadmill or outdoor.",
    supportsVest: false,
    aliases: ["5 k", "5k", "5 km run", "5km run"],
    movements: [{ order: 1, exerciseSlug: "outdoor-run", reps: null, distanceKm: 5 }],
  },
  {
    slug: "run-10k",
    name: "10 k run",
    scoring: "time",
    description: "10 km run for time, treadmill or outdoor.",
    supportsVest: false,
    aliases: ["10 k", "10k", "10 km run", "10km run"],
    movements: [{ order: 1, exerciseSlug: "outdoor-run", reps: null, distanceKm: 10 }],
  },
  {
    slug: "half-marathon",
    name: "Half marathon",
    scoring: "time",
    description: "21.0975 km run for time.",
    supportsVest: false,
    aliases: ["half marathon", "half-marathon", "21k", "21.1 km"],
    movements: [{ order: 1, exerciseSlug: "outdoor-run", reps: null, distanceKm: 21.0975 }],
  },
  {
    slug: "marathon",
    name: "Marathon",
    scoring: "time",
    description: "42.195 km run for time.",
    supportsVest: false,
    aliases: ["marathon", "42.2 km"],
    movements: [{ order: 1, exerciseSlug: "outdoor-run", reps: null, distanceKm: 42.195 }],
  },
];

const benchmarkIndex = new Map<string, string>();
for (const def of BENCHMARK_DEFINITIONS) {
  benchmarkIndex.set(def.slug, def.slug);
  for (const alias of def.aliases) benchmarkIndex.set(alias.toLowerCase().trim(), def.slug);
}

/** Normalized benchmark alias -> definition slug. */
export const BENCHMARK_ALIAS_INDEX: ReadonlyMap<string, string> = benchmarkIndex;

/** Exact (lowercased) benchmark name lookup. */
export function resolveBenchmarkSlug(text: string): string | null {
  return benchmarkIndex.get(text.toLowerCase().replace(/\s+/g, " ").trim()) ?? null;
}
