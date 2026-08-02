import clsx from "clsx";
import { useState } from "react";
import { ImportEntryCard } from "../components/record/ImportEntryCard.js";
import { enumLabel } from "../components/record/labels.js";
import {
  REVIEW_STATUSES,
  useImportEntries,
  useImportEntrySummary,
  type ReviewFilter,
} from "../lib/record-queries.js";

/**
 * Import review: the queue of workbook cells the parser was not confident about.
 *
 * It opens on `review_required` because that is the only list with work in it,
 * but every status stays reachable — including `parsed`, so a parse that was
 * accepted automatically can still be audited against its source cell.
 */
export function ImportReview() {
  const [filter, setFilter] = useState<ReviewFilter>("review_required");
  const summary = useImportEntrySummary();
  const entries = useImportEntries(filter);

  const counts = summary.data?.byStatus;
  const chips: { value: ReviewFilter; count: number | null }[] = [
    { value: "all", count: summary.data?.total ?? null },
    ...REVIEW_STATUSES.filter((status) => (counts?.get(status) ?? 0) > 0).map((status) => ({
      value: status satisfies ReviewFilter,
      count: counts?.get(status) ?? 0,
    })),
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Import review</h1>
        <p className="text-sm text-slate-400">
          {summary.data
            ? `${summary.data.total} staged cells from the workbook, ${summary.data.withUnconsumed} with lines no parser consumed.`
            : "Staged cells from the workbook."}
        </p>
      </header>

      {summary.isError && (
        <p role="alert" className="rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
          Could not load the summary: {(summary.error as Error).message}
        </p>
      )}

      <nav className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => setFilter(chip.value)}
            aria-current={filter === chip.value}
            className={clsx(
              "rounded-full border px-3 py-1 text-xs",
              filter === chip.value
                ? "border-sky-500 bg-sky-950/60 text-sky-300"
                : "border-slate-700 text-slate-400 hover:border-slate-600",
            )}
          >
            {chip.value === "all" ? "All" : enumLabel(chip.value)}
            {chip.count !== null && <span className="ml-1.5 tabular-nums">{chip.count}</span>}
          </button>
        ))}
      </nav>

      {entries.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {entries.isError && (
        <p role="alert" className="rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
          Could not load entries: {(entries.error as Error).message}
        </p>
      )}

      {entries.data?.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
          Nothing in this list.
        </p>
      )}

      <div className="space-y-4">
        {entries.data?.map((entry) => (
          <ImportEntryCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
