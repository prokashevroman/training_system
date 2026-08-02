import type { Activity, StrengthSet, WorkoutSession } from "@training/db-types";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase.js";

/**
 * Shared query conventions.
 *
 * Every query is scoped by RLS rather than by an explicit `user_id` filter —
 * the policies already restrict rows to `auth.uid()`, so adding a client-side
 * filter would duplicate the rule in a second place where it could drift.
 * Query keys always start with the entity name so a mutation can invalidate a
 * whole family.
 */

export type SessionWithActivities = WorkoutSession & { activities: Activity[] };

export const queryKeys = {
  sessions: ["sessions"] as const,
  sessionsByDate: (date: string) => ["sessions", "date", date] as const,
  session: (id: string) => ["sessions", id] as const,
  exercises: ["exercises"] as const,
  importEntries: ["import-entries"] as const,
  profile: ["profile"] as const,
};

/** Today's local date in the athlete's timezone, as `YYYY-MM-DD`. */
export function todayLocalDate(timeZone = "Europe/Amsterdam"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function useSessionsOnDate(localDate: string) {
  return useQuery({
    queryKey: queryKeys.sessionsByDate(localDate),
    queryFn: async (): Promise<SessionWithActivities[]> => {
      const { data, error } = await supabase
        .from("workout_sessions")
        .select("*, activities(*)")
        .eq("local_date", localDate)
        .order("client_request_key");
      if (error) throw error;
      return (data ?? []) as SessionWithActivities[];
    },
  });
}

/** Counts used by the Today summary. Cheap head-only requests. */
export function useTrainingSummary() {
  return useQuery({
    queryKey: [...queryKeys.sessions, "summary"],
    queryFn: async () => {
      const since = new Date(Date.now() - 27 * 86_400_000).toISOString().slice(0, 10);
      const [total, recent, latest] = await Promise.all([
        supabase.from("workout_sessions").select("*", { count: "exact", head: true }),
        supabase
          .from("workout_sessions")
          .select("*", { count: "exact", head: true })
          .gte("local_date", since),
        supabase
          .from("workout_sessions")
          .select("local_date")
          .order("local_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (total.error) throw total.error;
      if (recent.error) throw recent.error;
      return {
        totalSessions: total.count ?? 0,
        last28Days: recent.count ?? 0,
        lastTrainedOn: latest.data?.local_date ?? null,
      };
    },
  });
}

export function useSession(id: string | undefined) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: queryKeys.session(id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workout_sessions")
        .select(
          "*, activities(*, strength_sets(*), cardio_intervals(*), circuit_results(*, circuit_movements(*)), benchmark_results(*, benchmark_splits(*)))",
        )
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useExerciseLibrary() {
  return useQuery({
    queryKey: queryKeys.exercises,
    // Reference data: it only changes with a migration, so cache it hard.
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exercises")
        .select("id, slug, name, movement_pattern")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Formats a set the way the source workbook meant it, not as bare kilograms. */
export function formatLoad(
  set: Pick<StrengthSet, "load_value" | "load_unit" | "load_scope" | "load_kg">,
): string {
  if (set.load_value === null) return "—";
  const unit = set.load_unit === "none" ? "" : ` ${set.load_unit}`;
  const base = `${set.load_value}${unit}`;
  switch (set.load_scope) {
    case "per_hand":
      return `${base} each hand`;
    case "per_side":
      return `${base} each side`;
    case "added_bodyweight":
      return `+${base}`;
    case "machine_setting":
      return `setting ${set.load_value}`;
    case "unknown":
      return `${set.load_value} (unit unknown)`;
    default:
      return base;
  }
}
