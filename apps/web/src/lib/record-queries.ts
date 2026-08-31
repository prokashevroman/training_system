import type { ImportEntry, Json, TablesInsert } from "@training/db-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
/**
 * The domain modules are imported by path rather than through the
 * `@training/domain` barrel to keep this module's graph to the four leaves it
 * actually needs. Every schema and the one conversion function are shared;
 * nothing is reimplemented here.
 *
 * The barrel itself is browser-safe — `sql-enums.ts` and `seed-sql.ts` call
 * `fileURLToPath` at module scope and are deliberately excluded from it, which
 * `domain/src/index.test.ts` asserts. (An earlier version of this comment said
 * the opposite; the barrel was fixed, and `lib/paste-queries.ts` now reaches it
 * transitively through the parser in both dev and the production build.)
 */
import {
  IntensityEnum,
  LoadScopeEnum,
  LoadUnitEnum,
  ModalityEnum,
  ObjectiveEnum,
  ReviewStatusEnum,
  SetTypeEnum,
  type LoadScope,
  type LoadUnit,
  type ReviewStatus,
} from "../../../../packages/domain/src/enums.js";
import {
  LocalDateSchema,
  SessionDraftSchema,
  type SessionDraft,
} from "../../../../packages/domain/src/session.js";
import { parseDecimal, toKilograms } from "../../../../packages/domain/src/units.js";
import { ParseWarningSchema, type ParseWarning } from "../../../../packages/domain/src/warnings.js";
import { useAuth } from "./auth.js";
import { queryKeys, todayLocalDate, useExerciseLibrary } from "./queries.js";
import { supabase } from "./supabase.js";

/**
 * Queries and form logic for the two screens that write data: manual Record
 * entry and the workbook Import Review queue. `lib/queries.ts` stays the
 * read-only side of the app.
 *
 * Manual entry: form shape, load derivation, and the insert that writes a
 * session tree.
 *
 * Numbers stay *strings* inside the form. React Hook Form hands back `""` for a
 * cleared numeric input, and coercing that to 0 would record a zero the athlete
 * never entered; keeping the raw string lets `""` mean "not recorded" all the
 * way through to the draft, where it becomes null.
 *
 * The pipeline is deliberately three steps — form → domain draft → database
 * rows — so the shared `@training/domain` schemas get to reject an impossible
 * load (a machine setting carrying kilograms) before Postgres has to.
 */

// --- Numeric text fields ----------------------------------------------------

interface NumberFieldRules {
  label: string;
  min?: number;
  max?: number;
  integer?: boolean;
}

function numberField({ label, min, max, integer }: NumberFieldRules) {
  return z
    .string()
    .trim()
    .superRefine((text, ctx) => {
      if (text === "") return;
      const value = parseDecimal(text);
      if (value === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a number` });
        return;
      }
      if (integer && !Number.isInteger(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a whole number` });
      }
      if (min !== undefined && value < min) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} cannot be below ${min}` });
      }
      if (max !== undefined && value > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} cannot be above ${max}` });
      }
    });
}

/** `""` (not recorded) becomes null; anything else has already passed validation. */
export function parseNumberField(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : parseDecimal(trimmed);
}

// --- Form schemas -----------------------------------------------------------

export const ManualSetSchema = z.object({
  /** What the athlete typed. Kept verbatim even when it resolved to a slug. */
  exerciseRawText: z.string().trim().min(1, "Name the exercise"),
  /** Canonical slug when the text matched the library, else "" (free text). */
  exerciseSlug: z.string(),
  setType: SetTypeEnum.schema,
  reps: numberField({ label: "Reps", min: 0, integer: true }),
  loadValue: numberField({ label: "Load", min: 0 }),
  loadUnit: LoadUnitEnum.schema,
  loadScope: LoadScopeEnum.schema,
});
export type ManualSetForm = z.infer<typeof ManualSetSchema>;

export const ManualActivitySchema = z.object({
  modality: ModalityEnum.schema,
  objective: ObjectiveEnum.schema,
  intensity: IntensityEnum.schema,
  durationMinutes: numberField({ label: "Duration", min: 0 }),
  distanceKm: numberField({ label: "Distance", min: 0 }),
  calories: numberField({ label: "Calories", min: 0 }),
  avgHeartRateBpm: numberField({ label: "Average heart rate", min: 0, integer: true }),
  cadenceSpm: numberField({ label: "Cadence", min: 0 }),
  notes: z.string(),
  sets: z.array(ManualSetSchema),
});
export type ManualActivityForm = z.infer<typeof ManualActivitySchema>;

export const ManualSessionSchema = z.object({
  localDate: LocalDateSchema,
  title: z.string().trim().min(1, "Give the session a title"),
  notes: z.string(),
  durationMinutes: numberField({ label: "Duration", min: 0 }),
  sessionRpe: numberField({ label: "Session RPE", min: 0, max: 10 }),
  activities: z.array(ManualActivitySchema).min(1, "A session needs at least one activity"),
});
export type ManualSessionForm = z.infer<typeof ManualSessionSchema>;

export function emptyManualSet(): ManualSetForm {
  return {
    exerciseRawText: "",
    exerciseSlug: "",
    setType: "working",
    reps: "",
    loadValue: "",
    loadUnit: "kg",
    // `total` is right for a barbell, which is the common case; every other
    // scope has to be chosen deliberately because it changes what the number
    // means, not just its size.
    loadScope: "total",
  };
}

export function emptyManualActivity(modality: ManualActivityForm["modality"]): ManualActivityForm {
  return {
    modality,
    objective: "unknown",
    intensity: "unknown",
    durationMinutes: "",
    distanceKm: "",
    calories: "",
    avgHeartRateBpm: "",
    cadenceSpm: "",
    notes: "",
    sets: modality === "strength" ? [emptyManualSet()] : [],
  };
}

export function emptyManualSession(): ManualSessionForm {
  return {
    localDate: todayLocalDate(),
    title: "",
    notes: "",
    durationMinutes: "",
    sessionRpe: "",
    activities: [emptyManualActivity("strength")],
  };
}

// --- Load derivation --------------------------------------------------------

/**
 * The only scopes whose number is a real mass. `bodyweight` has no number of
 * its own, `machine_setting` is a pin position, and `unknown` means the scope
 * was never established — none of them may be normalized.
 *
 * `per_hand` and `per_side` are *not* doubled: `load_kg` mirrors the value the
 * athlete stated, and `load_scope` carries the "each hand" meaning. Doubling
 * here would invent a total system load nobody recorded.
 */
const KG_DERIVABLE_SCOPES: ReadonlySet<LoadScope> = new Set<LoadScope>([
  "total",
  "per_hand",
  "per_side",
  "added_bodyweight",
]);

export function deriveLoadKg(
  loadValue: number | null,
  loadUnit: LoadUnit,
  loadScope: LoadScope,
): number | null {
  if (loadValue === null) return null;
  if (!KG_DERIVABLE_SCOPES.has(loadScope)) return null;
  // `none` returns null from toKilograms — kg and lb differ too much to guess.
  return toKilograms(loadValue, loadUnit).value;
}

/**
 * One sentence telling the athlete exactly what the database will keep, so a
 * withheld kilogram figure looks like a decision rather than a bug.
 */
export function loadStorageHint(loadValueText: string, unit: LoadUnit, scope: LoadScope): string {
  const value = parseNumberField(loadValueText);
  if (value === null) return "No load recorded.";
  if (scope === "machine_setting") {
    return `Stored as setting ${value}. No kilogram value: a machine pin is not a weight.`;
  }
  if (scope === "bodyweight" || scope === "unknown") {
    return `Stored as ${value} with scope ${scope.replace("_", " ")}. No kilogram value is derived.`;
  }
  if (unit === "none") {
    return `Stored as ${value} with no unit. No kilogram value: kg and lb differ too much to guess.`;
  }
  const kg = deriveLoadKg(value, unit, scope);
  const suffix =
    scope === "per_hand"
      ? " each hand"
      : scope === "per_side"
        ? " each side"
        : scope === "added_bodyweight"
          ? " on top of bodyweight"
          : "";
  return `Stored as ${value} ${unit}${suffix}, normalized to ${kg} kg.`;
}

/** True when the chosen unit/scope combination can carry no kilogram figure. */
export function withholdsKilograms(unit: LoadUnit, scope: LoadScope): boolean {
  return unit === "none" || !KG_DERIVABLE_SCOPES.has(scope);
}

// --- Form → domain draft ----------------------------------------------------

/**
 * Idempotency key for one manual save attempt. Generated once per form draft,
 * not per request: `unique (user_id, client_request_key)` then turns a
 * double-tap into a rejected duplicate instead of a second session.
 */
export function newManualRequestKey(): string {
  return `manual:${crypto.randomUUID()}`;
}

/** Sets belong to strength work; other modalities carry their metrics instead. */
export function activityKeepsSets(activity: ManualActivityForm): boolean {
  return activity.modality === "strength";
}

export function toSessionDraft(form: ManualSessionForm, clientRequestKey: string): SessionDraft {
  const minutesToSeconds = (text: string): number | null => {
    const minutes = parseNumberField(text);
    return minutes === null ? null : Math.round(minutes * 60);
  };

  return SessionDraftSchema.parse({
    localDate: form.localDate,
    title: form.title,
    source: "manual",
    // Manual entry has no source text to preserve: the structured fields *are*
    // the record. Only the athlete's own note is verbatim, so `raw_text` stays
    // empty otherwise rather than holding a summary we generated.
    rawText: form.notes,
    notes: form.notes === "" ? null : form.notes,
    durationSeconds: minutesToSeconds(form.durationMinutes),
    sessionRpe: parseNumberField(form.sessionRpe),
    clientRequestKey,
    activities: form.activities.map((activity, index) => ({
      sequence: index + 1,
      modality: activity.modality,
      objective: activity.objective,
      intensity: activity.intensity,
      durationSeconds: minutesToSeconds(activity.durationMinutes),
      distanceKm: parseNumberField(activity.distanceKm),
      calories: parseNumberField(activity.calories),
      avgHeartRateBpm: parseNumberField(activity.avgHeartRateBpm),
      cadenceSpm: parseNumberField(activity.cadenceSpm),
      notes: activity.notes === "" ? null : activity.notes,
      originalText: "",
      strengthSets: activityKeepsSets(activity)
        ? activity.sets.map((set, setIndex) => {
            const loadValue = parseNumberField(set.loadValue);
            return {
              setIndex: setIndex + 1,
              exercise: {
                rawText: set.exerciseRawText,
                slug: set.exerciseSlug === "" ? null : set.exerciseSlug,
                // A library pick is exact by construction; free text resolved
                // to nothing, so it claims no confidence at all.
                confidence: set.exerciseSlug === "" ? 0 : 1,
              },
              setType: set.setType,
              reps: parseNumberField(set.reps),
              loadValue,
              loadUnit: set.loadUnit,
              loadScope: set.loadScope,
              loadKg: deriveLoadKg(loadValue, set.loadUnit, set.loadScope),
              originalText: "",
            };
          })
        : [],
    })),
  } satisfies z.input<typeof SessionDraftSchema>);
}

// --- Domain draft → database rows -------------------------------------------

export interface SessionInsertBundle {
  session: TablesInsert<"workout_sessions">;
  activities: TablesInsert<"activities">[];
  strengthSets: TablesInsert<"strength_sets">[];
}

/**
 * Draft fields this bundle cannot write, because they live in tables it does
 * not insert into: `cardio_intervals`, `circuit_results` + `circuit_movements`,
 * `benchmark_results` + `benchmark_splits`, and `session_tags`.
 *
 * The manual form cannot produce any of them, but the workbook parser behind
 * paste entry can. Callers must check this *before* saving — a draft that
 * silently loses its benchmark splits is exactly the kind of quiet data loss
 * the import pipeline is built to prevent.
 */
export function unsupportedDraftParts(draft: SessionDraft): string[] {
  let intervals = 0;
  let circuits = 0;
  let benchmarks = 0;
  for (const activity of draft.activities) {
    intervals += activity.cardioIntervals.length;
    if (activity.circuit !== null) circuits += 1;
    if (activity.benchmark !== null) benchmarks += 1;
  }

  const parts: string[] = [];
  if (intervals > 0)
    parts.push(`${intervals} cardio ${intervals === 1 ? "interval" : "intervals"}`);
  if (circuits > 0) parts.push(`${circuits} ${circuits === 1 ? "circuit" : "circuits"}`);
  if (benchmarks > 0) {
    parts.push(`${benchmarks} benchmark ${benchmarks === 1 ? "result" : "results"}`);
  }
  if (draft.tags.length > 0) {
    parts.push(`${draft.tags.length} ${draft.tags.length === 1 ? "tag" : "tags"}`);
  }
  return parts;
}

/**
 * Builds the three insert payloads.
 *
 * Row ids are generated here rather than read back from Postgres so children
 * can reference their parents without a round trip, and `user_id` is stamped on
 * every row: the composite foreign keys are `(parent_id, user_id)`, so a child
 * whose `user_id` differs from its parent's is rejected outright.
 *
 * Every column of these three tables is written. Anything a draft carries that
 * these three tables have no room for is reported by {@link unsupportedDraftParts}
 * rather than dropped on the floor here.
 */
export function buildInsertBundle(
  draft: SessionDraft,
  userId: string,
  exerciseIdBySlug: ReadonlyMap<string, string>,
  newId: () => string = () => crypto.randomUUID(),
): SessionInsertBundle {
  const sessionId = newId();

  const session: TablesInsert<"workout_sessions"> = {
    id: sessionId,
    user_id: userId,
    local_date: draft.localDate,
    started_at: draft.startedAt,
    title: draft.title,
    source: draft.source,
    status: draft.status,
    raw_text: draft.rawText,
    transcript: draft.transcript,
    notes: draft.notes,
    duration_seconds: draft.durationSeconds,
    session_rpe: draft.sessionRpe,
    client_request_key: draft.clientRequestKey,
  };

  const activities: TablesInsert<"activities">[] = [];
  const strengthSets: TablesInsert<"strength_sets">[] = [];

  for (const activity of draft.activities) {
    const activityId = newId();
    activities.push({
      id: activityId,
      user_id: userId,
      session_id: sessionId,
      sequence: activity.sequence,
      modality: activity.modality,
      subtype: activity.subtype,
      objective: activity.objective,
      intensity: activity.intensity,
      duration_seconds: activity.durationSeconds,
      distance_km: activity.distanceKm,
      calories: activity.calories,
      avg_heart_rate_bpm: activity.avgHeartRateBpm,
      max_heart_rate_bpm: activity.maxHeartRateBpm,
      cadence_spm: activity.cadenceSpm,
      elevation_gain_m: activity.elevationGainM,
      avg_power_watts: activity.avgPowerWatts,
      external_load_kg: activity.externalLoadKg,
      // `details` is `Record<string, unknown>` in the domain schema and `Json`
      // in the generated row types. The parser only ever puts JSON scalars in
      // it (`floors`, `steps`), and it is serialized as JSON on the way out
      // regardless, so this narrows rather than reinterprets.
      details: activity.details as Json,
      notes: activity.notes,
      original_text: activity.originalText,
    });

    for (const set of activity.strengthSets) {
      strengthSets.push({
        user_id: userId,
        activity_id: activityId,
        set_index: set.setIndex,
        exercise_id: set.exercise.slug ? (exerciseIdBySlug.get(set.exercise.slug) ?? null) : null,
        exercise_raw_text: set.exercise.rawText,
        apparatus: set.exercise.apparatus,
        exercise_confidence: set.exercise.confidence,
        set_type: set.setType,
        reps: set.reps,
        load_value: set.loadValue,
        load_unit: set.loadUnit,
        load_scope: set.loadScope,
        load_kg: set.loadKg,
        side: set.side,
        rir: set.rir,
        rpe: set.rpe,
        tempo: set.tempo,
        rest_seconds: set.restSeconds,
        hold_seconds: set.holdSeconds,
        completed: set.completed,
        notes: set.notes,
        original_text: set.originalText,
      });
    }
  }

  return { session, activities, strengthSets };
}

// --- Choices offered by the form --------------------------------------------

/**
 * Re-exported from the enums so the form controls cannot drift from the
 * database types, and so only this module reaches into the domain package.
 */
export const MODALITIES = ModalityEnum.values;
export const OBJECTIVES = ObjectiveEnum.values;
export const INTENSITIES = IntensityEnum.values;
export const SET_TYPES = SetTypeEnum.values;
export const LOAD_UNITS = LoadUnitEnum.values;
export const LOAD_SCOPES = LoadScopeEnum.values;
export const REVIEW_STATUSES = ReviewStatusEnum.values;

// --- Save -------------------------------------------------------------------

/** Postgres unique-violation SQLSTATE, surfaced by PostgREST as `code`. */
const UNIQUE_VIOLATION = "23505";

export interface SaveManualSessionResult {
  sessionId: string;
  /** True when the idempotency key had already been used, i.e. a double-tap. */
  wasDuplicate: boolean;
}

/**
 * Writes one session tree: session row, then activities, then sets.
 *
 * Shared by manual entry and pasted-text entry so the duplicate handling and
 * the rollback exist once. PostgREST gives one transaction per request, not per
 * bundle, so a failure part-way through is undone here by deleting the session
 * — children cascade from it.
 */
export async function insertSessionBundle(
  bundle: SessionInsertBundle,
  requestKey: string,
): Promise<SaveManualSessionResult> {
  const inserted = await supabase
    .from("workout_sessions")
    .insert(bundle.session)
    .select("id")
    .single();

  if (inserted.error) {
    if (inserted.error.code === UNIQUE_VIOLATION) {
      // The key was already spent, so the session exists. Report it
      // instead of failing: the second tap did what the first one did.
      const existing = await supabase
        .from("workout_sessions")
        .select("id")
        .eq("client_request_key", requestKey)
        .maybeSingle();
      if (existing.data) return { sessionId: existing.data.id, wasDuplicate: true };
    }
    throw inserted.error;
  }

  const sessionId = inserted.data.id;
  try {
    const activities = await supabase.from("activities").insert(bundle.activities);
    if (activities.error) throw activities.error;
    if (bundle.strengthSets.length > 0) {
      const sets = await supabase.from("strength_sets").insert(bundle.strengthSets);
      if (sets.error) throw sets.error;
    }
  } catch (error) {
    // Roll back so no half-written tree survives. Activities and sets
    // cascade from the session, so one delete is enough; if the delete
    // itself fails the original error still wins, because that is the
    // one that explains what went wrong.
    await supabase.from("workout_sessions").delete().eq("id", sessionId);
    throw error;
  }

  return { sessionId, wasDuplicate: false };
}

export interface ExerciseLibraryLookup {
  /** `slug -> exercises.id`, the lookup `buildInsertBundle` needs. */
  idBySlug: ReadonlyMap<string, string>;
  /** False while the library query is loading or has failed. */
  isReady: boolean;
}

export function useExerciseLibraryLookup(): ExerciseLibraryLookup {
  const exercises = useExerciseLibrary();
  return {
    idBySlug: new Map((exercises.data ?? []).map((exercise) => [exercise.slug, exercise.id])),
    isReady: exercises.isSuccess,
  };
}

/**
 * Refuses to save a draft whose canonical exercise links would be silently
 * dropped.
 *
 * The parser resolves slugs offline, from the library compiled into the bundle;
 * turning a slug into an `exercises.id` needs the library *row*, which is a
 * query. If that query has not resolved, every set arrives with
 * `exercise_id: null` — a permanent, invisible loss of the canonical link that
 * depends only on network timing. Free text is unaffected: a set with no slug
 * has no link to lose, which is why this checks the draft rather than blocking
 * every save.
 */
export function assertExerciseLinksResolvable(
  draft: SessionDraft,
  lookup: ExerciseLibraryLookup,
): void {
  if (lookup.isReady) return;
  const wouldLoseLink = draft.activities.some((activity) =>
    activity.strengthSets.some((set) => set.exercise.slug !== null),
  );
  if (wouldLoseLink) {
    throw new Error(
      "The exercise library has not finished loading, so these exercises cannot be linked yet. Wait a moment and try again.",
    );
  }
}

export function useSaveManualSession() {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const lookup = useExerciseLibraryLookup();

  return useMutation<
    SaveManualSessionResult,
    Error,
    { form: ManualSessionForm; requestKey: string }
  >({
    mutationFn: async ({ form, requestKey }) => {
      if (!userId) throw new Error("Not signed in.");
      const draft = toSessionDraft(form, requestKey);
      assertExerciseLinksResolvable(draft, lookup);
      const bundle = buildInsertBundle(draft, userId, lookup.idBySlug);
      return insertSessionBundle(bundle, requestKey);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

// --- Voice save ---------------------------------------------------------------

/**
 * One key per *recording*, minted when the transcript screen opens — not per
 * save attempt — so a double-tap on Save cannot write two sessions.
 */
export function newVoiceRequestKey(): string {
  return `voice:${crypto.randomUUID()}`;
}

export interface SaveVoiceSessionInput {
  transcript: string;
  title: string;
  localDate: string;
  requestKey: string;
}

/**
 * Saves a transcript as a complete session row. No activities, no sets: the
 * transcript IS the record (`raw_text` keeps it verbatim, per the schema's
 * "every structured record must stay re-derivable" rule), and any structure is
 * the athlete's to add later. This replaces the old AI parsing pipeline — the
 * one step between speech and the database is now the athlete reading what was
 * heard and tapping Save.
 */
export function useSaveVoiceSession() {
  const queryClient = useQueryClient();
  const { userId } = useAuth();

  return useMutation<SaveManualSessionResult, Error, SaveVoiceSessionInput>({
    mutationFn: async ({ transcript, title, localDate, requestKey }) => {
      if (!userId) throw new Error("Not signed in.");
      const text = transcript.trim();
      if (text === "") throw new Error("The transcript is empty.");

      const row: TablesInsert<"workout_sessions"> = {
        user_id: userId,
        local_date: localDate,
        title: title.trim() === "" ? "Voice session" : title.trim(),
        source: "voice",
        raw_text: text,
        transcript: text,
        client_request_key: requestKey,
      };

      const inserted = await supabase.from("workout_sessions").insert(row).select("id").single();

      if (inserted.error) {
        if (inserted.error.code === UNIQUE_VIOLATION) {
          const existing = await supabase
            .from("workout_sessions")
            .select("id")
            .eq("client_request_key", requestKey)
            .maybeSingle();
          if (existing.data) return { sessionId: existing.data.id, wasDuplicate: true };
        }
        throw inserted.error;
      }

      return { sessionId: inserted.data.id, wasDuplicate: false };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

// --- Import review ----------------------------------------------------------

/** The columns the review queue shows. Kept explicit so nothing is fetched blind. */
export type ImportEntryRow = Pick<
  ImportEntry,
  | "id"
  | "cell_ref"
  | "sheet_name"
  | "source_row"
  | "source_col"
  | "week_label"
  | "inferred_local_date"
  | "raw_text"
  | "warnings"
  | "unconsumed_lines"
  | "review_status"
  | "review_notes"
  | "reviewed_at"
>;

const IMPORT_ENTRY_COLUMNS =
  "id, cell_ref, sheet_name, source_row, source_col, week_label, inferred_local_date, raw_text, warnings, unconsumed_lines, review_status, review_notes, reviewed_at";

export type ReviewFilter = ReviewStatus | "all";

export function useImportEntries(filter: ReviewFilter) {
  return useQuery({
    queryKey: [...queryKeys.importEntries, "list", filter],
    queryFn: async (): Promise<ImportEntryRow[]> => {
      let query = supabase
        .from("import_entries")
        .select(IMPORT_ENTRY_COLUMNS)
        .order("source_row")
        .order("source_col");
      if (filter !== "all") query = query.eq("review_status", filter);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Counts per status, plus how many entries have unconsumed lines.
 *
 * One request that reads every entry's status rather than seven head-only
 * counts: at 170 rows the payload is smaller than the round trips, and the
 * numbers are then guaranteed to come from a single snapshot.
 */
export function useImportEntrySummary() {
  return useQuery({
    queryKey: [...queryKeys.importEntries, "summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_entries")
        .select("review_status, unconsumed_lines");
      if (error) throw error;
      const byStatus = new Map<ReviewStatus, number>();
      let withUnconsumed = 0;
      for (const row of data ?? []) {
        byStatus.set(row.review_status, (byStatus.get(row.review_status) ?? 0) + 1);
        if (row.unconsumed_lines.length > 0) withUnconsumed += 1;
      }
      return { total: data?.length ?? 0, byStatus, withUnconsumed };
    },
  });
}

/**
 * Splits the `warnings` jsonb into warnings that match the shared schema and
 * anything that does not. Unrecognized entries are handed back rather than
 * dropped: a warning the UI cannot read is still evidence about the parse.
 */
export function parseImportWarnings(json: unknown): {
  warnings: ParseWarning[];
  unrecognized: unknown[];
} {
  if (!Array.isArray(json)) {
    return { warnings: [], unrecognized: json === null || json === undefined ? [] : [json] };
  }
  const warnings: ParseWarning[] = [];
  const unrecognized: unknown[] = [];
  for (const item of json) {
    const parsed = ParseWarningSchema.safeParse(item);
    if (parsed.success) warnings.push(parsed.data);
    else unrecognized.push(item);
  }
  return { warnings, unrecognized };
}

export type ReviewDecision = "approved" | "rejected";

/**
 * Records a human decision on one staged cell. It only moves the review
 * columns — applying an approved entry is the importer's job, and re-parsing
 * from the browser would fork the parser into a second implementation.
 */
export function useReviewImportEntry() {
  const queryClient = useQueryClient();
  return useMutation<
    ImportEntryRow,
    Error,
    { id: string; decision: ReviewDecision; notes: string }
  >({
    mutationFn: async ({ id, decision, notes }) => {
      const { data, error } = await supabase
        .from("import_entries")
        .update({
          review_status: decision,
          reviewed_at: new Date().toISOString(),
          review_notes: notes.trim() === "" ? null : notes.trim(),
        })
        .eq("id", id)
        .select(IMPORT_ENTRY_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.importEntries });
    },
  });
}

/**
 * Every session with its children, for the More page's JSON export.
 *
 * Not a query hook: a download is a one-shot action, and caching a full copy of
 * the log in memory afterwards buys nothing.
 */
export async function fetchSessionExport() {
  const { data, error } = await supabase
    .from("workout_sessions")
    .select(
      "*, activities(*, strength_sets(*), cardio_intervals(*), circuit_results(*, circuit_movements(*)), benchmark_results(*, benchmark_splits(*)))",
    )
    .order("local_date");
  if (error) throw error;
  return data ?? [];
}
