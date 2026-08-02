import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAutoApprovable, SessionDraftSchema } from "@training/domain";
import type { CellParseResult } from "./parse.js";
import { parseCell } from "./parse.js";
import type { StagedCell } from "./staging.js";

/**
 * Writes parsed cells to Supabase.
 *
 * Every cell goes through `public.apply_import_entry` (migration 0011), a
 * single RPC that runs as one transaction: the staging row, the sessions, and
 * the whole nested tree either all land or none do. Rerunning replaces a
 * cell's rows rather than duplicating them, so row counts are stable across
 * runs.
 *
 * The importer uses the service-role key, which bypasses RLS. That is why it
 * runs only from a trusted local machine, why its env file is deliberately not
 * VITE_-prefixed, and why `p_user_id` is passed explicitly rather than derived
 * from a session.
 */

export interface ApplyConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  fileName: string;
  importerVersion: string;
  parserVersion: string;
  dryRun: boolean;
  batchSize: number;
  /** Skip cells before this `R{row}C{col}` locator, for resuming. */
  fromEntry: string | null;
}

export interface ApplyOutcome {
  locator: string;
  sessions: number;
  ok: boolean;
  error: string | null;
}

export interface ApplySummary {
  batchId: string | null;
  cellsScanned: number;
  entriesCreated: number;
  entriesParsed: number;
  entriesReviewRequired: number;
  entriesApplied: number;
  entriesFailed: number;
  sessionsCreated: number;
  outcomes: ApplyOutcome[];
}

/** Validates a cell's drafts before any write is attempted. */
export function validateCell(result: CellParseResult): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const session of result.sessions) {
    const parsed = SessionDraftSchema.safeParse(session);
    if (!parsed.success) {
      errors.push(
        `${result.locator} ${session.clientRequestKey}: ${parsed.error.issues
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

function reviewStatus(result: CellParseResult): string {
  if (result.sessions.length === 0) return "review_required";
  return isAutoApprovable(result.warnings) ? "parsed" : "review_required";
}

export function createServiceClient(config: ApplyConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Parses and (unless dry-run) applies every staged cell.
 *
 * A dry run performs the full parse and validation and writes nothing, so it
 * exercises everything except the database.
 */
export async function applyCells(
  cells: StagedCell[],
  config: ApplyConfig,
  log: (message: string) => void = () => {},
): Promise<ApplySummary> {
  const summary: ApplySummary = {
    batchId: null,
    cellsScanned: 0,
    entriesCreated: 0,
    entriesParsed: 0,
    entriesReviewRequired: 0,
    entriesApplied: 0,
    entriesFailed: 0,
    sessionsCreated: 0,
    outcomes: [],
  };

  const selected = config.fromEntry
    ? cells.slice(cells.findIndex((c) => `R${c.row}C${c.col}` === config.fromEntry))
    : cells;

  if (config.fromEntry && selected.length === cells.length && cells.length > 0) {
    const found = cells.some((c) => `R${c.row}C${c.col}` === config.fromEntry);
    if (!found) throw new Error(`--from-entry ${config.fromEntry} matches no staged cell.`);
  }

  const client = config.dryRun ? null : createServiceClient(config);

  if (client) {
    const { data, error } = await client
      .from("import_batches")
      .insert({
        user_id: config.userId,
        file_name: config.fileName,
        file_sha256: cells[0]?.workbook_sha256 ?? "",
        sheet_name: cells[0]?.sheet ?? "",
        importer_version: config.importerVersion,
        parser_version: config.parserVersion,
        status: "running",
        cells_scanned: selected.length,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not open an import batch: ${error.message}`);
    summary.batchId = (data as { id: string }).id;
    log(`Opened import batch ${summary.batchId}`);
  }

  for (let i = 0; i < selected.length; i += config.batchSize) {
    const chunk = selected.slice(i, i + config.batchSize);

    for (const cell of chunk) {
      summary.cellsScanned += 1;
      const result = parseCell({
        sheet: cell.sheet,
        row: cell.row,
        col: cell.col,
        localDate: cell.local_date,
        rawText: cell.raw_text,
      });

      const validation = validateCell(result);
      const status = reviewStatus(result);
      summary.entriesCreated += 1;
      if (validation.ok) summary.entriesParsed += 1;
      if (status === "review_required") summary.entriesReviewRequired += 1;

      if (!validation.ok) {
        summary.entriesFailed += 1;
        summary.outcomes.push({
          locator: result.locator,
          sessions: 0,
          ok: false,
          error: validation.errors.join(" | "),
        });
        continue;
      }

      if (!client) {
        summary.sessionsCreated += result.sessions.length;
        summary.outcomes.push({
          locator: result.locator,
          sessions: result.sessions.length,
          ok: true,
          error: null,
        });
        continue;
      }

      const { error } = await client.rpc("apply_import_entry", {
        p_user_id: config.userId,
        p_batch_id: summary.batchId,
        p_cell: {
          sheet: cell.sheet,
          row: cell.row,
          col: cell.col,
          week_label: cell.week_label,
          local_date: cell.local_date,
          raw_text: cell.raw_text,
          raw_text_sha256: cell.raw_text_sha256,
          review_status: status,
          warnings: result.warnings,
          unconsumed_lines: result.unconsumedLines,
          extraction: { parserVersion: result.parserVersion, outcomes: result.outcomes },
        },
        p_sessions: result.sessions,
      });

      if (error) {
        summary.entriesFailed += 1;
        summary.outcomes.push({
          locator: result.locator,
          sessions: 0,
          ok: false,
          error: error.message,
        });
        log(`  ${result.locator} FAILED: ${error.message}`);
        continue;
      }

      summary.entriesApplied += 1;
      summary.sessionsCreated += result.sessions.length;
      summary.outcomes.push({
        locator: result.locator,
        sessions: result.sessions.length,
        ok: true,
        error: null,
      });
    }

    log(`  ${Math.min(i + config.batchSize, selected.length)}/${selected.length} cells`);
  }

  if (client && summary.batchId) {
    await client
      .from("import_batches")
      .update({
        status: summary.entriesFailed > 0 ? "failed" : "completed",
        finished_at: new Date().toISOString(),
        entries_created: summary.entriesCreated,
        entries_parsed: summary.entriesParsed,
        entries_review_required: summary.entriesReviewRequired,
        entries_applied: summary.entriesApplied,
        entries_failed: summary.entriesFailed,
        sessions_created: summary.sessionsCreated,
        error_summary:
          summary.entriesFailed > 0
            ? summary.outcomes
                .filter((o) => !o.ok)
                .map((o) => `${o.locator}: ${o.error}`)
                .join("\n")
            : null,
      })
      .eq("id", summary.batchId);
  }

  return summary;
}

/** Row counts for the tables the importer writes, used to prove idempotency. */
export async function countRows(client: SupabaseClient, userId: string) {
  const tables = [
    "import_entries",
    "workout_sessions",
    "activities",
    "strength_sets",
    "cardio_intervals",
    "circuit_results",
    "circuit_movements",
    "benchmark_results",
    "benchmark_splits",
  ] as const;

  const counts: Record<string, number> = {};
  for (const table of tables) {
    const { count, error } = await client
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw new Error(`Could not count ${table}: ${error.message}`);
    counts[table] = count ?? 0;
  }
  return counts;
}
