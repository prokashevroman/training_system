import { AiHttpError } from "./http-error.js";

/**
 * Local-date resolution.
 *
 * Everything the athlete records is dated in *their* timezone, so a 23:40 upload
 * must not land on tomorrow because the Worker ran in UTC. The client sends an
 * IANA zone and the Worker resolves the date with `Intl`, which knows the DST
 * rules; date arithmetic by adding 86400 seconds does not.
 */

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function assertValidTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    throw new AiHttpError("schema_invalid", "Unknown timezone.", { timezone });
  }
}

/** `YYYY-MM-DD` for `instant` as seen in `timezone`. */
export function localDateIn(timezone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const find = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${find("year")}-${find("month")}-${find("day")}`;
}

/**
 * The client's explicit date wins when supplied: it recorded the session and
 * knows whether the athlete meant "yesterday". Otherwise "today" in their zone.
 */
export function resolveLocalDate(
  timezone: string,
  override: string | null,
  now: Date = new Date(),
): string {
  assertValidTimezone(timezone);
  if (override !== null) return override;
  return localDateIn(timezone, now);
}

/** Calendar-day arithmetic on a `YYYY-MM-DD` string, DST-independent. */
export function addDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const base = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  const shifted = new Date(base + days * 86_400_000);
  const iso = shifted.toISOString();
  return iso.slice(0, 10);
}
