import clsx from "clsx";
import { useState } from "react";
import {
  parseImportWarnings,
  useReviewImportEntry,
  type ImportEntryRow,
} from "../../lib/record-queries.js";
import { enumLabel } from "./labels.js";

/**
 * One staged workbook cell, shown in full.
 *
 * Three things are deliberately never summarised: the raw text (verbatim, with
 * its line breaks), every warning the parser emitted, and the lines no matcher
 * consumed. The last of those is the honest measure of parser coverage — a
 * reviewer who cannot see it cannot tell an accurate parse from a lossy one.
 */

const SEVERITY_STYLE: Record<string, string> = {
  info: "bg-slate-800 text-slate-300",
  warning: "bg-amber-950 text-amber-300",
  error: "bg-rose-950 text-rose-300",
};

const STATUS_STYLE: Record<string, string> = {
  review_required: "bg-amber-950 text-amber-300",
  approved: "bg-emerald-950 text-emerald-300",
  applied: "bg-emerald-950 text-emerald-300",
  rejected: "bg-rose-950 text-rose-300",
  failed: "bg-rose-950 text-rose-300",
};

export function ImportEntryCard({ entry }: { entry: ImportEntryRow }) {
  const review = useReviewImportEntry();
  const [notes, setNotes] = useState(entry.review_notes ?? "");
  const { warnings, unrecognized } = parseImportWarnings(entry.warnings);

  return (
    <article className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">
          {entry.cell_ref}
        </span>
        <span className="text-sm text-slate-300">{entry.inferred_local_date ?? "no date"}</span>
        {entry.week_label && <span className="text-xs text-slate-500">{entry.week_label}</span>}
        <span
          className={clsx(
            "ml-auto rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide",
            STATUS_STYLE[entry.review_status] ?? "bg-slate-800 text-slate-400",
          )}
        >
          {enumLabel(entry.review_status)}
        </span>
      </header>

      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Source cell</p>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200">
          {entry.raw_text}
        </pre>
      </div>

      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">
          Unconsumed lines ({entry.unconsumed_lines.length})
        </p>
        {entry.unconsumed_lines.length === 0 ? (
          <p className="rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-500">
            None — every line of this cell produced a structured record.
          </p>
        ) : (
          <ul className="space-y-1">
            {entry.unconsumed_lines.map((line, index) => (
              <li
                key={`${index}-${line}`}
                className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 font-mono text-xs text-amber-200"
              >
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">
          Warnings ({warnings.length + unrecognized.length})
        </p>
        {warnings.length === 0 && unrecognized.length === 0 ? (
          <p className="rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-500">
            None.
          </p>
        ) : (
          <ul className="space-y-2">
            {warnings.map((warning, index) => (
              <li
                key={`${index}-${warning.code}`}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={clsx(
                      "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                      SEVERITY_STYLE[warning.severity],
                    )}
                  >
                    {warning.severity}
                  </span>
                  <span className="font-mono text-xs text-slate-400">{warning.code}</span>
                </div>
                <p className="mt-1.5 text-sm text-slate-200">{warning.message}</p>
                {warning.sourceFragment !== "" && (
                  <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded bg-slate-950 p-2 font-mono text-[11px] text-slate-400">
                    {warning.sourceFragment}
                  </pre>
                )}
              </li>
            ))}
            {unrecognized.map((item, index) => (
              // A warning whose shape the app does not recognize is still
              // evidence, so it is printed raw rather than dropped.
              <li
                key={`unrecognized-${index}`}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
              >
                <p className="text-xs text-slate-500">Unrecognized warning shape</p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-slate-400">
                  {JSON.stringify(item, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>

      {entry.reviewed_at && (
        <p className="text-xs text-slate-500">
          Reviewed {new Date(entry.reviewed_at).toLocaleString()}
          {entry.review_notes ? ` — ${entry.review_notes}` : ""}
        </p>
      )}

      <div className="space-y-2 border-t border-slate-800 pt-3">
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
            Review note
          </span>
          <textarea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Why this was approved or rejected."
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={review.isPending}
            onClick={() => review.mutate({ id: entry.id, decision: "approved", notes })}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={review.isPending}
            onClick={() => review.mutate({ id: entry.id, decision: "rejected", notes })}
            className="rounded-lg border border-rose-800 px-3 py-1.5 text-xs font-medium text-rose-300 disabled:opacity-50"
          >
            Reject
          </button>
          <p className="self-center text-xs text-slate-500">
            Approving records the decision only; applying it to the log stays with the importer.
          </p>
        </div>

        {review.isError && (
          <p role="alert" className="rounded-lg bg-rose-950/60 px-3 py-2 text-xs text-rose-300">
            Could not update: {review.error.message}
          </p>
        )}
      </div>
    </article>
  );
}
