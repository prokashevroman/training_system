import { useFieldArray, useFormContext } from "react-hook-form";
import {
  INTENSITIES,
  MODALITIES,
  OBJECTIVES,
  emptyManualSet,
  type ManualSessionForm,
} from "../../lib/record-queries.js";
import { StrengthSetRow } from "./StrengthSetRow.js";
import { NumberField, SelectField, TextAreaField } from "./fields.js";

/**
 * One activity of a session: what kind of training it was, its optional
 * metrics, and — for strength — its sets.
 *
 * Every metric is optional and blank means "not recorded". Nothing is inferred
 * from another field, so an empty distance never becomes a zero distance.
 */
export function ActivityCard({
  index,
  onRemove,
}: {
  index: number;
  onRemove: (() => void) | null;
}) {
  const {
    control,
    register,
    watch,
    formState: { errors },
  } = useFormContext<ManualSessionForm>();

  const sets = useFieldArray({ control, name: `activities.${index}.sets` as const });
  const path = <K extends string>(key: K) => `activities.${index}.${key}` as const;
  const activityErrors = errors.activities?.[index];
  const modality = watch(path("modality"));
  const isStrength = modality === "strength";

  return (
    <fieldset className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <legend className="px-1 text-sm font-medium text-slate-300">Activity {index + 1}</legend>

      <div className="flex items-start justify-end">
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-2 py-1 text-xs text-slate-400 hover:text-rose-400"
          >
            Remove activity
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SelectField
          label="Modality"
          options={MODALITIES}
          registration={register(path("modality"))}
          error={activityErrors?.modality?.message}
        />
        <SelectField
          label="Objective"
          options={OBJECTIVES}
          registration={register(path("objective"))}
          error={activityErrors?.objective?.message}
        />
        <SelectField
          label="Intensity"
          options={INTENSITIES}
          registration={register(path("intensity"))}
          error={activityErrors?.intensity?.message}
        />
        <NumberField
          label="Duration (min)"
          placeholder="45"
          registration={register(path("durationMinutes"))}
          error={activityErrors?.durationMinutes?.message}
        />
        <NumberField
          label="Distance (km)"
          placeholder="8.2"
          registration={register(path("distanceKm"))}
          error={activityErrors?.distanceKm?.message}
        />
        <NumberField
          label="Calories"
          placeholder="480"
          registration={register(path("calories"))}
          error={activityErrors?.calories?.message}
        />
        <NumberField
          label="Avg HR (bpm)"
          placeholder="142"
          registration={register(path("avgHeartRateBpm"))}
          error={activityErrors?.avgHeartRateBpm?.message}
        />
        <NumberField
          label="Cadence (spm)"
          placeholder="86"
          registration={register(path("cadenceSpm"))}
          error={activityErrors?.cadenceSpm?.message}
        />
      </div>

      <TextAreaField
        label="Activity notes"
        rows={2}
        className="mt-3"
        registration={register(path("notes"))}
        error={activityErrors?.notes?.message}
      />

      {isStrength ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Sets</p>
          <ul className="space-y-2">
            {sets.fields.map((field, setIndex) => (
              <StrengthSetRow
                key={field.id}
                activityIndex={index}
                setIndex={setIndex}
                onRemove={() => sets.remove(setIndex)}
              />
            ))}
          </ul>
          <button
            type="button"
            onClick={() => sets.append(emptyManualSet())}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600"
          >
            Add set
          </button>
        </div>
      ) : (
        sets.fields.length > 0 && (
          // The sets are still in the form, so switching back keeps them; saying
          // so is better than silently discarding work on save.
          <p
            role="alert"
            className="mt-4 rounded-lg bg-amber-950/50 px-3 py-2 text-xs text-amber-300"
          >
            {sets.fields.length} set{sets.fields.length === 1 ? "" : "s"} entered while this was a
            strength activity. Sets are only saved for strength — switch the modality back to keep
            them, or remove the activity.
          </p>
        )
      )}
    </fieldset>
  );
}
