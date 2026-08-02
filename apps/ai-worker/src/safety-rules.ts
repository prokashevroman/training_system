import type { ModelPlanDraft, PlannedSession, SafetyFlag } from "@training/ai-contracts";
import { blocksHardSession } from "@training/ai-contracts";

/**
 * The deterministic half of the planning safety requirement (brief section 12).
 *
 * A model is never trusted to withhold a hard session after the athlete reports
 * chest pain — "usually complies" is not a guarantee. So the rule runs *after*
 * generation: any session containing hard or maximal work is replaced with a rest
 * recommendation. The replacement says what to do and never names a condition,
 * because the app must not diagnose.
 */

const REST_PRESCRIPTION =
  "Rest, or optional light mobility only. Do not train hard until symptoms have resolved.";

function restSession(session: PlannedSession, flags: readonly SafetyFlag[]): PlannedSession {
  return {
    localDate: session.localDate,
    title: "Rest or easy recovery",
    rationale: flags.map((flag) => flag.message).join(" "),
    estimatedLoad: 0,
    activities: [
      {
        sequence: 1,
        modality: "mobility_recovery",
        objective: "recovery",
        intensity: "easy",
        prescription: REST_PRESCRIPTION,
        targetDurationSeconds: null,
        targetDistanceKm: null,
        notes: null,
      },
    ],
  };
}

function isHard(session: PlannedSession): boolean {
  return session.activities.some(
    (activity) => activity.intensity === "hard" || activity.intensity === "max",
  );
}

/** Returns the plan unchanged when no flag fired, so the common path is free. */
export function enforcePlanSafety(
  plan: ModelPlanDraft,
  flags: readonly SafetyFlag[],
): ModelPlanDraft {
  if (!blocksHardSession(flags)) return plan;
  return {
    ...plan,
    sessions: plan.sessions.map((session) =>
      isHard(session) ? restSession(session, flags) : session,
    ),
  };
}
