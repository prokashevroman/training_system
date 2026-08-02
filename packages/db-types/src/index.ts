/**
 * Generated Supabase row types.
 *
 * `database.types.ts` is GENERATED — regenerate with:
 *
 *   pnpm --filter @training/db-types gen      (needs `supabase start` running)
 *
 * This is deliberately a separate package from `@training/domain`. Domain
 * holds the hand-written Zod schemas that describe what the *app* means;
 * this holds the mechanical mirror of what the *database* currently is.
 * Keeping them apart means a schema change shows up as a diff here rather
 * than quietly editing the source of truth.
 */
export type { Database, Json } from "./database.types.js";

import type { Database } from "./database.types.js";

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

export type WorkoutSession = Tables<"workout_sessions">;
export type Activity = Tables<"activities">;
export type StrengthSet = Tables<"strength_sets">;
export type CardioInterval = Tables<"cardio_intervals">;
export type CircuitResult = Tables<"circuit_results">;
export type CircuitMovement = Tables<"circuit_movements">;
export type BenchmarkResult = Tables<"benchmark_results">;
export type BenchmarkSplit = Tables<"benchmark_splits">;
export type Exercise = Tables<"exercises">;
export type Profile = Tables<"profiles">;
export type ImportEntry = Tables<"import_entries">;
