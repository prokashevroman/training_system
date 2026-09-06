import { LocalDateSchema } from "./session.js";

/**
 * Leading-date extraction for hand-entered text.
 *
 * The athlete often opens an entry with the day it happened — `31.08:` on its
 * own line, or `31.08: Squats 3x5` inline — because that is how the workbook
 * columns read. The workbook importer gets its dates from the grid, so this
 * helper exists for the *entry* paths (paste, voice transcript, restructuring):
 * it lifts that prefix out as a proper `local_date` and hands back the text the
 * parser should actually see.
 *
 * Day-first on purpose: the source corpus writes `31.08` for 31 August, so
 * `05.06` is 5 June, never May 6. A bare `4.10` line could in principle be a
 * decimal, but a number alone on a line produces no structure anyway, and the
 * extracted date is always shown for correction before anything is saved.
 */

export interface LeadingDate {
  /** `YYYY-MM-DD`, or null when the text does not open with a date. */
  localDate: string | null;
  /** The text with the date prefix removed; identical to the input when null. */
  rest: string;
}

/** `31.08`, `31/08`, `31.08.26`, `31.08.2026` — day first, dot or slash. */
const DAY_FIRST = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Rejects impossible dates (`31.13`) via a UTC round-trip. */
function realDateOrNull(year: number, month: number, day: number): string | null {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
  if (!roundTrips) return null;
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  return LocalDateSchema.safeParse(iso).success ? iso : null;
}

/**
 * Resolves a date token to `YYYY-MM-DD`, or null when it is not a date.
 *
 * A yearless date is placed in the most recent past: training is logged after
 * the fact, so `09.09` typed on 2026-09-06 means last year's 9 September, not a
 * date three days into the future.
 */
export function resolveDateToken(token: string, today: string): string | null {
  const iso = ISO.exec(token);
  if (iso) return realDateOrNull(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = DAY_FIRST.exec(token);
  if (!dayFirst) return null;
  const day = Number(dayFirst[1]);
  const month = Number(dayFirst[2]);
  const rawYear = dayFirst[3];

  if (rawYear !== undefined) {
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    return realDateOrNull(year, month, day);
  }

  const todayYear = Number(today.slice(0, 4));
  const thisYear = realDateOrNull(todayYear, month, day);
  if (thisYear === null) return null;
  // ISO strings order lexicographically, so string comparison is date comparison.
  if (thisYear <= today) return thisYear;
  return realDateOrNull(todayYear - 1, month, day);
}

/**
 * Splits a leading date off the first non-blank line.
 *
 * Two shapes are recognised, both requiring an explicit boundary so a decimal
 * load can never be misread as a date:
 *
 * - the whole line is a date, with an optional trailing `:` or `-`;
 * - the line starts with a date followed by `:` or ` - `, and the remainder of
 *   the line is kept as content.
 */
export function extractLeadingDate(text: string, today: string): LeadingDate {
  const none: LeadingDate = { localDate: null, rest: text };
  const lines = text.split("\n");
  const firstIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstIndex === -1) return none;
  const first = lines[firstIndex]!.trim();

  const wholeLine = /^(.+?)\s*[:-]?$/.exec(first);
  const wholeLineDate = wholeLine ? resolveDateToken(wholeLine[1]!, today) : null;
  if (wholeLineDate !== null) {
    return {
      localDate: wholeLineDate,
      rest: lines.slice(firstIndex + 1).join("\n"),
    };
  }

  const prefixed = /^(.+?)\s*(?::|\s-\s)\s*(\S.*)$/.exec(first);
  if (prefixed) {
    const prefixDate = resolveDateToken(prefixed[1]!, today);
    if (prefixDate !== null) {
      return {
        localDate: prefixDate,
        rest: [prefixed[2]!, ...lines.slice(firstIndex + 1)].join("\n"),
      };
    }
  }

  return none;
}
