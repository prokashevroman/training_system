import type { WorkoutSession } from "@training/db-types";
import {
  LocalDateSchema,
  SessionStatusEnum,
  clockToSeconds,
  parseDecimal,
  secondsToClock,
} from "@training/domain";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useUpdateSession, type SessionEditPatch } from "../lib/history-queries.js";
import { humanizeEnum } from "./session-format.js";

/**
 * Inline editing of the session-level fields.
 *
 * Numbers stay strings inside the form: React Hook Form hands back `""` for a
 * cleared input, and coercing that to 0 would record a session RPE of zero the
 * athlete never gave. `""` means "not recorded" all the way to the null that
 * Postgres stores.
 *
 * Duration is typed as a clock (`58:52`) rather than as decimal minutes so the
 * Murph's 3532 seconds survives a round trip unchanged; a bare number is read
 * as whole minutes, which is how a gym session is usually remembered.
 */

const DURATION_HINT = "m:ss or h:mm:ss, or whole minutes";

export const SessionEditSchema = z.object({
  title: z.string().trim().min(1, "Give the session a title"),
  localDate: LocalDateSchema,
  status: SessionStatusEnum.schema,
  notes: z.string(),
  sessionRpe: z
    .string()
    .trim()
    .superRefine((text, ctx) => {
      if (text === "") return;
      const value = parseDecimal(text);
      if (value === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Session RPE must be a number" });
        return;
      }
      if (value < 0 || value > 10) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Session RPE runs from 0 to 10" });
      }
    }),
  duration: z
    .string()
    .trim()
    .superRefine((text, ctx) => {
      if (text === "") return;
      if (durationTextToSeconds(text) === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duration must be ${DURATION_HINT}` });
      }
    }),
});

export type SessionEditForm = z.infer<typeof SessionEditSchema>;

/** `""` → null, `58:52` → 3532, `45` → 2700. Null also means "unparseable". */
export function durationTextToSeconds(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed.includes(":")) return clockToSeconds(trimmed);
  const minutes = parseDecimal(trimmed);
  return minutes === null || minutes < 0 ? null : Math.round(minutes * 60);
}

export function sessionToEditForm(session: WorkoutSession): SessionEditForm {
  return {
    title: session.title,
    localDate: session.local_date,
    status: session.status,
    notes: session.notes ?? "",
    sessionRpe: session.session_rpe === null ? "" : String(session.session_rpe),
    duration: session.duration_seconds === null ? "" : secondsToClock(session.duration_seconds),
  };
}

/** An empty field becomes null: the athlete cleared it, they did not enter 0. */
export function editFormToPatch(form: SessionEditForm): SessionEditPatch {
  const rpe = form.sessionRpe.trim();
  return {
    title: form.title.trim(),
    local_date: form.localDate,
    status: form.status,
    notes: form.notes.trim() === "" ? null : form.notes.trim(),
    session_rpe: rpe === "" ? null : parseDecimal(rpe),
    duration_seconds: durationTextToSeconds(form.duration),
  };
}

export function SessionEditFields({
  session,
  onClose,
}: {
  session: WorkoutSession;
  onClose: () => void;
}) {
  const update = useUpdateSession(session.id);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SessionEditForm>({
    resolver: zodResolver(SessionEditSchema),
    defaultValues: sessionToEditForm(session),
  });

  const onSubmit = handleSubmit(async (form) => {
    await update.mutateAsync(editFormToPatch(form));
    onClose();
  });

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4"
    >
      <Field label="Title" error={errors.title?.message}>
        <input {...register("title")} className={INPUT_CLASS} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" error={errors.localDate?.message}>
          <input type="date" {...register("localDate")} className={INPUT_CLASS} />
        </Field>
        <Field label="Status" error={errors.status?.message}>
          <select {...register("status")} className={INPUT_CLASS}>
            {SessionStatusEnum.values.map((status) => (
              <option key={status} value={status}>
                {humanizeEnum(status)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Session RPE"
          error={errors.sessionRpe?.message}
          hint="0–10, blank if not rated"
        >
          <input {...register("sessionRpe")} inputMode="decimal" className={INPUT_CLASS} />
        </Field>
        <Field label="Duration" error={errors.duration?.message} hint={DURATION_HINT}>
          <input {...register("duration")} placeholder="58:52" className={INPUT_CLASS} />
        </Field>
      </div>

      <Field label="Notes" error={errors.notes?.message}>
        <textarea {...register("notes")} rows={3} className={INPUT_CLASS} />
      </Field>

      {update.isError && (
        <p role="alert" className="rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
          Could not save: {(update.error as Error).message}
        </p>
      )}

      <p className="text-xs text-slate-500">
        Sets, intervals and splits are not editable here — they are parsed from the source text,
        which stays visible below.
      </p>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100";

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-xs text-rose-400">
          {error}
        </span>
      )}
    </label>
  );
}
