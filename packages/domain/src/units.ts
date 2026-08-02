import { z } from "zod";
import type { DistanceUnit, LoadUnit } from "./enums.js";

/**
 * Unit handling for the import pipeline and, later, the voice parser.
 *
 * The governing rule: convert only when the source stated a unit. A bare
 * number keeps `value: null` and reports why. `isExact` records whether the
 * conversion was definitional or whether something had to be assumed — an
 * inexact conversion is a fact about the *source*, not about float precision.
 */

/** Exact by international definition (1959 international pound). */
export const LB_TO_KG = 0.45359237;
/** Exact by international definition (international mile). */
export const MI_TO_KM = 1.609344;

export const ConvertedValueSchema = z.object({
  /** Canonical value, or null when the source did not support conversion. */
  value: z.number().nullable(),
  originalValue: z.number(),
  originalUnit: z.string(),
  /**
   * True when the conversion is definitional and no unit was assumed. False
   * when a unit had to be inferred or the source marked the value approximate.
   */
  isExact: z.boolean(),
  /** Set when `value` is null, explaining the refusal to guess. */
  reason: z.string().optional(),
});
export type ConvertedValue = z.infer<typeof ConvertedValueSchema>;

const round = (n: number, dp: number): number => {
  const f = 10 ** dp;
  // Nudge by Number.EPSILON so values sitting exactly on a rounding boundary
  // (e.g. 2.675 stored as 2.67499...) round the way a human would expect.
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
};

/**
 * Normalizes a load to kilograms. Returns `value: null` for `none` — a bare
 * `4x165` could be pounds or kilograms and the difference is 90 kg.
 */
export function toKilograms(
  originalValue: number,
  originalUnit: LoadUnit,
  opts: { approximate?: boolean } = {},
): ConvertedValue {
  const exact = !opts.approximate;
  switch (originalUnit) {
    case "kg":
      return { value: round(originalValue, 2), originalValue, originalUnit, isExact: exact };
    case "lb":
      return {
        value: round(originalValue * LB_TO_KG, 2),
        originalValue,
        originalUnit,
        isExact: exact,
      };
    case "none":
      return {
        value: null,
        originalValue,
        originalUnit,
        isExact: false,
        reason: "Load has no unit in the source; kg and lb differ too much to guess.",
      };
  }
}

/**
 * Normalizes a distance to kilometres. `floors` and `steps` are real units in
 * this corpus (`46 floors`, `19+K steps`) but are not distances — they stay
 * unconverted rather than being turned into a fabricated kilometre figure.
 */
export function toKilometres(
  originalValue: number,
  originalUnit: DistanceUnit,
  opts: { approximate?: boolean } = {},
): ConvertedValue {
  const exact = !opts.approximate;
  switch (originalUnit) {
    case "km":
      return { value: round(originalValue, 3), originalValue, originalUnit, isExact: exact };
    case "m":
      return { value: round(originalValue / 1000, 3), originalValue, originalUnit, isExact: exact };
    case "mi":
      return {
        value: round(originalValue * MI_TO_KM, 3),
        originalValue,
        originalUnit,
        isExact: exact,
      };
    case "floors":
    case "steps":
      return {
        value: null,
        originalValue,
        originalUnit,
        isExact: false,
        reason: `'${originalUnit}' is not a distance; converting it would invent a number.`,
      };
  }
}

/**
 * Parses `mm:ss` or `h:mm:ss` into seconds. Used for durations (`58:52`),
 * paces (`6:49 per km`) and rowing splits (`2:14.9/500m`), which share a shape.
 *
 * Returns null rather than throwing: unparseable timing is a warning, not a
 * crash.
 */
export function clockToSeconds(text: string): number | null {
  const trimmed = text.trim();
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/.exec(trimmed);
  if (!m) return null;

  const hours = m[1] ? Number(m[1]) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  // Only the leading component may exceed its natural range (a 90:00 pace is
  // legitimate shorthand); interior components must be real clock values.
  if (seconds >= 60) return null;
  if (m[1] && minutes >= 60) return null;

  return round(hours * 3600 + minutes * 60 + seconds, 1);
}

/** Inverse of {@link clockToSeconds}, always `m:ss` or `h:mm:ss`. */
export function secondsToClock(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.abs(totalSeconds);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = round(abs % 60, 1);
  const ss = String(Math.floor(seconds)).padStart(2, "0");
  const frac = seconds % 1 ? String(round(seconds % 1, 1)).slice(1) : "";
  return hours > 0
    ? `${sign}${hours}:${String(minutes).padStart(2, "0")}:${ss}${frac}`
    : `${sign}${minutes}:${ss}${frac}`;
}

/**
 * Parses spoken/written duration phrases seen in the corpus:
 * `95 min.`, `50 min`, `30 minutes`, `1.5 hours`, `1 hour 20 minutes`,
 * `2 hours`, `40 seconds`.
 *
 * Returns null when no duration is present, so callers can fall through to the
 * next matcher instead of recording a zero.
 */
export function parseDurationPhrase(text: string): number | null {
  let total = 0;
  let matched = false;

  const hours = /(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h)\b/i.exec(text);
  if (hours?.[1]) {
    total += parseDecimal(hours[1])! * 3600;
    matched = true;
  }

  const minutes = /(\d+(?:[.,]\d+)?)\s*(?:minutes?|mins?\.?|min\.?)\b/i.exec(text);
  if (minutes?.[1]) {
    total += parseDecimal(minutes[1])! * 60;
    matched = true;
  }

  const seconds = /(\d+(?:[.,]\d+)?)\s*(?:seconds?|secs?|s)\b/i.exec(text);
  if (seconds?.[1]) {
    total += parseDecimal(seconds[1])!;
    matched = true;
  }

  return matched ? round(total, 1) : null;
}

/**
 * Parses a number that may use a decimal comma (`97,5` → 97.5) or a decimal
 * dot. Thousands separators are not handled on purpose: no number in this
 * corpus needs them, and supporting both makes `1,5` genuinely ambiguous.
 */
export function parseDecimal(text: string): number | null {
  const cleaned = text.trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Pace in seconds per kilometre, from `6:49 per km` style text. */
export function paceToSecondsPerKm(clock: string): number | null {
  return clockToSeconds(clock);
}

/** Converts a pace (s/km) to speed in km/h. Returns null for a zero pace. */
export function paceToSpeedKmh(secondsPerKm: number): number | null {
  if (secondsPerKm <= 0) return null;
  return round(3600 / secondsPerKm, 2);
}
