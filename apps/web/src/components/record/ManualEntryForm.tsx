import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import {
  ManualSessionSchema,
  emptyManualActivity,
  emptyManualSession,
  newManualRequestKey,
  useSaveManualSession,
  type ManualSessionForm as ManualSessionFormValues,
  type SaveManualSessionResult,
} from "../../lib/record-queries.js";
import { ActivityCard } from "./ActivityCard.js";
import { ExerciseLibraryDatalist } from "./ExerciseSelect.js";
import { NumberField, TextAreaField, TextField } from "./fields.js";

/**
 * Manual session entry.
 *
 * The idempotency key belongs to the *draft*, not to the request: it is created
 * once when the form mounts and only replaced after a session has been written.
 * `unique (user_id, client_request_key)` then turns a double-tap into a
 * duplicate the save recognizes, instead of two identical sessions.
 */
export function ManualEntryForm({ onCancel }: { onCancel: () => void }) {
  const save = useSaveManualSession();
  const [saved, setSaved] = useState<SaveManualSessionResult | null>(null);
  const requestKey = useRef(newManualRequestKey());

  const form = useForm<ManualSessionFormValues>({
    resolver: zodResolver(ManualSessionSchema),
    defaultValues: emptyManualSession(),
  });
  const activities = useFieldArray({ control: form.control, name: "activities" });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    save.mutate(
      { form: values, requestKey: requestKey.current },
      {
        onSuccess: (result) => {
          setSaved(result);
          // A new draft needs a new key, or the next session would collide with
          // the one just written.
          requestKey.current = newManualRequestKey();
          form.reset(emptyManualSession());
        },
      },
    );
  });

  return (
    <FormProvider {...form}>
      <ExerciseLibraryDatalist />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {saved && (
          <div className="rounded-xl border border-emerald-900 bg-emerald-950/50 p-3 text-sm text-emerald-300">
            <p>
              {saved.wasDuplicate
                ? "Already saved — this tap matched a session that was written a moment ago."
                : "Session saved."}{" "}
              <Link to={`/sessions/${saved.sessionId}`} className="underline">
                Open it
              </Link>
              .
            </p>
          </div>
        )}

        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TextField
              label="Date"
              type="date"
              registration={form.register("localDate")}
              error={errors.localDate?.message}
            />
            <TextField
              label="Title"
              placeholder="Lower body strength"
              className="col-span-2"
              registration={form.register("title")}
              error={errors.title?.message}
            />
            <NumberField
              label="Duration (min)"
              placeholder="70"
              registration={form.register("durationMinutes")}
              error={errors.durationMinutes?.message}
            />
            <NumberField
              label="Session RPE"
              hint="0–10, optional"
              placeholder="7"
              registration={form.register("sessionRpe")}
              error={errors.sessionRpe?.message}
            />
          </div>
          <TextAreaField
            label="Notes"
            placeholder="How it went, in your own words. Kept verbatim."
            registration={form.register("notes")}
            error={errors.notes?.message}
          />
        </section>

        {activities.fields.map((field, index) => (
          <ActivityCard
            key={field.id}
            index={index}
            onRemove={activities.fields.length > 1 ? () => activities.remove(index) : null}
          />
        ))}

        {errors.activities?.root?.message && (
          <p role="alert" className="text-xs text-rose-400">
            {errors.activities.root.message}
          </p>
        )}

        <button
          type="button"
          onClick={() => activities.append(emptyManualActivity("strength"))}
          className="w-full rounded-lg border border-dashed border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-600"
        >
          Add activity
        </button>

        {save.isError && (
          <p role="alert" className="rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
            Could not save: {save.error.message}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="flex-1 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save session"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300"
          >
            Cancel
          </button>
        </div>
      </form>
    </FormProvider>
  );
}
