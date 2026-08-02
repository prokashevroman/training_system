import type { BenchmarkResult, BenchmarkSplit } from "@training/db-types";
import {
  EM_DASH,
  formatClock,
  formatDistance,
  formatPace,
  humanizeEnum,
} from "./session-format.js";

export type BenchmarkWithSplits = BenchmarkResult & { benchmark_splits: BenchmarkSplit[] };

/**
 * A benchmark result and its splits.
 *
 * The splits are the delicate part. The workbook records what the athlete's
 * watch showed, which for Murph means "10:41 after starting the pull-ups" —
 * a cumulative clock reading, not the duration of the pull-ups. Those rows
 * carry `is_cumulative = true` and are labelled as elapsed times here, because
 * reading them as durations would understate the pull-ups and overstate the
 * push-ups.
 *
 * `split_seconds` stays null for every one of them: subtracting consecutive
 * cumulative readings only works when they share a reference frame and nothing
 * in between is missing, which the source does not guarantee. So the column
 * shows an em dash rather than an arithmetic guess.
 */
export function BenchmarkDetail({
  benchmark,
  /** Library name for `definition_slug`; the slug itself is the fallback. */
  name,
}: {
  benchmark: BenchmarkWithSplits;
  name?: string;
}) {
  const splits = [...benchmark.benchmark_splits].sort((a, b) => a.split_order - b.split_order);
  const hasCumulative = splits.some((split) => split.is_cumulative);

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{name ?? benchmark.definition_slug}</p>
        <p className="text-xs text-slate-400">
          Scored by {humanizeEnum(benchmark.scoring).toLowerCase()}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Total time" value={formatClock(benchmark.total_seconds)} />
        <Metric
          label="Vest"
          value={benchmark.vest_kg === null ? EM_DASH : `${benchmark.vest_kg} kg`}
        />
        <Metric label="Partition" value={benchmark.partition_strategy ?? EM_DASH} />
        <Metric
          label="Rounds"
          value={benchmark.rounds_completed === null ? EM_DASH : String(benchmark.rounds_completed)}
        />
        {benchmark.score && <Metric label="Score" value={benchmark.score} />}
        {benchmark.variant_label && <Metric label="Variant" value={benchmark.variant_label} />}
        {benchmark.as_prescribed !== null && (
          <Metric label="As prescribed" value={benchmark.as_prescribed ? "Yes" : "No"} />
        )}
      </dl>

      {benchmark.notes && <p className="text-sm text-slate-300">{benchmark.notes}</p>}

      {splits.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-left uppercase tracking-wide text-slate-500">
                <th className="py-1.5 pr-2 font-medium">Split</th>
                <th className="py-1.5 pr-2 font-medium">Work</th>
                <th className="py-1.5 pr-2 font-medium">Time</th>
                <th className="py-1.5 pr-2 font-medium">Split time</th>
                <th className="py-1.5 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {splits.map((split) => (
                <tr key={split.id} className="border-b border-slate-800/60 align-top">
                  <td className="py-1.5 pr-2">
                    <span className="text-slate-200">{split.label}</span>
                    <span className="ml-1 text-slate-600 tabular-nums">#{split.split_order}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-slate-300 tabular-nums">{describeWork(split)}</td>
                  <td className="py-1.5 pr-2 tabular-nums">
                    <span className="text-slate-200">{formatClock(split.elapsed_seconds)}</span>
                    {split.is_cumulative ? (
                      <span
                        className="ml-1.5 rounded bg-amber-950/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300"
                        title={`Elapsed clock time measured from ${humanizeEnum(
                          split.reference_frame,
                        ).toLowerCase()}, not the duration of this movement`}
                      >
                        cumulative
                      </span>
                    ) : (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                        segment
                      </span>
                    )}
                  </td>
                  {/* Never computed: see the note under the table. */}
                  <td className="py-1.5 pr-2 text-slate-500 tabular-nums">
                    {split.split_seconds === null ? EM_DASH : formatClock(split.split_seconds)}
                  </td>
                  <td className="py-1.5 font-mono text-[11px] text-slate-500">
                    {split.original_text || EM_DASH}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasCumulative && (
        <p className="rounded-lg bg-amber-950/40 px-3 py-2 text-xs text-amber-200/90">
          Rows marked <span className="font-medium">cumulative</span> are elapsed clock readings
          taken from the reference point the workbook used, not the duration of that movement. The
          per-movement split time is not recoverable from the source, so it is left blank rather
          than derived by subtraction.
        </p>
      )}
    </div>
  );
}

/** Reps, distance or pace — whichever the split actually recorded. */
function describeWork(split: BenchmarkSplit): string {
  const parts: string[] = [];
  if (split.reps !== null) parts.push(`${split.reps} reps`);
  if (split.distance_km !== null) parts.push(formatDistance(split.distance_km));
  if (split.pace_seconds_per_km !== null) parts.push(formatPace(split.pace_seconds_per_km));
  if (split.cadence_spm !== null) parts.push(`${split.cadence_spm} spm`);
  if (split.heart_rate_bpm !== null) parts.push(`${split.heart_rate_bpm} bpm`);
  return parts.length ? parts.join(" · ") : EM_DASH;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-200 tabular-nums">{value}</dd>
    </div>
  );
}
