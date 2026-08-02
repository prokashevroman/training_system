import { z } from "zod";

/**
 * Closed vocabularies live here once. Each is exported as a Zod enum for the
 * app and registered in {@link SQL_ENUMS} so `pnpm gen:sql-enums` can emit the
 * matching `CREATE TYPE ... AS ENUM` DDL. Database and application therefore
 * cannot drift: adding a value here and forgetting the migration is caught by
 * `enums.test.ts`, which diffs this registry against the committed SQL.
 *
 * Open vocabularies (exercises, aliases, tags, benchmark definitions, event
 * templates) are reference *tables*, not enums, because the user extends them.
 */

/** What the SQL generator needs. Deliberately free of the Zod schema type. */
export interface SqlEnumDef {
  /** Postgres type name, created in migration 0001. */
  readonly sqlName: string;
  /** Rendered as a SQL comment above the CREATE TYPE. */
  readonly doc: string;
  readonly values: readonly string[];
}

const registry: SqlEnumDef[] = [];

/**
 * The return type is inferred, not annotated. Annotating it would widen each
 * enum's value union back to `string`, which silently disables exhaustiveness
 * checking everywhere a `switch` handles a unit or a load scope.
 */
function defineEnum<const T extends readonly [string, ...string[]]>(
  sqlName: string,
  doc: string,
  values: T,
) {
  registry.push({ sqlName, doc, values });
  return {
    sqlName,
    doc,
    values,
    schema: z.enum(values as unknown as [T[number], ...T[number][]]),
  } as const;
}

// --- Activity classification ------------------------------------------------

export const ModalityEnum = defineEnum(
  "activity_modality",
  "What kind of training an activity is. Drives filtering and analytics.",
  [
    "strength",
    "running",
    "cycling",
    "rowing",
    "ski_erg",
    "swimming",
    "hybrid_conditioning",
    "mobility_recovery",
    "walking_hiking",
    "sport_outdoor",
    "dance",
    "other",
  ] as const,
);
export type Modality = z.infer<typeof ModalityEnum.schema>;

export const ObjectiveEnum = defineEnum(
  "training_objective",
  "Why the activity was done. Separate from modality: an easy run and a VO2max run share a modality but not an objective.",
  [
    "max_strength",
    "hypertrophy",
    "power",
    "skill",
    "aerobic_base",
    "tempo_threshold",
    "vo2max",
    "race_specific",
    "hybrid_conditioning",
    "recovery",
    "commute",
    "unknown",
  ] as const,
);
export type Objective = z.infer<typeof ObjectiveEnum.schema>;

export const IntensityEnum = defineEnum(
  "intensity_level",
  "Coarse intensity classification. Deliberately coarse: the corpus rarely supports more.",
  ["easy", "moderate", "hard", "max", "unknown"] as const,
);
export type Intensity = z.infer<typeof IntensityEnum.schema>;

// --- Exercise library -------------------------------------------------------

export const MovementPatternEnum = defineEnum(
  "movement_pattern",
  "Biomechanical pattern, used to balance weekly hard sets across patterns.",
  [
    "squat",
    "hinge",
    "horizontal_push",
    "horizontal_pull",
    "vertical_push",
    "vertical_pull",
    "unilateral_leg",
    "carry",
    "core",
    "locomotion",
    "power",
    "mobility",
  ] as const,
);
export type MovementPattern = z.infer<typeof MovementPatternEnum.schema>;

// --- Strength ---------------------------------------------------------------

export const SetTypeEnum = defineEnum("strength_set_type", "Role of a set within an activity.", [
  "warmup",
  "working",
  "drop",
  "amrap",
  "test",
] as const);
export type SetType = z.infer<typeof SetTypeEnum.schema>;

/**
 * The distinction this project exists to preserve. `8x20 kg in each hand` is
 * not 20 kg, and a lat-pulldown `value = 6` is not 6 kg. Collapsing these into
 * a single "kg" column silently corrupts every downstream strength trend.
 */
export const LoadScopeEnum = defineEnum(
  "load_scope",
  "What the recorded load number actually measures. Never collapse these into kilograms.",
  [
    "total",
    "per_hand",
    "per_side",
    "added_bodyweight",
    "bodyweight",
    "machine_setting",
    "unknown",
  ] as const,
);
export type LoadScope = z.infer<typeof LoadScopeEnum.schema>;

export const BodySideEnum = defineEnum(
  "body_side",
  "Which side a unilateral set was performed on.",
  ["left", "right", "both", "each"] as const,
);
export type BodySide = z.infer<typeof BodySideEnum.schema>;

// --- Cardio -----------------------------------------------------------------

export const IntervalTypeEnum = defineEnum(
  "cardio_interval_type",
  "Role of an interval within a cardio activity.",
  ["warmup", "work", "rest", "cooldown", "split", "steady"] as const,
);
export type IntervalType = z.infer<typeof IntervalTypeEnum.schema>;

// --- Circuits ---------------------------------------------------------------

export const CircuitFormatEnum = defineEnum(
  "circuit_format",
  "Scoring format of a conditioning circuit.",
  ["amrap", "emom", "for_time", "rounds", "interval", "chipper", "custom"] as const,
);
export type CircuitFormat = z.infer<typeof CircuitFormatEnum.schema>;

// --- Sessions ---------------------------------------------------------------

export const SessionStatusEnum = defineEnum(
  "session_status",
  "Lifecycle of a completed-training record.",
  ["draft", "completed", "discarded"] as const,
);
export type SessionStatus = z.infer<typeof SessionStatusEnum.schema>;

export const SessionSourceEnum = defineEnum(
  "session_source",
  "How the record entered the system. Import provenance must stay visible forever.",
  ["manual", "voice", "excel_import", "integration"] as const,
);
export type SessionSource = z.infer<typeof SessionSourceEnum.schema>;

// --- Import staging ---------------------------------------------------------

export const ReviewStatusEnum = defineEnum(
  "import_review_status",
  "Review state of one staged source cell.",
  ["pending", "parsed", "review_required", "approved", "applied", "rejected", "failed"] as const,
);
export type ReviewStatus = z.infer<typeof ReviewStatusEnum.schema>;

export const ImportBatchStatusEnum = defineEnum(
  "import_batch_status",
  "Lifecycle of one importer run.",
  ["running", "completed", "failed"] as const,
);
export type ImportBatchStatus = z.infer<typeof ImportBatchStatusEnum.schema>;

export const WarningSeverityEnum = defineEnum(
  "warning_severity",
  "How much a parse warning should block automatic approval.",
  ["info", "warning", "error"] as const,
);
export type WarningSeverity = z.infer<typeof WarningSeverityEnum.schema>;

// --- Benchmarks -------------------------------------------------------------

export const BenchmarkScoringEnum = defineEnum(
  "benchmark_scoring",
  "How a benchmark result is scored.",
  ["time", "rounds_reps", "distance", "load", "custom"] as const,
);
export type BenchmarkScoring = z.infer<typeof BenchmarkScoringEnum.schema>;

// --- Units ------------------------------------------------------------------

export const LoadUnitEnum = defineEnum(
  "load_unit",
  "Original unit a load was written in. `none` means the source stated a bare number.",
  ["kg", "lb", "none"] as const,
);
export type LoadUnit = z.infer<typeof LoadUnitEnum.schema>;

export const DistanceUnitEnum = defineEnum(
  "distance_unit",
  "Original unit a distance was written in.",
  ["km", "m", "mi", "floors", "steps"] as const,
);
export type DistanceUnit = z.infer<typeof DistanceUnitEnum.schema>;

export const PreferredUnitsEnum = defineEnum("preferred_units", "User display preference.", [
  "metric",
  "imperial",
] as const);
export type PreferredUnits = z.infer<typeof PreferredUnitsEnum.schema>;

// --- SQL generation ---------------------------------------------------------

/** Every enum, in declaration order, for DDL generation. */
export const SQL_ENUMS: readonly SqlEnumDef[] = registry;

/** Renders the full `CREATE TYPE` block used by migration 0001. */
export function renderEnumDdl(): string {
  const body = SQL_ENUMS.map((e) => {
    const values = e.values.map((v) => `    '${v}'`).join(",\n");
    return `-- ${e.doc}\ncreate type public.${e.sqlName} as enum (\n${values}\n);`;
  }).join("\n\n");

  return `${body}\n`;
}
