import { fileURLToPath } from "node:url";
import { BENCHMARK_DEFINITIONS, type BenchmarkDefinition } from "./benchmark-library.js";
import type { Modality } from "./enums.js";
import { EXERCISE_ALIASES, EXERCISES } from "./exercise-library.js";

/** Absolute path to the generated seed file, resolved from this file. */
export const SEED_SQL_PATH = fileURLToPath(new URL("../../../supabase/seed.sql", import.meta.url));

/** A single-quoted SQL string literal with embedded quotes doubled. */
function q(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** `array['a', 'b']::text[]` — explicitly typed so empty arrays still work. */
function textArray(values: readonly string[]): string {
  if (values.length === 0) return "array[]::text[]";
  return `array[${values.map(q).join(", ")}]::text[]`;
}

/** A jsonb literal. JSON is serialized first, then escaped as a SQL string. */
function jsonb(value: unknown): string {
  return `${q(JSON.stringify(value))}::jsonb`;
}

/**
 * `benchmark_definitions.modality` has no counterpart in the TypeScript
 * definition, so it is derived from the prescribed movements: a benchmark that
 * is nothing but running is `running`, nothing but rowing is `rowing`, and
 * anything mixed (Murph, Cindy) keeps the column default.
 */
function benchmarkModality(def: BenchmarkDefinition): Modality {
  const slugs = new Set(def.movements.map((m) => m.exerciseSlug));
  if (slugs.size === 0) return "hybrid_conditioning";
  const every = (test: (slug: string) => boolean): boolean => [...slugs].every(test);
  if (every((s) => s.endsWith("-run"))) return "running";
  if (every((s) => s.startsWith("row-"))) return "rowing";
  return "hybrid_conditioning";
}

function renderExercises(): string {
  const rows = EXERCISES.map(
    (e) =>
      `    (${q(e.slug)}, ${q(e.name)}, ${q(e.movementPattern)}::public.movement_pattern, ` +
      `${textArray(e.primaryMuscles)}, ${textArray(e.secondaryMuscles)}, ` +
      `${textArray(e.equipment)}, ${e.isUnilateral}, ${e.isBodyweight}, ${e.isActive})`,
  ).join(",\n");

  return `-- ${EXERCISES.length} canonical exercises.
insert into public.exercises (
    slug,
    name,
    movement_pattern,
    primary_muscles,
    secondary_muscles,
    equipment,
    is_unilateral,
    is_bodyweight,
    is_active
)
values
${rows}
on conflict do nothing;`;
}

function renderAliases(): string {
  const rows = EXERCISE_ALIASES.map(
    (a) => `    (${q(a.exerciseSlug)}, ${q(a.alias)}, ${q(a.language)}, ${a.isMisspelling})`,
  ).join(",\n");

  // exercise_aliases references exercises by id, so the slug is resolved with a
  // join instead of a hard-coded uuid. Unknown slugs would be dropped silently;
  // exercise-library.test.ts asserts there are none.
  return `-- ${EXERCISE_ALIASES.length} aliases, joined to their exercise by slug.
insert into public.exercise_aliases (exercise_id, alias, language, is_misspelling)
select e.id, v.alias, v.language, v.is_misspelling
from (
    values
${rows}
) as v (slug, alias, language, is_misspelling)
join public.exercises e on e.slug = v.slug
on conflict do nothing;`;
}

function renderBenchmarkDefinitions(): string {
  const rows = BENCHMARK_DEFINITIONS.map((d) => {
    const prescription = {
      supportsVest: d.supportsVest,
      aliases: d.aliases,
      movements: d.movements,
    };
    return (
      `    (${q(d.slug)}, ${q(d.name)}, ${q(d.scoring)}::public.benchmark_scoring, ` +
      `${q(benchmarkModality(d))}::public.activity_modality, ${q(d.description)}, ` +
      `${jsonb(prescription)}, true, true)`
    );
  }).join(",\n");

  return `-- ${BENCHMARK_DEFINITIONS.length} standard benchmarks. \`prescription\` carries the
-- movement breakdown, the recognised source phrasings and whether the standard
-- prescribes a vest; performed work lives in benchmark_results.
insert into public.benchmark_definitions (
    slug,
    name,
    scoring,
    modality,
    description,
    prescription,
    is_standard,
    is_active
)
values
${rows}
on conflict do nothing;`;
}

/**
 * The complete text of `supabase/seed.sql`. Kept next to the libraries so the
 * generator script and the drift test render byte-identical output.
 */
export function renderSeedSql(): string {
  return `-- seed.sql
--
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: pnpm gen:seed-sql
--
-- Sources of truth:
--   packages/domain/src/exercise-library.ts  (exercises, exercise_aliases)
--   packages/domain/src/benchmark-library.ts (benchmark_definitions)
-- packages/domain/src/exercise-library.test.ts fails if this file drifts.
--
-- Depends on migrations:
--   0001_extensions_and_enums.sql  (public.movement_pattern, public.activity_modality,
--                                   public.benchmark_scoring)
--   0003_exercise_library.sql      (public.exercises, public.exercise_aliases)
--   0006_benchmarks.sql            (public.benchmark_definitions)
--
-- Global reference data only: no user_id anywhere, every statement is
-- idempotent (\`on conflict do nothing\`), so re-running the seed is safe.

${renderExercises()}

${renderAliases()}

${renderBenchmarkDefinitions()}
`;
}
