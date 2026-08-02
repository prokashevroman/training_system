import { z } from "zod";
import { ActivityDraftSchema } from "./activity.js";
import { SessionSourceEnum, SessionStatusEnum } from "./enums.js";
import { ParseWarningSchema } from "./warnings.js";

/** ISO calendar date in the athlete's local timezone, `YYYY-MM-DD`. */
export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "local_date must be YYYY-MM-DD");

/**
 * One logically coherent completed session.
 *
 * `clientRequestKey` is both the idempotency key and the source locator. For
 * imports it is `import:{sheet}:{row}:{col}:{ordinal}`, so every row in the
 * database resolves back to the workbook cell it came from and rerunning the
 * import upserts instead of duplicating.
 */
export const SessionDraftSchema = z.object({
  localDate: LocalDateSchema,
  startedAt: z.string().datetime({ offset: true }).nullable().default(null),
  title: z.string().min(1),
  source: SessionSourceEnum.schema,
  /** Verbatim source text for this session. Never discarded. */
  rawText: z.string(),
  transcript: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  durationSeconds: z.number().nullable().default(null),
  sessionRpe: z.number().nullable().default(null),
  status: SessionStatusEnum.schema.default("completed"),
  clientRequestKey: z.string().min(1),
  activities: z.array(ActivityDraftSchema).min(1),
  tags: z.array(z.string()).default([]),
});
export type SessionDraft = z.infer<typeof SessionDraftSchema>;

/**
 * The result of parsing one unit of source text (a workbook cell, or later a
 * voice transcript).
 *
 * `unconsumedLines` is the load-bearing field. Acceptance criterion 9 requires
 * that every one of the 550 non-empty source lines is either consumed by a
 * structured record or listed here — that is asserted by a test, so parser
 * coverage cannot quietly regress into prose.
 */
export const ParseResultSchema = z.object({
  sessions: z.array(SessionDraftSchema).default([]),
  warnings: z.array(ParseWarningSchema).default([]),
  /** Source lines that produced no structured record. */
  unconsumedLines: z.array(z.string()).default([]),
  /** Source lines a structured record was built from. */
  consumedLines: z.array(z.string()).default([]),
  parserVersion: z.string(),
});
export type ParseResult = z.infer<typeof ParseResultSchema>;

/** Builds the deterministic import locator used as `clientRequestKey`. */
export function importRequestKey(sheet: string, row: number, col: number, ordinal: number): string {
  return `import:${sheet}:${row}:${col}:${ordinal}`;
}

/** Human-facing `R{row}C{col}` locator, as used throughout the reports. */
export function cellLocator(row: number, col: number): string {
  return `R${row}C${col}`;
}

/** Inverse of {@link importRequestKey}; null when the key is not an import key. */
export function parseImportRequestKey(
  key: string,
): { sheet: string; row: number; col: number; ordinal: number } | null {
  // The sheet name contains spaces but no colons, so anchoring the three
  // trailing numeric segments is unambiguous.
  const m = /^import:(.+):(\d+):(\d+):(\d+)$/.exec(key);
  if (!m?.[1]) return null;
  return { sheet: m[1], row: Number(m[2]), col: Number(m[3]), ordinal: Number(m[4]) };
}
