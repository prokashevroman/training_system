import { useMemo, type ChangeEvent } from "react";
import { useFormContext } from "react-hook-form";
import { useExerciseLibrary } from "../../lib/queries.js";
import type { ManualSessionForm } from "../../lib/record-queries.js";
import { Field } from "./fields.js";

/**
 * Exercise picker.
 *
 * A native `<datalist>` rather than a custom combobox: it gets the phone's own
 * search and keyboard behaviour for free, and — importantly — it does not force
 * a choice. Free text is a legitimate answer, stored verbatim in
 * `exercise_raw_text` with `exercise_id` left null, exactly as the importer
 * records an exercise no alias resolved. The UI says which of the two happened
 * instead of pretending everything matched.
 */

const LIST_ID = "exercise-library";

/** Rendered once per form; every set input points at it via `list=`. */
export function ExerciseLibraryDatalist() {
  const exercises = useExerciseLibrary();
  return (
    <datalist id={LIST_ID}>
      {(exercises.data ?? []).map((exercise) => (
        <option key={exercise.id} value={exercise.name} />
      ))}
    </datalist>
  );
}

interface ExerciseSelectProps {
  rawTextName: `activities.${number}.sets.${number}.exerciseRawText`;
  slugName: `activities.${number}.sets.${number}.exerciseSlug`;
  error?: string | undefined;
}

export function ExerciseSelect({ rawTextName, slugName, error }: ExerciseSelectProps) {
  const { register, setValue, watch } = useFormContext<ManualSessionForm>();
  const exercises = useExerciseLibrary();

  const bySearchName = useMemo(
    () => new Map((exercises.data ?? []).map((e) => [e.name.trim().toLowerCase(), e])),
    [exercises.data],
  );

  const registration = register(rawTextName);
  const rawText = watch(rawTextName);
  const slug = watch(slugName);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    void registration.onChange(event);
    const match = bySearchName.get(event.target.value.trim().toLowerCase());
    setValue(slugName, match?.slug ?? "");
  }

  const hint =
    rawText.trim() === ""
      ? exercises.isLoading
        ? "Loading the exercise library…"
        : `Search ${bySearchName.size} exercises, or type your own.`
      : slug === ""
        ? "Not in the library — stored as typed, with no canonical link."
        : "Linked to the exercise library.";

  return (
    <Field label="Exercise" error={error} hint={hint} className="sm:col-span-2">
      <input
        type="text"
        list={LIST_ID}
        autoComplete="off"
        placeholder="Back squat"
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
        {...registration}
        onChange={onChange}
      />
    </Field>
  );
}
