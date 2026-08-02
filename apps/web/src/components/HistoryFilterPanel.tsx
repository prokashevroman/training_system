import { useExerciseLibrary } from "../lib/queries.js";
import {
  INTENSITY_OPTIONS,
  MODALITY_OPTIONS,
  MOVEMENT_PATTERN_OPTIONS,
  OBJECTIVE_OPTIONS,
  SOURCE_OPTIONS,
  countActiveFilters,
  useBenchmarkDefinitions,
  type HistoryFilters,
} from "../lib/history-queries.js";
import { humanizeEnum } from "./session-format.js";

/**
 * The history filter panel.
 *
 * Every control maps to one field of {@link HistoryFilters}, which
 * `buildHistoryRequest` turns into a Postgres predicate — the panel never
 * filters an array in the browser.
 *
 * Multi-value filters are chips rather than a `<select multiple>`: a multiple
 * select is close to unusable on a phone, and this app is phone-first.
 */
export function HistoryFilterPanel({
  filters,
  onChange,
}: {
  filters: HistoryFilters;
  onChange: (next: HistoryFilters) => void;
}) {
  const exercises = useExerciseLibrary();
  const benchmarks = useBenchmarkDefinitions();
  const activeCount = countActiveFilters(filters);

  const patch = (part: Partial<HistoryFilters>) => onChange({ ...filters, ...part });

  return (
    <details className="rounded-xl border border-slate-800 bg-slate-900/50">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium">
        <span>Filters</span>
        <span className="text-xs text-slate-400">
          {activeCount === 0 ? "none" : `${activeCount} active`}
        </span>
      </summary>

      <div className="space-y-4 border-t border-slate-800 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input
              type="date"
              value={filters.from}
              onChange={(e) => patch({ from: e.target.value })}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={filters.to}
              onChange={(e) => patch({ to: e.target.value })}
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <ChipGroup
          label="Modality"
          options={MODALITY_OPTIONS}
          selected={filters.modalities}
          onToggle={(next) => patch({ modalities: next })}
        />
        <ChipGroup
          label="Objective"
          options={OBJECTIVE_OPTIONS}
          selected={filters.objectives}
          onToggle={(next) => patch({ objectives: next })}
        />
        <ChipGroup
          label="Intensity"
          options={INTENSITY_OPTIONS}
          selected={filters.intensities}
          onToggle={(next) => patch({ intensities: next })}
        />
        <ChipGroup
          label="Source"
          options={SOURCE_OPTIONS}
          selected={filters.sources}
          onToggle={(next) => patch({ sources: next })}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Exercise">
            <select
              value={filters.exerciseId}
              onChange={(e) => patch({ exerciseId: e.target.value })}
              className={INPUT_CLASS}
            >
              <option value="">Any exercise</option>
              {(exercises.data ?? []).map((exercise) => (
                <option key={exercise.id} value={exercise.id}>
                  {exercise.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Movement pattern">
            <select
              value={filters.movementPattern}
              onChange={(e) =>
                patch({ movementPattern: e.target.value as HistoryFilters["movementPattern"] })
              }
              className={INPUT_CLASS}
            >
              <option value="">Any pattern</option>
              {MOVEMENT_PATTERN_OPTIONS.map((pattern) => (
                <option key={pattern} value={pattern}>
                  {humanizeEnum(pattern)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Benchmark">
            <select
              value={filters.benchmark}
              onChange={(e) => patch({ benchmark: e.target.value })}
              className={INPUT_CLASS}
            >
              <option value="">Any session</option>
              <option value="any">Any benchmark</option>
              {(benchmarks.data ?? []).map((definition) => (
                <option key={definition.slug} value={definition.slug}>
                  {definition.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Plan link">
            <select
              value={filters.planned}
              onChange={(e) => patch({ planned: e.target.value as HistoryFilters["planned"] })}
              className={INPUT_CLASS}
            >
              <option value="">Planned or not</option>
              <option value="planned">From a plan</option>
              <option value="unplanned">Not planned</option>
            </select>
          </Field>
        </div>

        <p className="text-xs text-slate-500">
          Exercise and movement pattern match strength sets. Movement pattern needs a set whose
          exercise was matched to the library; free-text sets have no pattern to match.
        </p>
      </div>
    </details>
  );
}

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}

/** Generic over the enum union so a toggled chip keeps its literal type. */
function ChipGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly T[];
  selected: T[];
  onToggle: (next: T[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const isOn = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={isOn}
              onClick={() =>
                onToggle(isOn ? selected.filter((v) => v !== option) : [...selected, option])
              }
              className={`rounded-full px-2.5 py-1 text-xs transition ${
                isOn ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {humanizeEnum(option)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
