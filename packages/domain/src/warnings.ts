import { z } from "zod";
import { WarningSeverityEnum } from "./enums.js";

/**
 * A closed set of reasons the parser was unsure. Every code here traces to a
 * real fragment observed in the source workbook — the comment names the cell.
 *
 * The rule this file enforces: when the source is ambiguous the parser emits a
 * warning and leaves the field `null`. It never guesses a number. A missing
 * value is recoverable; a fabricated one silently corrupts history.
 */
export const WarningCodeEnum = z.enum([
  /** `speed = 7.0` (R5C6) — treadmill speed with no unit. Never converted. */
  "AMBIGUOUS_SPEED_UNIT",
  /** `200 push ups (29:15 after the start of pull ups)` (R24C8) — elapsed, not a split. */
  "CUMULATIVE_TIMING",
  /** Several unrelated activities in one block with no blank-line separator (R24C6). */
  "POSSIBLE_MULTI_SESSION",
  /** `4x165` (R12C2) — a bare load number with no unit. */
  "UNKNOWN_LOAD_UNIT",
  /** `210 or 215lb` (R12C4) — the source itself is undecided. */
  "AMBIGUOUS_LOAD_VALUE",
  /** `value = 6`, `weight 5`, `rowing on 7` — a machine setting, not kilograms. */
  "MACHINE_SETTING_NOT_KG",
  /** Exercise text that no alias resolves to a canonical exercise. */
  "UNRESOLVED_EXERCISE_ALIAS",
  /** A source line no matcher consumed. Drives the reconciliation report. */
  "UNPARSED_LINE",
  /** Only part of a line was understood. */
  "PARTIAL_PARSE",
  /** `approx 900` (R12C2), `Sled push (75 kg approx)` (R26C6). */
  "APPROXIMATE_VALUE",
  /** `19+K steps walking (14km)` (R28C7) — a non-numeric quantity. */
  "NON_NUMERIC_QUANTITY",
  /** Derived date disagrees with the free-text week label. Import must stop. */
  "DATE_LABEL_MISMATCH",
  /** Spanish metric label (`cadencia`, `fc promedio`, `Frec. cardiaca`, `lpm`). */
  "SPANISH_METRIC_LABEL",
  /** Source spelling was corrected via an alias (`Deadlifw`, `preperation`, `lasst`). */
  "SPELLING_NORMALIZED",
  /** A rep or round count the source recorded as incomplete (`stopped on 53rd pull up`). */
  "INCOMPLETE_EFFORT",
  /** Load applies per hand / per side; recorded value is not total system load. */
  "PER_SIDE_LOAD",
  /** Text mentioned a benchmark but its score could not be extracted. */
  "BENCHMARK_SCORE_MISSING",
]);
export type WarningCode = z.infer<typeof WarningCodeEnum>;

export const ParseWarningSchema = z.object({
  code: WarningCodeEnum,
  /** Human-readable, shown in the review queue. */
  message: z.string().min(1),
  /** The exact source substring that triggered this, for traceability. */
  sourceFragment: z.string(),
  severity: WarningSeverityEnum.schema,
});
export type ParseWarning = z.infer<typeof ParseWarningSchema>;

/** Severities that must block automatic approval and force human review. */
const BLOCKING: ReadonlySet<WarningCode> = new Set<WarningCode>([
  "UNPARSED_LINE",
  "AMBIGUOUS_LOAD_VALUE",
  "DATE_LABEL_MISMATCH",
  "UNRESOLVED_EXERCISE_ALIAS",
  "PARTIAL_PARSE",
]);

export function warn(
  code: WarningCode,
  message: string,
  sourceFragment: string,
  severity: WarningSeverity = BLOCKING.has(code) ? "warning" : "info",
): ParseWarning {
  return { code, message, sourceFragment, severity };
}

type WarningSeverity = z.infer<typeof WarningSeverityEnum.schema>;

/**
 * True when the warning set contains nothing that should block auto-approval.
 * Informational warnings (a preserved ambiguous speed, a cumulative Murph
 * split) are expected on correct parses and must not force review.
 */
export function isAutoApprovable(warnings: readonly ParseWarning[]): boolean {
  return !warnings.some((w) => w.severity === "error" || BLOCKING.has(w.code));
}
