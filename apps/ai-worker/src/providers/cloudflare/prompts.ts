import type { GeneratePlanInput, ParseWorkoutInput } from "@training/ai-contracts";
import { ModalityEnum, ObjectiveEnum, IntensityEnum, WarningCodeEnum } from "@training/domain";

/**
 * Prompt text for the Workers AI models.
 *
 * Bump the version strings whenever wording changes in a way that could change
 * output: the version is stored on every draft, so a regression can be traced to
 * the prompt that produced it.
 */
export const WORKOUT_PARSER_PROMPT_VERSION = "workout-parser/4";
export const PLANNER_PROMPT_VERSION = "planner/1";
export const PLANNER_EXPLAIN_PROMPT_VERSION = "planner-explain/1";

/** Brief 7.5: the parser's non-negotiable rules. */
const PARSER_RULES = [
  "Never invent missing data.",
  // "|null" fields only — a literal model told to "use null for anything
  // unstated" will null enum fields too, and every one of those costs a
  // schema-repair round trip (this is not hypothetical; llama-3.3 did exactly
  // that with the previous wording).
  'Use null for any value the source does not state and the contract marks "|null". Fields without "|null" are required: when the source does not state them, use "unknown" for objective and intensity, "working" for setType, and a short descriptive title.',
  "Preserve ambiguities: emit a warning instead of choosing an interpretation.",
  "Split independent sessions into separate entries.",
  "Keep a composite workout (for example a benchmark with several movements) as one session.",
  "Normalise units only when the source states the unit; otherwise leave loadKg null.",
  "Account for all source text: every fragment is either represented in a session or listed in unconsumedFragments.",
  "Never give a medical diagnosis or medical advice.",
  "Return JSON only, with no prose and no code fences.",
]
  .map((rule, index) => `${index + 1}. ${rule}`)
  .join("\n");

/**
 * The output contract, described in prose rather than generated from Zod.
 *
 * A generated JSON Schema for the full session draft is thousands of tokens and
 * would need an extra dependency; the response is validated against the real Zod
 * schema regardless, so the prompt only has to get the model close enough for the
 * validator to accept it.
 */
function outputContract(): string {
  return [
    "Return an object with exactly these keys:",
    '  "resolvedLocalDate": "YYYY-MM-DD" — the date the work was done, in the athlete\'s timezone.',
    '  "sessions": array of sessions. Each session: { "localDate", "title", "durationSeconds"|null, "sessionRpe"|null, "notes"|null, "activities": [...], "tags": [] }.',
    '  Each activity: { "sequence" (1-based), "modality", "objective", "intensity", "subtype"|null, "durationSeconds"|null, "distanceKm"|null, "calories"|null, "avgHeartRateBpm"|null, "notes"|null, "originalText", "strengthSets": [...], "cardioIntervals": [], "circuit": null, "benchmark": null }.',
    '  Each strength set: { "setIndex" (1-based), "exercise": { "rawText", "slug"|null, "apparatus"|null, "confidence" 0..1 }, "setType", "reps"|null, "loadValue"|null, "loadUnit", "loadKg"|null, "loadScope", "rpe"|null, "completed", "originalText" }.',
    // Previously undocumented, so a circuit workout was guessed at: the model
    // either invented a movement shape (failing validation) or returned
    // "movements": [] and silently dropped the round's content.
    '  Use "circuit" for repeated rounds of movements ("8 rounds cindy: 5 pull ups, 10 push ups, 15 squats"): { "format", "name"|null (the benchmark name if it has one, e.g. "cindy"), "roundsPrescribed"|null, "roundsCompleted"|null, "timeCapSeconds"|null, "completionSeconds"|null, "score"|null, "asPrescribed"|null, "movements": [...], "notes"|null, "originalText" }. Always list the movements — one entry per distinct movement in ONE round, not repeated per round.',
    '  Each circuit movement: { "movementOrder" (1-based), "exercise" (same shape as above), "targetReps"|null, "targetCalories"|null, "targetDistanceKm"|null, "targetSeconds"|null, "loadValue"|null, "loadUnit", "loadKg"|null, "loadScope", "notes"|null, "originalText" }.',
    '  Use "cardioIntervals" for repeated timed/measured efforts within one cardio activity: { "intervalIndex" (1-based), "intervalType", "durationSeconds"|null, "restSeconds"|null, "distanceKm"|null, "paceSecondsPerKm"|null, "heartRateBpm"|null, "calories"|null }.',
    '  Use "benchmark" only for a named standard workout performed as a whole (murph, half-murph, cindy, fran): { "definitionSlug", "variantLabel"|null, "scoring", "totalSeconds"|null, "roundsCompleted"|null, "score"|null, "vestKg"|null, "asPrescribed"|null, "partitionStrategy"|null, "splits": [ { "splitOrder" (1-based), "label", "reps"|null, "distanceKm"|null, "elapsedSeconds"|null, "isCumulative", "referenceFrame" } ], "notes"|null, "originalText" }.',
    'A session that only *prepares for* or partially mimics a benchmark is not that benchmark: keep it as ordinary activities and put the reference in the title or notes. "cindy" performed as written is a circuit with name "cindy".',
    'Times written as m:ss are minutes and seconds ("6:05" is 365 seconds). "fc promedio" / "fc" is average heart rate and "lpm" is bpm.',
    '  "warnings": array of { "code", "message", "sourceFragment", "severity" } where severity is info|warning|error.',
    '  "unconsumedFragments": array of { "text", "reason" }.',
    "",
    `Allowed modality values: ${ModalityEnum.values.join(", ")}.`,
    `Allowed objective values: ${ObjectiveEnum.values.join(", ")}.`,
    `Allowed intensity values: ${IntensityEnum.values.join(", ")}.`,
    "Allowed loadUnit values: kg, lb, none. Allowed loadScope values: total, per_hand, per_side, added_bodyweight, bodyweight, machine_setting, unknown.",
    `Allowed warning codes: ${WarningCodeEnum.options.join(", ")}.`,
    '"title", "modality", "objective", "intensity" and "setType" are never null. An unstated objective or intensity is "unknown"; an unqualified set is "working"; a title is a short name derived from the content (for example "Pushups").',
    'Enum values are always the exact Latin strings listed here, whatever language the source uses: Russian "кг" or Spanish "kilos" becomes loadUnit "kg". Free-text fields (title, notes, rawText, originalText) stay in the source language.',
    "Do not set clientRequestKey, source or transcript: the server owns those fields.",
  ].join("\n");
}

export function parserSystemPrompt(): string {
  return [
    "You convert an athlete's description of completed training into structured JSON.",
    "",
    "Rules:",
    PARSER_RULES,
    "",
    outputContract(),
  ].join("\n");
}

export function parserUserPrompt(input: ParseWorkoutInput): string {
  const aliases = input.exerciseAliases
    .slice(0, 200)
    .map((hint) => `${hint.alias} -> ${hint.slug}`)
    .join("; ");
  return [
    `Today's local date: ${input.nowLocalDate} (timezone ${input.timezone}).`,
    `Preferred units: ${input.preferredUnits}.`,
    aliases.length > 0 ? `Known exercise aliases: ${aliases}.` : "Known exercise aliases: none.",
    input.recentExerciseNames.length > 0
      ? `Recently used exercise names: ${input.recentExerciseNames.slice(0, 100).join(", ")}.`
      : "Recently used exercise names: none.",
    "",
    "Source text:",
    input.text,
  ].join("\n");
}

export function plannerSystemPrompt(): string {
  return [
    "You draft a short training block for one athlete and return JSON only.",
    "",
    "Rules:",
    "1. Never prescribe hard or maximal work when the athlete reports pain, dizziness, fever, illness, unusual breathlessness or injury.",
    "2. Never give a medical diagnosis. You may recommend rest or professional assessment.",
    "3. Respect every stated constraint.",
    "4. Progress load gradually from what the recent sessions show.",
    "5. Return JSON only, with no prose and no code fences.",
    "",
    "Return an object with exactly these keys:",
    '  "startLocalDate", "endLocalDate": "YYYY-MM-DD".',
    '  "goal": restate the athlete\'s goal.',
    '  "sessions": array of { "localDate", "title", "rationale", "estimatedLoad"|null, "activities": [ { "sequence", "modality", "objective", "intensity", "prescription", "targetDurationSeconds"|null, "targetDistanceKm"|null, "notes"|null } ] }.',
    '  "warnings": array of { "code", "message", "sourceFragment", "severity" }, or [].',
    "",
    `Allowed modality values: ${ModalityEnum.values.join(", ")}.`,
    `Allowed objective values: ${ObjectiveEnum.values.join(", ")}.`,
    `Allowed intensity values: ${IntensityEnum.values.join(", ")}.`,
    "Do not set safetyFlags or metadata: the server owns those fields.",
  ].join("\n");
}

export function plannerUserPrompt(input: GeneratePlanInput): string {
  const recent = input.recentSessions
    .slice(0, 60)
    .map(
      (session) =>
        `${session.localDate}: ${session.title} [${session.modalities.join("/")}]` +
        `${session.durationSeconds === null ? "" : ` ${Math.round(session.durationSeconds / 60)}min`}` +
        `${session.sessionRpe === null ? "" : ` RPE ${session.sessionRpe}`}`,
    )
    .join("\n");
  return [
    `Plan ${input.weeks} week(s) starting ${input.startLocalDate} (timezone ${input.timezone}).`,
    `Goal: ${input.goal}`,
    `Preferred units: ${input.preferredUnits}.`,
    input.constraints.length > 0
      ? `Constraints:\n- ${input.constraints.join("\n- ")}`
      : "Constraints: none stated.",
    recent.length > 0 ? `Recent sessions:\n${recent}` : "Recent sessions: none supplied.",
    input.notes === null ? "Athlete notes: none." : `Athlete notes: ${input.notes}`,
  ].join("\n");
}
