import type {
  Activity,
  CardioInterval,
  CircuitMovement,
  CircuitResult,
  StrengthSet,
} from "@training/db-types";
import { formatLoad } from "../lib/queries.js";
import { BenchmarkDetail, type BenchmarkWithSplits } from "./BenchmarkDetail.js";
import {
  EM_DASH,
  formatClock,
  formatDistance,
  formatPace,
  formatSplit500,
  humanizeEnum,
} from "./session-format.js";

export type CircuitWithMovements = CircuitResult & { circuit_movements: CircuitMovement[] };

export type ActivityWithChildren = Activity & {
  strength_sets: StrengthSet[];
  cardio_intervals: CardioInterval[];
  circuit_results: CircuitWithMovements[];
  benchmark_results: BenchmarkWithSplits[];
};

/**
 * One activity of a session, with every child row the schema can hold.
 *
 * Loads always go through `formatLoad`: the corpus records a machine pin
 * position, a per-hand dumbbell weight and a bare unitless number, and
 * flattening all three into kilograms would state things the athlete never
 * wrote down.
 */
export function ActivityDetail({
  activity,
  benchmarkNames,
}: {
  activity: ActivityWithChildren;
  benchmarkNames: Map<string, string>;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <header className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-medium">{humanizeEnum(activity.modality)}</h3>
        {activity.subtype && <Tag>{activity.subtype}</Tag>}
        <Tag>{humanizeEnum(activity.objective)}</Tag>
        <Tag>{humanizeEnum(activity.intensity)} intensity</Tag>
      </header>

      <ActivityMetrics activity={activity} />

      {activity.notes && <p className="text-sm text-slate-300">{activity.notes}</p>}

      {activity.strength_sets.length > 0 && <StrengthSets sets={activity.strength_sets} />}

      {activity.cardio_intervals.length > 0 && (
        <CardioIntervals intervals={activity.cardio_intervals} />
      )}

      {activity.circuit_results.map((circuit) => (
        <Circuit key={circuit.id} circuit={circuit} />
      ))}

      {activity.benchmark_results.map((benchmark) => (
        <BenchmarkDetail
          key={benchmark.id}
          benchmark={benchmark}
          name={benchmarkNames.get(benchmark.definition_slug)}
        />
      ))}
    </section>
  );
}

/** Only the metrics that were recorded; a missing one is omitted, not zeroed. */
function ActivityMetrics({ activity }: { activity: Activity }) {
  const metrics: [string, string][] = [];
  if (activity.distance_km !== null)
    metrics.push(["Distance", formatDistance(activity.distance_km)]);
  if (activity.duration_seconds !== null)
    metrics.push(["Duration", formatClock(activity.duration_seconds)]);
  if (activity.elevation_gain_m !== null)
    metrics.push(["Elevation", `${activity.elevation_gain_m} m`]);
  if (activity.avg_heart_rate_bpm !== null)
    metrics.push(["Avg HR", `${activity.avg_heart_rate_bpm} bpm`]);
  if (activity.max_heart_rate_bpm !== null)
    metrics.push(["Max HR", `${activity.max_heart_rate_bpm} bpm`]);
  if (activity.avg_power_watts !== null) metrics.push(["Power", `${activity.avg_power_watts} W`]);
  if (activity.cadence_spm !== null) metrics.push(["Cadence", `${activity.cadence_spm} spm`]);
  if (activity.calories !== null) metrics.push(["Calories", `${activity.calories} kcal`]);
  if (activity.external_load_kg !== null)
    metrics.push(["Carried load", `${activity.external_load_kg} kg`]);

  if (metrics.length === 0) return null;

  return (
    <dl className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {metrics.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="text-sm text-slate-200 tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface ExerciseGroup {
  key: string;
  label: string;
  sets: StrengthSet[];
}

/**
 * Groups sets by exercise, keeping the order in which each exercise first
 * appeared. `set_index` runs across the whole activity rather than restarting
 * per exercise, so first appearance is the only ordering the data supports.
 *
 * Sets with no `exercise_id` group by their raw text: two rows that say
 * "Chest-supported row" belong together even when the matcher declined them.
 */
export function groupSetsByExercise(sets: readonly StrengthSet[]): ExerciseGroup[] {
  const ordered = [...sets].sort((a, b) => a.set_index - b.set_index);
  const groups = new Map<string, ExerciseGroup>();

  for (const set of ordered) {
    const key = set.exercise_id ?? `raw:${set.exercise_raw_text.trim().toLowerCase()}`;
    const existing = groups.get(key);
    if (existing) existing.sets.push(set);
    else groups.set(key, { key, label: set.exercise_raw_text, sets: [set] });
  }

  return [...groups.values()];
}

function StrengthSets({ sets }: { sets: StrengthSet[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs uppercase tracking-wide text-slate-400">Sets</h4>
      {groupSetsByExercise(sets).map((group) => (
        <div key={group.key} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{group.label}</p>
            <p className="text-xs text-slate-500">
              {group.sets.length} set{group.sets.length === 1 ? "" : "s"}
              {group.sets[0]?.exercise_id === null && " · unmatched"}
            </p>
          </div>
          <ul className="mt-1.5 space-y-1">
            {group.sets.map((set) => (
              <li key={set.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="w-6 shrink-0 text-xs text-slate-500 tabular-nums">
                  {set.set_index}
                </span>
                <span className="text-slate-200 tabular-nums">
                  {set.reps === null ? EM_DASH : `${set.reps} reps`}
                </span>
                <span className="text-slate-400">·</span>
                {/* formatLoad keeps "each hand", "+5 kg" and "setting 6" intact. */}
                <span className="text-slate-200 tabular-nums">{formatLoad(set)}</span>
                {set.hold_seconds !== null && (
                  <span className="text-slate-400">hold {formatClock(set.hold_seconds)}</span>
                )}
                {set.side && <Tag>{humanizeEnum(set.side)}</Tag>}
                {set.set_type !== "working" && <Tag>{humanizeEnum(set.set_type)}</Tag>}
                {set.rpe !== null && <span className="text-slate-400">RPE {set.rpe}</span>}
                {set.rir !== null && <span className="text-slate-400">RIR {set.rir}</span>}
                {set.tempo && <span className="text-slate-400">tempo {set.tempo}</span>}
                {set.apparatus && <span className="text-slate-400">{set.apparatus}</span>}
                {set.rest_seconds !== null && (
                  <span className="text-slate-400">rest {formatClock(set.rest_seconds)}</span>
                )}
                {!set.completed && <Tag>not completed</Tag>}
                {set.notes && <span className="text-slate-400">{set.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function CardioIntervals({ intervals }: { intervals: CardioInterval[] }) {
  const ordered = [...intervals].sort((a, b) => a.interval_index - b.interval_index);
  return (
    <div className="space-y-2">
      <h4 className="text-xs uppercase tracking-wide text-slate-400">Intervals</h4>
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-left uppercase tracking-wide text-slate-500">
              <th className="px-3 py-1.5 font-medium">#</th>
              <th className="px-3 py-1.5 font-medium">Type</th>
              <th className="px-3 py-1.5 font-medium">Distance</th>
              <th className="px-3 py-1.5 font-medium">Duration</th>
              <th className="px-3 py-1.5 font-medium">Pace</th>
              <th className="px-3 py-1.5 font-medium">500 m split</th>
              <th className="px-3 py-1.5 font-medium">Other</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((interval) => (
              <tr key={interval.id} className="border-b border-slate-800/60 align-top">
                <td className="px-3 py-1.5 text-slate-500 tabular-nums">
                  {interval.interval_index}
                </td>
                <td className="px-3 py-1.5 text-slate-300">
                  {humanizeEnum(interval.interval_type)}
                </td>
                <td className="px-3 py-1.5 text-slate-200 tabular-nums">
                  {formatDistance(interval.distance_km)}
                </td>
                <td className="px-3 py-1.5 text-slate-200 tabular-nums">
                  {formatClock(interval.duration_seconds)}
                </td>
                <td className="px-3 py-1.5 text-slate-200 tabular-nums">
                  {formatPace(interval.pace_seconds_per_km)}
                </td>
                <td className="px-3 py-1.5 text-slate-200 tabular-nums">
                  {formatSplit500(interval.split_seconds_per_500m)}
                </td>
                <td className="px-3 py-1.5 text-slate-400">{describeInterval(interval)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function describeInterval(interval: CardioInterval): string {
  const parts: string[] = [];
  if (interval.speed_value !== null) {
    parts.push(`${interval.speed_value} ${interval.speed_unit ?? ""}`.trim());
  }
  if (interval.heart_rate_bpm !== null) parts.push(`${interval.heart_rate_bpm} bpm`);
  if (interval.power_watts !== null) parts.push(`${interval.power_watts} W`);
  if (interval.cadence_spm !== null) parts.push(`${interval.cadence_spm} spm`);
  if (interval.calories !== null) parts.push(`${interval.calories} kcal`);
  if (interval.rest_seconds !== null) parts.push(`rest ${formatClock(interval.rest_seconds)}`);
  if (interval.notes) parts.push(interval.notes);
  return parts.length ? parts.join(" · ") : EM_DASH;
}

function Circuit({ circuit }: { circuit: CircuitWithMovements }) {
  const movements = [...circuit.circuit_movements].sort(
    (a, b) => a.movement_order - b.movement_order,
  );
  const rounds =
    circuit.rounds_completed === null && circuit.rounds_prescribed === null
      ? null
      : `${circuit.rounds_completed ?? EM_DASH} of ${circuit.rounds_prescribed ?? EM_DASH}`;

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-sm font-medium">{circuit.name ?? humanizeEnum(circuit.format)}</p>
        {circuit.name && <Tag>{humanizeEnum(circuit.format)}</Tag>}
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rounds && <Metric label="Rounds" value={rounds} />}
        {circuit.partial_round_reps !== null && (
          <Metric label="Partial round" value={`${circuit.partial_round_reps} reps`} />
        )}
        {circuit.completion_seconds !== null && (
          <Metric label="Completed in" value={formatClock(circuit.completion_seconds)} />
        )}
        {circuit.time_cap_seconds !== null && (
          <Metric label="Time cap" value={formatClock(circuit.time_cap_seconds)} />
        )}
        {circuit.work_seconds !== null && (
          <Metric label="Work" value={formatClock(circuit.work_seconds)} />
        )}
        {circuit.rest_seconds !== null && (
          <Metric label="Rest" value={formatClock(circuit.rest_seconds)} />
        )}
        {circuit.score && <Metric label="Score" value={circuit.score} />}
        {circuit.as_prescribed !== null && (
          <Metric label="As prescribed" value={circuit.as_prescribed ? "Yes" : "No"} />
        )}
      </dl>

      {movements.length > 0 && (
        <ol className="space-y-1">
          {movements.map((movement) => (
            <li key={movement.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="w-4 shrink-0 text-xs text-slate-500 tabular-nums">
                {movement.movement_order}
              </span>
              <span className="text-slate-200">{movement.exercise_raw_text}</span>
              {describeTarget(movement) && (
                <span className="text-slate-400 tabular-nums">{describeTarget(movement)}</span>
              )}
              {movement.load_value !== null && (
                <span className="text-slate-200 tabular-nums">{formatLoad(movement)}</span>
              )}
              {movement.apparatus && <span className="text-slate-400">{movement.apparatus}</span>}
              {movement.notes && <span className="text-slate-400">{movement.notes}</span>}
            </li>
          ))}
        </ol>
      )}

      {circuit.notes && <p className="text-sm text-slate-300">{circuit.notes}</p>}
    </div>
  );
}

function describeTarget(movement: CircuitMovement): string {
  const parts: string[] = [];
  if (movement.target_reps !== null) parts.push(`${movement.target_reps} reps`);
  if (movement.target_seconds !== null) parts.push(formatClock(movement.target_seconds));
  if (movement.target_distance_km !== null) parts.push(formatDistance(movement.target_distance_km));
  if (movement.target_calories !== null) parts.push(`${movement.target_calories} kcal`);
  return parts.join(" · ");
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-200 tabular-nums">{value}</dd>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
      {children}
    </span>
  );
}
