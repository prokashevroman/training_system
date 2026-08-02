import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BENCHMARK_DEFINITIONS } from "./benchmark-library.js";
import { BenchmarkScoringEnum, MovementPatternEnum } from "./enums.js";
import { ExerciseAliasSchema, ExerciseSchema } from "./exercise.js";
import {
  EXERCISE_ALIASES,
  EXERCISES,
  normalizeAliasKey,
  resolveExerciseSlug,
} from "./exercise-library.js";
import { SEED_SQL_PATH, renderSeedSql } from "./seed-sql.js";

describe("exercise library", () => {
  it("gives every exercise a unique slug", () => {
    const slugs = EXERCISES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses url-safe lowercase slugs", () => {
    for (const e of EXERCISES) expect(e.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("parses every exercise against ExerciseSchema", () => {
    for (const e of EXERCISES) {
      const parsed = ExerciseSchema.safeParse(e);
      expect(parsed.success, `${e.slug}: ${parsed.error?.message ?? ""}`).toBe(true);
    }
  });

  it("uses only known movement patterns", () => {
    for (const e of EXERCISES) {
      expect(
        MovementPatternEnum.schema.safeParse(e.movementPattern).success,
        `${e.slug} has pattern ${e.movementPattern}`,
      ).toBe(true);
    }
  });
});

describe("exercise aliases", () => {
  it("parses every alias against ExerciseAliasSchema", () => {
    for (const a of EXERCISE_ALIASES) {
      const parsed = ExerciseAliasSchema.safeParse(a);
      expect(parsed.success, `${a.alias}: ${parsed.error?.message ?? ""}`).toBe(true);
    }
  });

  /**
   * A dangling alias is a silently dropped seed row: the generated insert joins
   * exercise_aliases to exercises by slug, so an alias pointing at a slug that
   * does not exist would never reach the database.
   */
  it("has no dangling aliases", () => {
    const slugs = new Set(EXERCISES.map((e) => e.slug));
    for (const a of EXERCISE_ALIASES) {
      expect(slugs.has(a.exerciseSlug), `${a.alias} -> unknown slug ${a.exerciseSlug}`).toBe(true);
    }
  });

  /**
   * `exercise_aliases_alias_lower_idx` is unique, so two exercises claiming the
   * same alias would make the seed non-deterministic — and alias resolution
   * ambiguous.
   */
  it("never lets two exercises claim the same alias", () => {
    const owner = new Map<string, string>();
    for (const a of EXERCISE_ALIASES) {
      const key = normalizeAliasKey(a.alias);
      const previous = owner.get(key);
      expect(previous ?? a.exerciseSlug, `alias "${a.alias}" is claimed twice`).toBe(
        a.exerciseSlug,
      );
      owner.set(key, a.exerciseSlug);
    }
  });

  it("resolves the source spellings the workbook actually uses", () => {
    expect(resolveExerciseSlug("Deadlifw")).toBe("deadlift");
    expect(resolveExerciseSlug("lads")).toBe("lat-stretch");
    expect(resolveExerciseSlug("MU")).toBe("muscle-up");
    expect(resolveExerciseSlug("paralets")).toBe("parallette-push-ups");
    expect(resolveExerciseSlug("Treadmil")).toBe("treadmill-run");
    expect(resolveExerciseSlug("RDL")).toBe("romanian-deadlift");
  });
});

describe("benchmark definitions", () => {
  it("gives every benchmark a unique slug", () => {
    const slugs = BENCHMARK_DEFINITIONS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses only known scoring modes", () => {
    for (const d of BENCHMARK_DEFINITIONS) {
      expect(
        BenchmarkScoringEnum.schema.safeParse(d.scoring).success,
        `${d.slug} has scoring ${d.scoring}`,
      ).toBe(true);
    }
  });
});

describe("seed SQL generation", () => {
  /**
   * The drift guard. If this fails, run `pnpm gen:seed-sql` — an exercise,
   * alias or benchmark changed in TypeScript without regenerating the seed.
   */
  it("matches the committed supabase/seed.sql byte for byte", () => {
    const committed = readFileSync(SEED_SQL_PATH, "utf8");
    expect(committed).toBe(renderSeedSql());
  });
});
