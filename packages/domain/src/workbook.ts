/**
 * Date derivation for the source workbook.
 *
 * The week labels are inconsistent free text — `Week 01 Dec 29, 2025 Jan 4`,
 * `Week 09 Feb 23 March 1`, `Week 53 Dec 28 Jan 3, 2027` — with abbreviated
 * and full month names mixed, and the year present only at the two year
 * boundaries. Parsing them as the source of truth would be fragile.
 *
 * Instead the date is *computed* from a single anchor and the label is used
 * only to cross-check:
 *
 *     week_start = 2025-12-29 + 7 x (week_number - 1)
 *
 * That reproduces the month/day text in all 53 labels with zero mismatches, so
 * a future disagreement means the workbook changed shape and the import must
 * stop rather than silently write wrong dates.
 */

export const SHEET_NAME = "Training programm 2026";

/** Monday of Week 01. Every date in the workbook derives from this. */
export const WEEK_ANCHOR_ISO = "2025-12-29";

export const FIRST_DATA_ROW = 2;
export const LAST_DATA_ROW = 32;
/** Row 54 is Week 53; rows 33..54 are empty future weeks. */
export const LAST_LABEL_ROW = 54;
/** Column B..H are Day 1..Day 7, despite the header reading `Column 8`. */
export const FIRST_DAY_COL = 2;
export const LAST_DAY_COL = 8;

const MS_PER_DAY = 86_400_000;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function toUtcMs(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromUtcMs(toUtcMs(iso) + days * MS_PER_DAY);
}

/** Row 2 is Week 01, row 54 is Week 53. */
export function weekNumberForRow(row: number): number {
  return row - 1;
}

/** Column 2 is Day 1 (Monday), column 8 is Day 7 (Sunday). */
export function dayIndexForCol(col: number): number {
  return col - 1;
}

export function weekStartIso(weekNumber: number): string {
  if (weekNumber < 1) throw new Error(`Week number must be >= 1, got ${weekNumber}`);
  return addDays(WEEK_ANCHOR_ISO, 7 * (weekNumber - 1));
}

export function weekEndIso(weekNumber: number): string {
  return addDays(weekStartIso(weekNumber), 6);
}

/** The local date of one day cell. Day 1 = Monday. */
export function cellLocalDate(row: number, col: number): string {
  return addDays(weekStartIso(weekNumberForRow(row)), dayIndexForCol(col) - 1);
}

/** `Monday` … `Sunday`, in UTC (these are calendar dates, not instants). */
export function weekdayName(iso: string): string {
  return WEEKDAYS[new Date(toUtcMs(iso)).getUTCDay()]!;
}

export interface WeekLabelCheck {
  readonly ok: boolean;
  readonly weekNumber: number | null;
  readonly computedStart: string | null;
  readonly computedEnd: string | null;
  /** `{month, day}` pairs read out of the label, in order. */
  readonly labelDates: readonly { month: number; day: number }[];
  readonly problems: readonly string[];
}

/**
 * Cross-checks one free-text week label against the anchor computation.
 *
 * Only month and day are compared: the label omits the year except at the two
 * year boundaries, and `Week 53 Dec 28 Jan 3, 2027` proves the trailing year
 * belongs to the *end* date, not the start.
 */
export function checkWeekLabel(label: string): WeekLabelCheck {
  const problems: string[] = [];

  const weekMatch = /^\s*Week\s+(\d{1,2})\b/i.exec(label);
  if (!weekMatch?.[1]) {
    return {
      ok: false,
      weekNumber: null,
      computedStart: null,
      computedEnd: null,
      labelDates: [],
      problems: [`Label does not start with a week number: ${JSON.stringify(label)}`],
    };
  }
  const weekNumber = Number(weekMatch[1]);

  const labelDates: { month: number; day: number }[] = [];
  const dateRe = /([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/g;
  for (const m of label.matchAll(dateRe)) {
    const month = MONTHS[m[1]!.slice(0, 3).toLowerCase()];
    if (month === undefined) continue;
    labelDates.push({ month, day: Number(m[2]) });
  }

  const computedStart = weekStartIso(weekNumber);
  const computedEnd = weekEndIso(weekNumber);

  if (labelDates.length !== 2) {
    problems.push(`Expected 2 month/day pairs in the label, found ${labelDates.length}`);
  } else {
    const expect = (iso: string) => ({
      month: Number(iso.slice(5, 7)),
      day: Number(iso.slice(8, 10)),
    });
    const [gotStart, gotEnd] = labelDates as [
      { month: number; day: number },
      { month: number; day: number },
    ];
    const wantStart = expect(computedStart);
    const wantEnd = expect(computedEnd);

    if (gotStart.month !== wantStart.month || gotStart.day !== wantStart.day) {
      problems.push(
        `Week ${weekNumber} start: label says ${gotStart.month}/${gotStart.day}, anchor computes ${wantStart.month}/${wantStart.day}`,
      );
    }
    if (gotEnd.month !== wantEnd.month || gotEnd.day !== wantEnd.day) {
      problems.push(
        `Week ${weekNumber} end: label says ${gotEnd.month}/${gotEnd.day}, anchor computes ${wantEnd.month}/${wantEnd.day}`,
      );
    }
  }

  return {
    ok: problems.length === 0,
    weekNumber,
    computedStart,
    computedEnd,
    labelDates,
    problems,
  };
}
