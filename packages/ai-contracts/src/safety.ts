import { z } from "zod";

/**
 * Deterministic health flags (brief section 12).
 *
 * These are matched by rules, never by a model, because the required behaviour
 * is a hard guarantee: a statement of chest pain must not be followed by a hard
 * session recommendation. A model that "usually" complies is not a guarantee.
 * Flags describe what was *said*; they are never a diagnosis.
 */
export const SafetyFlagCodeEnum = z.enum([
  "acute_pain",
  "chest_pain",
  "dizziness",
  "fever_or_illness",
  "shortness_of_breath",
  "injury",
]);
export type SafetyFlagCode = z.infer<typeof SafetyFlagCodeEnum>;

export const SafetyFlagSchema = z.object({
  code: SafetyFlagCodeEnum,
  /** The source substring that triggered the flag, for the reviewer to read. */
  sourceFragment: z.string().min(1),
  /** Non-diagnostic, action-oriented text shown to the user. */
  message: z.string().min(1),
});
export type SafetyFlag = z.infer<typeof SafetyFlagSchema>;

const RULES: ReadonlyArray<{ code: SafetyFlagCode; pattern: RegExp; message: string }> = [
  {
    code: "chest_pain",
    pattern: /\bchest (pain|pressure|tightness)\b|\btightness in (my )?chest\b/i,
    message:
      "You mentioned chest symptoms. No hard session is suggested. Seek professional assessment before training.",
  },
  {
    code: "acute_pain",
    pattern: /\b(sharp|acute|stabbing) pain\b|\bpain (that )?(got|is getting) worse\b/i,
    message: "You mentioned acute pain. Rest is suggested instead of a hard session.",
  },
  {
    code: "dizziness",
    pattern: /\b(dizzy|dizziness|light[- ]?headed|fainted?)\b/i,
    message: "You mentioned dizziness. Rest is suggested instead of a hard session.",
  },
  {
    code: "fever_or_illness",
    pattern: /\b(fever|feverish|flu|sick|ill|infection|covid)\b/i,
    message: "You mentioned illness. Rest is suggested instead of a hard session.",
  },
  {
    code: "shortness_of_breath",
    pattern: /\b(short(ness)? of breath|can'?t breathe|breathless|wheezing)\b/i,
    message:
      "You mentioned unusual breathing difficulty. No hard session is suggested. Seek professional assessment.",
  },
  {
    code: "injury",
    pattern: /\b(injur(y|ed|ies)|sprain(ed)?|strain(ed)? (my )?(hamstring|back|shoulder)|tore)\b/i,
    message: "You mentioned an injury. Load is not increased until it is resolved.",
  },
];

/**
 * Scans free text for the flag vocabulary above. Pure and order-stable, so a
 * planner given the same notes always produces the same flags.
 */
export function detectSafetyFlags(text: string): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      flags.push({ code: rule.code, sourceFragment: match[0], message: rule.message });
    }
  }
  return flags;
}

/** True when any flag forbids prescribing a hard or maximal session. */
export function blocksHardSession(flags: readonly SafetyFlag[]): boolean {
  return flags.length > 0;
}
