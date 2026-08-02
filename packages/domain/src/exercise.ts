import { z } from "zod";
import { MovementPatternEnum } from "./enums.js";

/**
 * How the parser refers to an exercise before the database has been consulted.
 *
 * The parser never invents a canonical exercise. It records the source text and
 * — when an alias matched — the slug it resolved to, plus the apparatus the
 * source mentioned. `5 pull ups on climbers bar` and `5 pull ups strict` both
 * resolve to a pull-up variant; the apparatus is context, not a new exercise.
 */
export const ExerciseRefSchema = z.object({
  /** Verbatim source text, always retained so a bad alias can be re-derived. */
  rawText: z.string().min(1),
  /** Canonical exercise slug, or null when no alias matched. */
  slug: z.string().nullable(),
  /** `climbers bar`, `pull up station`, `hex bar`, `rogue` — free-form context. */
  apparatus: z.string().nullable().default(null),
  /** 0..1. Exact alias hits are 1; normalized/fuzzy hits score lower. */
  confidence: z.number().min(0).max(1).default(0),
});
export type ExerciseRef = z.infer<typeof ExerciseRefSchema>;

/** A row of the canonical exercise library, used by the seed generator. */
export const ExerciseSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  movementPattern: MovementPatternEnum.schema,
  primaryMuscles: z.array(z.string()).default([]),
  secondaryMuscles: z.array(z.string()).default([]),
  equipment: z.array(z.string()).default([]),
  isUnilateral: z.boolean().default(false),
  isBodyweight: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type Exercise = z.infer<typeof ExerciseSchema>;

export const ExerciseAliasSchema = z.object({
  alias: z.string().min(1),
  exerciseSlug: z.string(),
  /** `en`, `ru`, `es`, or `abbr` for language-neutral shorthand like `DL`. */
  language: z.enum(["en", "ru", "es", "abbr"]).default("en"),
  /** True for known misspellings (`Deadlifw`), which the UI should not suggest. */
  isMisspelling: z.boolean().default(false),
});
export type ExerciseAlias = z.infer<typeof ExerciseAliasSchema>;
