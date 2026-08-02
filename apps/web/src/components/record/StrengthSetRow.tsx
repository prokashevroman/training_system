import clsx from "clsx";
import { useFormContext } from "react-hook-form";
import {
  LOAD_SCOPES,
  LOAD_UNITS,
  SET_TYPES,
  loadStorageHint,
  withholdsKilograms,
  type ManualSessionForm,
} from "../../lib/record-queries.js";
import { ExerciseSelect } from "./ExerciseSelect.js";
import { NumberField, SelectField } from "./fields.js";

/**
 * One set.
 *
 * The load row is the point of the screen: value, unit and scope are three
 * separate answers, and the sentence underneath says what will actually be
 * stored. When the combination cannot yield kilograms (a machine pin, or a bare
 * number with no unit) that sentence is highlighted rather than hidden — the
 * database has CHECK constraints for exactly these cases, so the athlete should
 * see the same rule the schema enforces.
 */
export function StrengthSetRow({
  activityIndex,
  setIndex,
  onRemove,
}: {
  activityIndex: number;
  setIndex: number;
  onRemove: (() => void) | null;
}) {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<ManualSessionForm>();

  const path = <K extends string>(key: K) =>
    `activities.${activityIndex}.sets.${setIndex}.${key}` as const;
  const setErrors = errors.activities?.[activityIndex]?.sets?.[setIndex];

  const unit = watch(path("loadUnit"));
  const scope = watch(path("loadScope"));
  const loadValue = watch(path("loadValue"));
  const withheld = withholdsKilograms(unit, scope);

  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Set {setIndex + 1}
        </p>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-2 py-1 text-xs text-slate-400 hover:text-rose-400"
          >
            Remove
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ExerciseSelect
          rawTextName={path("exerciseRawText")}
          slugName={path("exerciseSlug")}
          error={setErrors?.exerciseRawText?.message}
        />
        <SelectField
          label="Set type"
          options={SET_TYPES}
          registration={register(path("setType"))}
          error={setErrors?.setType?.message}
        />
        <NumberField
          label="Reps"
          placeholder="5"
          registration={register(path("reps"))}
          error={setErrors?.reps?.message}
        />
        <NumberField
          label="Load"
          placeholder="80"
          registration={register(path("loadValue"))}
          error={setErrors?.loadValue?.message}
        />
        <SelectField
          label="Unit"
          options={LOAD_UNITS}
          registration={register(path("loadUnit"))}
          error={setErrors?.loadUnit?.message}
        />
        <SelectField
          label="Load means"
          options={LOAD_SCOPES}
          registration={register(path("loadScope"))}
          error={setErrors?.loadScope?.message}
        />
      </div>

      <p
        className={clsx(
          "mt-2 rounded-lg px-3 py-2 text-xs",
          withheld ? "bg-amber-950/50 text-amber-300" : "bg-slate-900/60 text-slate-400",
        )}
      >
        {loadStorageHint(loadValue, unit, scope)}
      </p>
    </li>
  );
}
