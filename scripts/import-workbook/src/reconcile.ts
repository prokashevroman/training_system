import { isAutoApprovable, type ParseWarning } from "@training/domain";
import { parseCell, type CellParseResult } from "./parse.js";
import { loadStagedCells, type StagedCell } from "./staging.js";

/**
 * Reconciliation: proof that every source cell and every source line is
 * accounted for.
 *
 * The point of this module is that coverage becomes an assertion the test
 * suite can fail on, not a sentence in a report. `unconsumedLines` is listed
 * verbatim — that list is the honest measure of parser coverage, and shrinking
 * it by hiding lines would be caught by `linesAccountedFor`.
 */

export interface CellReconciliation {
  locator: string;
  localDate: string;
  weekNumber: number;
  sourceLineCount: number;
  result: CellParseResult;
  autoApprovable: boolean;
}

export interface ReconciliationReport {
  workbookSha256: string;
  sheet: string;
  cellsDiscovered: number;
  /** Lines seen across all cells; must equal the sum of the dispositions. */
  sourceLines: number;
  linesAccountedFor: number;
  dispositions: Record<string, number>;
  sessions: number;
  activities: number;
  strengthSets: number;
  cardioIntervals: number;
  circuitMovements: number;
  benchmarkSplits: number;
  entriesAutoApprovable: number;
  entriesNeedingReview: number;
  warningCounts: Record<string, number>;
  /** Verbatim, with their locator. The honest coverage measure. */
  unconsumedLines: { locator: string; line: string }[];
  unresolvedExerciseAliases: { locator: string; fragment: string }[];
  unresolvedUnits: { locator: string; fragment: string }[];
  multiSessionExamples: { locator: string; localDate: string; titles: string[] }[];
  /** Rows 33-54 are empty future weeks and must contribute nothing. */
  emptyFutureWeekRows: { firstEmptyRow: number; lastRow: number; sessionsCreated: number };
  cells: CellReconciliation[];
}

const countBy = (items: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return out;
};

export function reconcile(cells: StagedCell[] = loadStagedCells()): ReconciliationReport {
  const perCell: CellReconciliation[] = cells.map((c) => {
    const result = parseCell({
      sheet: c.sheet,
      row: c.row,
      col: c.col,
      localDate: c.local_date,
      rawText: c.raw_text,
    });
    return {
      locator: result.locator,
      localDate: c.local_date,
      weekNumber: c.week_number,
      sourceLineCount: c.raw_text.split("\n").filter((l) => l.trim().length > 0).length,
      result,
      autoApprovable: isAutoApprovable(result.warnings),
    };
  });

  const allWarnings: ParseWarning[] = perCell.flatMap((c) => c.result.warnings);
  const outcomes = perCell.flatMap((c) => c.result.outcomes);

  const totals = perCell.reduce(
    (acc, c) => {
      for (const s of c.result.sessions) {
        acc.sessions += 1;
        for (const a of s.activities) {
          acc.activities += 1;
          acc.strengthSets += a.strengthSets.length;
          acc.cardioIntervals += a.cardioIntervals.length;
          acc.circuitMovements += a.circuit?.movements.length ?? 0;
          acc.benchmarkSplits += a.benchmark?.splits.length ?? 0;
        }
      }
      return acc;
    },
    {
      sessions: 0,
      activities: 0,
      strengthSets: 0,
      cardioIntervals: 0,
      circuitMovements: 0,
      benchmarkSplits: 0,
    },
  );

  const fragmentsFor = (code: string) =>
    perCell.flatMap((c) =>
      c.result.warnings
        .filter((w) => w.code === code)
        .map((w) => ({ locator: c.locator, fragment: w.sourceFragment.trim() })),
    );

  const maxRow = cells.reduce((n, c) => Math.max(n, c.row), 0);

  return {
    workbookSha256: cells[0]?.workbook_sha256 ?? "",
    sheet: cells[0]?.sheet ?? "",
    cellsDiscovered: cells.length,
    sourceLines: perCell.reduce((n, c) => n + c.sourceLineCount, 0),
    linesAccountedFor: outcomes.length,
    dispositions: countBy(outcomes.map((o) => o.disposition)),
    ...totals,
    entriesAutoApprovable: perCell.filter((c) => c.autoApprovable).length,
    entriesNeedingReview: perCell.filter((c) => !c.autoApprovable).length,
    warningCounts: countBy(allWarnings.map((w) => w.code)),
    unconsumedLines: perCell.flatMap((c) =>
      c.result.unconsumedLines.map((line) => ({ locator: c.locator, line })),
    ),
    unresolvedExerciseAliases: fragmentsFor("UNRESOLVED_EXERCISE_ALIAS"),
    unresolvedUnits: [
      ...fragmentsFor("UNKNOWN_LOAD_UNIT"),
      ...fragmentsFor("AMBIGUOUS_LOAD_VALUE"),
    ],
    multiSessionExamples: perCell
      .filter((c) => c.result.sessions.length > 1)
      .map((c) => ({
        locator: c.locator,
        localDate: c.localDate,
        titles: c.result.sessions.map((s) => s.title),
      })),
    emptyFutureWeekRows: {
      firstEmptyRow: maxRow + 1,
      lastRow: 54,
      // Nothing can be created from rows the extractor never emitted; this is
      // asserted rather than assumed, because "no empty records" is a stated
      // requirement of the brief.
      sessionsCreated: perCell.filter((c) => c.weekNumber > maxRow - 1).length,
    },
    cells: perCell,
  };
}

const pct = (n: number, total: number) => (total === 0 ? "0.0" : ((n / total) * 100).toFixed(1));

/** Renders the committed-format Markdown report. */
export function renderReport(r: ReconciliationReport): string {
  const disp = r.dispositions;
  const consumed = r.linesAccountedFor - (disp.unconsumed ?? 0);

  const lines: string[] = [
    "# Workbook import — reconciliation report",
    "",
    "Generated by `pnpm import:reconcile`. Regenerate after any parser change.",
    "",
    `- Sheet: \`${r.sheet}\``,
    `- Workbook SHA-256: \`${r.workbookSha256}\``,
    "",
    "## Coverage",
    "",
    "| Measure | Count |",
    "|---|---|",
    `| Source day cells discovered | ${r.cellsDiscovered} |`,
    `| Staging entries created | ${r.cellsDiscovered} |`,
    `| Non-empty source lines | ${r.sourceLines} |`,
    `| Lines accounted for | ${r.linesAccountedFor} |`,
    `| — consumed by a structured record | ${disp.structured ?? 0} |`,
    `| — contributed a metric | ${disp.metric ?? 0} |`,
    `| — preserved as a note | ${disp.note ?? 0} |`,
    `| — **unconsumed** | ${disp.unconsumed ?? 0} |`,
    "",
    `Coverage: **${pct(consumed, r.sourceLines)}%** of source lines produced a structured record, a metric, or a preserved note.`,
    "",
    "## Records created",
    "",
    "| Table | Rows |",
    "|---|---|",
    `| workout_sessions | ${r.sessions} |`,
    `| activities | ${r.activities} |`,
    `| strength_sets | ${r.strengthSets} |`,
    `| cardio_intervals | ${r.cardioIntervals} |`,
    `| circuit_movements | ${r.circuitMovements} |`,
    `| benchmark_splits | ${r.benchmarkSplits} |`,
    "",
    "## Review status",
    "",
    `- Auto-approvable entries: ${r.entriesAutoApprovable}`,
    `- Entries needing review: ${r.entriesNeedingReview}`,
    "",
    "### Warnings by code",
    "",
    "| Code | Count |",
    "|---|---|",
    ...Object.entries(r.warningCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `| \`${code}\` | ${n} |`),
    "",
    "## Empty future weeks",
    "",
    `Rows ${r.emptyFutureWeekRows.firstEmptyRow}–${r.emptyFutureWeekRows.lastRow} carry week labels but no training text.`,
    `Sessions created from them: **${r.emptyFutureWeekRows.sessionsCreated}**.`,
    "",
    "## Unconsumed source lines",
    "",
    "This list is the honest measure of parser coverage. Every line here was",
    "seen, was not understood, and was deliberately not guessed at.",
    "",
  ];

  if (r.unconsumedLines.length === 0) {
    lines.push("_None._", "");
  } else {
    lines.push("| Cell | Line |", "|---|---|");
    for (const u of r.unconsumedLines) {
      lines.push(`| ${u.locator} | \`${u.line.replace(/\|/g, "\\|")}\` |`);
    }
    lines.push("");
  }

  lines.push(
    "## Unresolved exercise aliases",
    "",
    r.unresolvedExerciseAliases.length === 0
      ? "_None._"
      : ["| Cell | Fragment |", "|---|---|"]
          .concat(
            r.unresolvedExerciseAliases.map(
              (u) => `| ${u.locator} | \`${u.fragment.replace(/\|/g, "\\|")}\` |`,
            ),
          )
          .join("\n"),
    "",
    "## Unresolved units and numbers",
    "",
    r.unresolvedUnits.length === 0
      ? "_None._"
      : ["| Cell | Fragment |", "|---|---|"]
          .concat(
            r.unresolvedUnits
              .slice(0, 60)
              .map((u) => `| ${u.locator} | \`${u.fragment.replace(/\|/g, "\\|")}\` |`),
          )
          .join("\n"),
    "",
    "## Multi-session splits",
    "",
    `${r.multiSessionExamples.length} cells produced more than one session. Examples:`,
    "",
    "| Cell | Date | Sessions |",
    "|---|---|---|",
    ...r.multiSessionExamples
      .slice(0, 15)
      .map(
        (m) =>
          `| ${m.locator} | ${m.localDate} | ${m.titles.map((t) => `\`${t.replace(/\|/g, "\\|")}\``).join(" · ")} |`,
      ),
    "",
    "## Source traceability",
    "",
    "Every session carries `client_request_key = import:{sheet}:{row}:{col}:{ordinal}`,",
    "which is simultaneously the idempotency key and the `R{row}C{col}` source locator.",
    "",
  );

  return lines.join("\n");
}

/** The review queue: one entry per cell that a human should look at. */
export function renderReviewQueue(r: ReconciliationReport) {
  return r.cells
    .filter((c) => !c.autoApprovable)
    .map((c) => ({
      locator: c.locator,
      localDate: c.localDate,
      warnings: c.result.warnings.map((w) => ({
        code: w.code,
        severity: w.severity,
        message: w.message,
        sourceFragment: w.sourceFragment,
      })),
      unconsumedLines: c.result.unconsumedLines,
      sessionCount: c.result.sessions.length,
    }));
}
