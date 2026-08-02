import { secondsToClock } from "@training/domain";

/**
 * Display helpers shared by the history views and the session detail page.
 *
 * Nothing here invents a value: a null column renders as an em dash rather
 * than a zero, and durations reuse `secondsToClock` from `@training/domain`
 * so the app and the importer agree on what `3532` seconds looks like.
 */

export const EM_DASH = "—";

/** `m:ss`, or `h:mm:ss` past the hour. Null stays visibly absent. */
export function formatClock(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? EM_DASH : secondsToClock(seconds);
}

export function formatPace(secondsPerKm: number | null | undefined): string {
  return secondsPerKm === null || secondsPerKm === undefined
    ? EM_DASH
    : `${secondsToClock(secondsPerKm)} /km`;
}

export function formatSplit500(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? EM_DASH : `${secondsToClock(seconds)} /500 m`;
}

/** Sub-kilometre distances read as metres — "0.4 km" is how nobody says it. */
export function formatDistance(km: number | null | undefined): string {
  if (km === null || km === undefined) return EM_DASH;
  if (km > 0 && km < 1) return `${trimNumber(km * 1000)} m`;
  return `${trimNumber(km)} km`;
}

function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Enum values are snake_case in the database. A few of them have a spelling
 * that title-casing would mangle, so those are named explicitly.
 */
const ENUM_LABEL_OVERRIDES: Record<string, string> = {
  ski_erg: "Ski erg",
  vo2max: "VO2max",
  amrap: "AMRAP",
  emom: "EMOM",
  rir: "RIR",
  rpe: "RPE",
  walking_hiking: "Walking / hiking",
  mobility_recovery: "Mobility / recovery",
  excel_import: "Excel import",
};

export function humanizeEnum(value: string): string {
  const override = ENUM_LABEL_OVERRIDES[value];
  if (override) return override;
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatLocalDate(
  localDate: string,
  options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" },
): string {
  // Noon UTC: a date-only string parsed as midnight can slide to the previous
  // day in a negative-offset timezone.
  return new Date(`${localDate}T12:00:00Z`).toLocaleDateString(undefined, options);
}

export interface ImportLocator {
  sheet: string;
  row: number;
  column: number;
  /** Position of this session within a cell holding several. */
  ordinal: number;
  /** `R17C3` — the workbook coordinate the session came from. */
  cell: string;
}

/**
 * Decodes `import:{sheet}:{row}:{col}:{ordinal}` back into the workbook
 * coordinate, so a questionable row can be checked against the source file.
 * Returns null for anything else (manual entries use `manual:{uuid}`).
 */
export function parseImportLocator(clientRequestKey: string | null): ImportLocator | null {
  if (!clientRequestKey) return null;
  const parts = clientRequestKey.split(":");
  if (parts[0] !== "import" || parts.length < 5) return null;

  const ordinal = Number(parts[parts.length - 1]);
  const column = Number(parts[parts.length - 2]);
  const row = Number(parts[parts.length - 3]);
  if (!Number.isInteger(row) || !Number.isInteger(column) || !Number.isInteger(ordinal))
    return null;

  // The sheet name may itself contain colons, so it is whatever sits between
  // the prefix and the three trailing numbers.
  const sheet = parts.slice(1, parts.length - 3).join(":");
  return { sheet, row, column, ordinal, cell: `R${row}C${column}` };
}
