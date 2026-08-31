import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseCell } from "@training/import-workbook/parse";
import type { SessionDraft } from "../../../../packages/domain/src/session.js";
import type { StrengthSetDraft } from "../../../../packages/domain/src/strength.js";
import type { ParseWarning } from "../../../../packages/domain/src/warnings.js";
import { useAuth } from "./auth.js";
import { queryKeys } from "./queries.js";
import {
  assertExerciseLinksResolvable,
  buildInsertBundle,
  insertSessionBundle,
  unsupportedDraftParts,
  useExerciseLibraryLookup,
  type SaveManualSessionResult,
} from "./record-queries.js";
import { supabase } from "./supabase.js";

/**
 * Paste entry: spreadsheet notation in, structured rows out.
 *
 * This runs the *same* deterministic parser the workbook importer runs —
 * `@training/import-workbook/parse` — rather than a second implementation or a
 * model. The notation being pasted is the notation the workbook is written in,
 * so the nine set-notation matchers, the load-scope rules and the alias
 * resolution are all already correct for it, and they are already pinned by the
 * importer's tests against real cells.
 *
 * Two consequences follow from reusing it, and both are the point:
 *
 * - Ambiguity still produces warnings, not values. `4x165` keeps the number and
 *   no unit; a machine setting never becomes kilograms. The UI shows every
 *   warning before the athlete saves.
 * - Coverage is still explicit. A line the parser cannot claim is reported in
 *   `unconsumedLines` instead of being dropped — the pasted text is also kept
 *   verbatim in `raw_text`, so nothing is ever lost, but the athlete is told
 *   which lines produced no structure.
 *
 * No network call is involved in parsing. The Worker is not in this path at all.
 */

/** The parser wants a cell locator; a paste has none, so this stands in. */
const PASTE_SHEET = "paste";

export interface PastedSession {
  /** Editable before saving; seeded from the parser's own title. */
  title: string;
  draft: SessionDraft;
}

export interface PastedParse {
  sessions: PastedSession[];
  warnings: ParseWarning[];
  /** Lines that produced no structured record. Shown, never hidden. */
  unconsumedLines: string[];
  /** Total strength sets across every session, for the preview summary. */
  setCount: number;
  /** Exercise raw texts no alias resolved, deduplicated in source order. */
  unresolvedExercises: string[];
  /**
   * Parsed detail the insert path has no table for, per session index. Empty
   * when everything parsed can be stored. Non-empty blocks the save rather
   * than writing a session that quietly lost its splits.
   */
  unsupported: { sessionIndex: number; parts: string[] }[];
}

/**
 * One key per *paste*, minted when the preview opens — not per save attempt —
 * so a double-tap cannot write the same sessions twice. The ordinal keeps the
 * key unique when one paste yields several sessions.
 */
export function newPasteRequestKey(): string {
  return `paste:${crypto.randomUUID()}`;
}

function sessionRequestKey(batchKey: string, ordinal: number): string {
  return `${batchKey}:${ordinal}`;
}

const MAX_TITLE_CHARS = 60;

/** The parser titles a session from its first line, which can be a whole set. */
function shortTitle(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_TITLE_CHARS) return flat;
  const cut = flat.slice(0, MAX_TITLE_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Parses pasted text into session drafts. Pure and synchronous: the preview
 * re-runs it on every keystroke.
 */
export function parsePastedText(text: string, localDate: string, batchKey: string): PastedParse {
  if (text.trim() === "") {
    return {
      sessions: [],
      warnings: [],
      unconsumedLines: [],
      setCount: 0,
      unresolvedExercises: [],
      unsupported: [],
    };
  }

  const result = parseCell({
    sheet: PASTE_SHEET,
    row: 1,
    col: 1,
    localDate,
    rawText: text,
  });

  const sessions = result.sessions.map((session, index) => ({
    title: shortTitle(session.title),
    draft: {
      ...session,
      // The parser stamps the import provenance it was written for. A paste is
      // hand-entered, and `session_source` must keep saying how the record
      // really entered the system.
      source: "manual" as const,
      clientRequestKey: sessionRequestKey(batchKey, index + 1),
      // The parser normalizes before splitting — `97,5` becomes `97.5`, `×`
      // becomes `x`, CRLF becomes LF, runs of spaces collapse — and each
      // draft's `rawText` is the *normalized* slice. `raw_text` is the column
      // the schema promises every record stays re-derivable from, so it gets
      // the bytes actually typed.
      //
      // Every session from one paste therefore carries the whole paste. That
      // is deliberate: recovering an exact per-session slice would mean
      // mapping normalized lines back to original ones, and `extractCommutes`
      // reorders lines across units, so the mapping would be a guess. A
      // superset is recoverable; a wrong slice is not.
      rawText: text,
    },
  }));

  const unresolved: string[] = [];
  let setCount = 0;
  for (const { draft } of sessions) {
    for (const activity of draft.activities) {
      for (const set of activity.strengthSets) {
        setCount += 1;
        if (set.exercise.slug === null && !unresolved.includes(set.exercise.rawText)) {
          unresolved.push(set.exercise.rawText);
        }
      }
    }
  }

  const unsupported: { sessionIndex: number; parts: string[] }[] = [];
  sessions.forEach((session, index) => {
    const parts = unsupportedDraftParts(session.draft);
    if (parts.length > 0) unsupported.push({ sessionIndex: index, parts });
  });

  return {
    sessions,
    warnings: result.warnings,
    unconsumedLines: result.unconsumedLines,
    setCount,
    unresolvedExercises: unresolved,
    unsupported,
  };
}

/**
 * Applies the athlete's edits to a parsed draft: the title, and any exercise
 * they resolved by hand. `slugByRawText` only ever *adds* a canonical link —
 * the verbatim `rawText` stays exactly as pasted, so a wrong pick is always
 * re-derivable.
 */
export function applyPasteEdits(
  session: PastedSession,
  slugByRawText: ReadonlyMap<string, string>,
): SessionDraft {
  const title = session.title.trim();
  return {
    ...session.draft,
    title: title === "" ? session.draft.title : title,
    activities: session.draft.activities.map((activity) => ({
      ...activity,
      strengthSets: activity.strengthSets.map((set) => {
        if (set.exercise.slug !== null) return set;
        const picked = slugByRawText.get(set.exercise.rawText);
        if (picked === undefined || picked === "") return set;
        return {
          ...set,
          // Confidence 1 records that a human made this call, not a matcher.
          exercise: { ...set.exercise, slug: picked, confidence: 1 },
        };
      }),
    })),
  };
}

/**
 * A run of identical consecutive sets, collapsed for display only.
 *
 * `3x10 (45kg)` expands to three rows in the database — that is what makes per
 * set editing and volume maths work — but showing three identical rows back to
 * someone who wrote one line is noise. Grouping is presentation; the stored
 * rows are untouched.
 */
export interface PreviewSetGroup {
  exerciseRawText: string;
  slug: string | null;
  setCount: number;
  reps: number | null;
  loadValue: number | null;
  loadUnit: StrengthSetDraft["loadUnit"];
  loadScope: StrengthSetDraft["loadScope"];
  loadKg: number | null;
  side: StrengthSetDraft["side"];
}

export function groupSetsForPreview(sets: readonly StrengthSetDraft[]): PreviewSetGroup[] {
  const groups: PreviewSetGroup[] = [];
  for (const set of sets) {
    const last = groups[groups.length - 1];
    const sameAsLast =
      last !== undefined &&
      last.exerciseRawText === set.exercise.rawText &&
      last.slug === set.exercise.slug &&
      last.reps === set.reps &&
      last.loadValue === set.loadValue &&
      last.loadUnit === set.loadUnit &&
      last.loadScope === set.loadScope &&
      last.side === set.side;

    if (sameAsLast) {
      last.setCount += 1;
      continue;
    }
    groups.push({
      exerciseRawText: set.exercise.rawText,
      slug: set.exercise.slug,
      setCount: 1,
      reps: set.reps,
      loadValue: set.loadValue,
      loadUnit: set.loadUnit,
      loadScope: set.loadScope,
      loadKg: set.loadKg,
      side: set.side,
    });
  }
  return groups;
}

export interface SavePastedResult {
  sessionIds: string[];
  duplicates: number;
}

export function useSavePastedSessions() {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const lookup = useExerciseLibraryLookup();

  return useMutation<
    SavePastedResult,
    Error,
    { sessions: PastedSession[]; slugByRawText: ReadonlyMap<string, string> }
  >({
    mutationFn: async ({ sessions, slugByRawText }) => {
      if (!userId) throw new Error("Not signed in.");
      if (sessions.length === 0) throw new Error("There is nothing to save.");

      // Both checks run over every session before anything is written: a
      // refusal has to happen instead of the save, not half way through it.
      const drafts = sessions.map((session) => applyPasteEdits(session, slugByRawText));
      for (const draft of drafts) {
        assertExerciseLinksResolvable(draft, lookup);
        const parts = unsupportedDraftParts(draft);
        if (parts.length > 0) {
          throw new Error(
            `“${draft.title}” parsed into ${parts.join(" and ")}, which paste entry cannot store yet. Use manual entry for it, or remove those lines.`,
          );
        }
      }

      const written: SaveManualSessionResult[] = [];
      try {
        for (const draft of drafts) {
          const bundle = buildInsertBundle(draft, userId, lookup.idBySlug);
          written.push(await insertSessionBundle(bundle, draft.clientRequestKey));
        }
      } catch (error) {
        // One paste is one action. If the third session fails, the first two
        // must not survive as a partial day — each was its own transaction, so
        // undoing them is this function's job.
        for (const done of written) {
          if (!done.wasDuplicate) {
            await supabase.from("workout_sessions").delete().eq("id", done.sessionId);
          }
        }
        throw error;
      }

      return {
        sessionIds: written.map((w) => w.sessionId),
        duplicates: written.filter((w) => w.wasDuplicate).length,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}
