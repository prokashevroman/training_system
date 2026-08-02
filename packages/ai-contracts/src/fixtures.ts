import type { SessionDraft } from "@training/domain";
import { SessionDraftSchema } from "@training/domain";
import type { ModelMetadata } from "./metadata.js";
import type { PlanDraft, PlanExplanation } from "./plan-draft.js";
import { PlanDraftSchema, PlanExplanationSchema } from "./plan-draft.js";
import type { WorkoutDraft } from "./workout-draft.js";
import { WorkoutDraftSchema } from "./workout-draft.js";

/**
 * Schema-valid examples, shared by the contract tests and the mock provider.
 *
 * They are built through `.parse()` on purpose: if a domain schema gains a
 * required field, these throw at first use instead of silently drifting from the
 * real contract.
 */

export function exampleMetadata(overrides: Partial<ModelMetadata> = {}): ModelMetadata {
  return {
    provider: "mock",
    model: "mock-parser-v1",
    promptVersion: "workout-parser/1",
    requestId: "00000000-0000-4000-8000-000000000000",
    latencyMs: 1,
    attempts: 1,
    ...overrides,
  };
}

export function exampleSessionDraft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return SessionDraftSchema.parse({
    localDate: "2026-08-02",
    title: "Squat session",
    source: "voice",
    rawText: "Squats 3 sets of 5 at 100 kilos",
    transcript: "Squats 3 sets of 5 at 100 kilos",
    clientRequestKey: "voice:example-key",
    activities: [
      {
        sequence: 1,
        modality: "strength",
        objective: "max_strength",
        intensity: "hard",
        originalText: "Squats 3 sets of 5 at 100 kilos",
        strengthSets: [1, 2, 3].map((setIndex) => ({
          setIndex,
          exercise: { rawText: "Squats", slug: "back-squat", confidence: 1 },
          reps: 5,
          loadValue: 100,
          loadUnit: "kg",
          loadKg: 100,
          loadScope: "total",
          originalText: "3 sets of 5 at 100 kilos",
        })),
      },
    ],
    ...overrides,
  });
}

export function exampleWorkoutDraft(overrides: Partial<WorkoutDraft> = {}): WorkoutDraft {
  return WorkoutDraftSchema.parse({
    resolvedLocalDate: "2026-08-02",
    sessions: [exampleSessionDraft()],
    warnings: [
      {
        code: "APPROXIMATE_VALUE",
        message: "Load was stated approximately and was not rounded.",
        sourceFragment: "about 100 kilos",
        severity: "info",
      },
    ],
    unconsumedFragments: [{ text: "felt good today", reason: "No structured metric in fragment." }],
    metadata: exampleMetadata(),
    ...overrides,
  });
}

export function examplePlanDraft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return PlanDraftSchema.parse({
    startLocalDate: "2026-08-03",
    endLocalDate: "2026-08-09",
    goal: "Build aerobic base while holding squat strength",
    sessions: [
      {
        localDate: "2026-08-03",
        title: "Easy aerobic run",
        rationale: "Low-intensity volume after a hard strength week.",
        activities: [
          {
            sequence: 1,
            modality: "running",
            objective: "aerobic_base",
            intensity: "easy",
            prescription: "40 minutes conversational pace",
            targetDurationSeconds: 2400,
          },
        ],
      },
    ],
    metadata: exampleMetadata({ model: "mock-planner-v1", promptVersion: "planner/1" }),
    ...overrides,
  });
}

export function examplePlanExplanation(overrides: Partial<PlanExplanation> = {}): PlanExplanation {
  return PlanExplanationSchema.parse({
    summary: "Volume was reduced because two sessions were missed and reported RPE was high.",
    reasons: ["Two sessions missed last week", "Average session RPE was 8.5"],
    metadata: exampleMetadata({ model: "mock-planner-v1", promptVersion: "planner-explain/1" }),
    ...overrides,
  });
}
