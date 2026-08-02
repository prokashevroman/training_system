import {
  IntensityEnum,
  ModalityEnum,
  MovementPatternEnum,
  ObjectiveEnum,
  SessionSourceEnum,
  type Intensity,
  type Modality,
  type MovementPattern,
  type Objective,
  type SessionSource,
} from "@training/domain";
import type { TablesUpdate } from "@training/db-types";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys, type SessionWithActivities } from "./queries.js";
import { supabase } from "./supabase.js";

/**
 * History filtering happens in Postgres.
 *
 * Every filter below becomes either a column predicate on `workout_sessions`
 * or an `!inner` embed that PostgREST turns into a join, so the browser only
 * ever receives one page of matching sessions. Fetching all sessions and
 * filtering in JavaScript would work at 244 rows and quietly stop working at
 * a few thousand, which is the size this log reaches in a couple of years.
 *
 * The relational filters use *aliased* embeds (`f_act:activities!inner(id)`)
 * rather than filtering the embed the UI renders. An `!inner` embed with a
 * filter also prunes the returned child rows, so filtering `activities`
 * directly would show a session as if it contained only its cycling activity.
 * The alias exists solely to constrain which parent rows come back; the plain
 * `activities(*)` embed alongside it still returns the whole session.
 */

export interface HistoryFilters {
  /** Inclusive `local_date` bounds; `""` means unbounded on that side. */
  from: string;
  to: string;
  modalities: Modality[];
  objectives: Objective[];
  intensities: Intensity[];
  sources: SessionSource[];
  /** `exercises.id`; matches sessions with a strength set of that exercise. */
  exerciseId: string;
  movementPattern: MovementPattern | "";
  /** `""` = off, `"any"` = any benchmark result, otherwise a definition slug. */
  benchmark: string;
  /** Whether the session was generated from a plan (`planned_session_id`). */
  planned: "" | "planned" | "unplanned";
}

export const EMPTY_HISTORY_FILTERS: HistoryFilters = {
  from: "",
  to: "",
  modalities: [],
  objectives: [],
  intensities: [],
  sources: [],
  exerciseId: "",
  movementPattern: "",
  benchmark: "",
  planned: "",
};

export const MODALITY_OPTIONS = ModalityEnum.values;
export const OBJECTIVE_OPTIONS = ObjectiveEnum.values;
export const INTENSITY_OPTIONS = IntensityEnum.values;
export const SOURCE_OPTIONS = SessionSourceEnum.values;
export const MOVEMENT_PATTERN_OPTIONS = MovementPatternEnum.values;

export function countActiveFilters(f: HistoryFilters): number {
  return (
    (f.from ? 1 : 0) +
    (f.to ? 1 : 0) +
    (f.modalities.length ? 1 : 0) +
    (f.objectives.length ? 1 : 0) +
    (f.intensities.length ? 1 : 0) +
    (f.sources.length ? 1 : 0) +
    (f.exerciseId ? 1 : 0) +
    (f.movementPattern ? 1 : 0) +
    (f.benchmark ? 1 : 0) +
    (f.planned ? 1 : 0)
  );
}

// --- Request building -------------------------------------------------------

export type FilterOp =
  | { kind: "eq" | "gte" | "lte"; column: string; value: string }
  | { kind: "in"; column: string; values: readonly string[] }
  | { kind: "isNull"; column: string }
  | { kind: "isNotNull"; column: string };

export interface HistoryRequest {
  /** Full PostgREST `select`: the caller's display embed plus filter joins. */
  select: string;
  ops: FilterOp[];
}

/** Session columns plus the activities the cards and table render. */
export const HISTORY_LIST_SELECT = "*, activities(*)";
/** The calendar only needs a dot per modality, so it asks for far less. */
export const HISTORY_CALENDAR_SELECT = "id, title, local_date, activities(id, modality)";

/**
 * Turns a filter set into one PostgREST request. Pure so the join shapes can
 * be asserted in a test instead of being discovered against a live database.
 */
export function buildHistoryRequest(filters: HistoryFilters, baseSelect: string): HistoryRequest {
  const embeds: string[] = [];
  const ops: FilterOp[] = [];

  if (filters.from) ops.push({ kind: "gte", column: "local_date", value: filters.from });
  if (filters.to) ops.push({ kind: "lte", column: "local_date", value: filters.to });
  if (filters.sources.length) ops.push({ kind: "in", column: "source", values: filters.sources });
  if (filters.planned === "planned") ops.push({ kind: "isNotNull", column: "planned_session_id" });
  if (filters.planned === "unplanned") ops.push({ kind: "isNull", column: "planned_session_id" });

  // Modality, objective and intensity are attributes of the same row, so they
  // share one join: the session must have *one* activity satisfying all three.
  // Separate joins would match a session whose bike ride is easy and whose
  // lifting is max, which reads as a match for "easy strength".
  if (filters.modalities.length || filters.objectives.length || filters.intensities.length) {
    embeds.push("f_act:activities!inner(id)");
    if (filters.modalities.length) {
      ops.push({ kind: "in", column: "f_act.modality", values: filters.modalities });
    }
    if (filters.objectives.length) {
      ops.push({ kind: "in", column: "f_act.objective", values: filters.objectives });
    }
    if (filters.intensities.length) {
      ops.push({ kind: "in", column: "f_act.intensity", values: filters.intensities });
    }
  }

  if (filters.exerciseId) {
    embeds.push("f_ex:activities!inner(strength_sets!inner(id))");
    ops.push({ kind: "eq", column: "f_ex.strength_sets.exercise_id", value: filters.exerciseId });
  }

  // Movement pattern lives on `exercises`, so it needs the fourth level of the
  // join. A set with `exercise_id = null` (unmatched free text) has no pattern
  // and is correctly excluded rather than guessed at.
  if (filters.movementPattern) {
    embeds.push("f_mp:activities!inner(strength_sets!inner(exercises!inner(id)))");
    ops.push({
      kind: "eq",
      column: "f_mp.strength_sets.exercises.movement_pattern",
      value: filters.movementPattern,
    });
  }

  if (filters.benchmark) {
    embeds.push("f_bench:activities!inner(benchmark_results!inner(id))");
    if (filters.benchmark !== "any") {
      ops.push({
        kind: "eq",
        column: "f_bench.benchmark_results.definition_slug",
        value: filters.benchmark,
      });
    }
  }

  return { select: [baseSelect, ...embeds].join(", "), ops };
}

/**
 * Structurally typed over the builder rather than importing PostgREST's
 * generics: the `select` string is built at runtime, which erases the result
 * type anyway, and this keeps one applier for every history query.
 */
interface FilterableQuery<Q> {
  eq(column: string, value: unknown): Q;
  in(column: string, values: readonly unknown[]): Q;
  gte(column: string, value: unknown): Q;
  lte(column: string, value: unknown): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: string, value: unknown): Q;
}

export function applyHistoryOps<Q extends FilterableQuery<Q>>(
  query: Q,
  ops: readonly FilterOp[],
): Q {
  return ops.reduce<Q>((q, op) => {
    switch (op.kind) {
      case "eq":
        return q.eq(op.column, op.value);
      case "gte":
        return q.gte(op.column, op.value);
      case "lte":
        return q.lte(op.column, op.value);
      case "in":
        return q.in(op.column, op.values);
      case "isNull":
        return q.is(op.column, null);
      case "isNotNull":
        return q.not(op.column, "is", null);
    }
  }, query);
}

// --- Hooks ------------------------------------------------------------------

export const HISTORY_PAGE_SIZE = 20;

/**
 * Keyed under `queryKeys.sessions` on purpose: a session edit invalidates the
 * whole `["sessions"]` family and the history lists refresh with it.
 */
export const historyQueryKeys = {
  list: (filters: HistoryFilters) => [...queryKeys.sessions, "history", filters] as const,
  month: (filters: HistoryFilters, month: string) =>
    [...queryKeys.sessions, "history-month", month, filters] as const,
  benchmarkDefinitions: ["benchmark-definitions"] as const,
};

export interface HistoryPage {
  sessions: SessionWithActivities[];
  /** Total matching rows, from PostgREST's `count=exact`, not a page length. */
  total: number;
}

export function useHistorySessions(filters: HistoryFilters, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: historyQueryKeys.list(filters),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<HistoryPage> => {
      const { select, ops } = buildHistoryRequest(filters, HISTORY_LIST_SELECT);
      const first = pageParam * HISTORY_PAGE_SIZE;
      const { data, error, count } = await applyHistoryOps(
        supabase.from("workout_sessions").select(select, { count: "exact" }),
        ops,
      )
        .order("local_date", { ascending: false })
        // Within a day, keep the workbook's own order (R{row}C{col} ascending)
        // so the morning lift stays above the evening commute.
        .order("client_request_key", { ascending: true, nullsFirst: false })
        .range(first, first + HISTORY_PAGE_SIZE - 1);
      if (error) throw error;
      return {
        sessions: (data ?? []) as unknown as SessionWithActivities[],
        total: count ?? 0,
      };
    },
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((n, page) => n + page.sessions.length, 0);
      return loaded < lastPage.total ? pages.length : undefined;
    },
  });
}

export interface CalendarSession {
  id: string;
  title: string;
  local_date: string;
  activities: { id: string; modality: Modality }[];
}

/** First and last `local_date` of the month containing `month` (`YYYY-MM`). */
export function monthBounds(month: string): { from: string; to: string } {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * The calendar needs a whole month at once, so it intersects the active date
 * range with the visible month instead of paginating. A month cannot hold more
 * sessions than `MONTH_ROW_CAP`, and the cap keeps a bad filter from turning
 * into an unbounded fetch.
 */
const MONTH_ROW_CAP = 200;

export function useHistoryMonth(filters: HistoryFilters, month: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: historyQueryKeys.month(filters, month),
    queryFn: async (): Promise<CalendarSession[]> => {
      const bounds = monthBounds(month);
      const { select, ops } = buildHistoryRequest(
        {
          ...filters,
          from: filters.from && filters.from > bounds.from ? filters.from : bounds.from,
          to: filters.to && filters.to < bounds.to ? filters.to : bounds.to,
        },
        HISTORY_CALENDAR_SELECT,
      );
      const { data, error } = await applyHistoryOps(
        supabase.from("workout_sessions").select(select),
        ops,
      )
        .order("local_date", { ascending: true })
        .order("client_request_key", { ascending: true, nullsFirst: false })
        .range(0, MONTH_ROW_CAP - 1);
      if (error) throw error;
      return (data ?? []) as unknown as CalendarSession[];
    },
  });
}

// --- Editing a session ------------------------------------------------------

/**
 * The session-level columns the detail page can edit. Sets, intervals and
 * splits are deliberately absent: changing a parsed set means re-deciding what
 * the source text said, which belongs with the import review flow rather than
 * with a field on a form.
 */
export type SessionEditPatch = Pick<
  TablesUpdate<"workout_sessions">,
  "title" | "notes" | "local_date" | "status" | "session_rpe" | "duration_seconds"
>;

export function useUpdateSession(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SessionEditPatch) => {
      // No user_id predicate: the update policy already restricts the row to
      // its owner, and `.select()` back confirms a row was actually written
      // rather than silently filtered out by RLS.
      const { data, error } = await supabase
        .from("workout_sessions")
        .update(patch)
        .eq("id", sessionId)
        .select("id, local_date")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Every session key — the detail, the day lists, the history pages and
      // the Today summary — hangs off `["sessions"]`, and a date edit moves the
      // session between days, so the whole family is refetched.
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

/** Reference data for the benchmark filter. Changes only with a migration. */
export function useBenchmarkDefinitions() {
  return useQuery({
    queryKey: historyQueryKeys.benchmarkDefinitions,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("benchmark_definitions")
        .select("slug, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}
