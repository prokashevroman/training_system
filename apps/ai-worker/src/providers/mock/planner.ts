import type {
  ExplainAdjustmentInput,
  GeneratePlanInput,
  ModelPlanDraft,
  PlanDraft,
  PlanExplanation,
  PlannedSession,
  TrainingPlannerProvider,
} from "@training/ai-contracts";
import {
  ModelPlanDraftSchema,
  ModelPlanExplanationSchema,
  PlanDraftSchema,
  PlanExplanationSchema,
  detectSafetyFlags,
} from "@training/ai-contracts";
import { addDays } from "../../dates.js";
import { buildMetadata } from "../../draft.js";
import { enforcePlanSafety } from "../../safety-rules.js";

/**
 * Deterministic weekly template.
 *
 * Three sessions a week on days 0, 2 and 4 of each week. Not a training
 * philosophy — a fixed, inspectable shape that lets the plan endpoint, the safety
 * rules and the web UI be developed and tested offline. The real planning engine
 * (brief section 10) replaces the content, not the contract.
 */
export const MOCK_PLANNER_MODEL = "mock-planner-v1";
export const MOCK_PLANNER_PROMPT_VERSION = "mock-planner/1";
export const MOCK_PLANNER_EXPLAIN_PROMPT_VERSION = "mock-planner-explain/1";

const TEMPLATE = [
  {
    dayOffset: 0,
    title: "Easy aerobic run",
    modality: "running" as const,
    objective: "aerobic_base" as const,
    intensity: "easy" as const,
    prescription: "40 minutes conversational pace",
    targetDurationSeconds: 2400,
    rationale: "Aerobic volume with no interference for the strength day.",
  },
  {
    dayOffset: 2,
    title: "Lower-body strength",
    modality: "strength" as const,
    objective: "max_strength" as const,
    intensity: "hard" as const,
    prescription: "Squat 4x5, hinge 3x6, accessories as time allows",
    targetDurationSeconds: 3600,
    rationale: "One heavy session per week maintains strength while running volume rises.",
  },
  {
    dayOffset: 4,
    title: "Tempo run",
    modality: "running" as const,
    objective: "tempo_threshold" as const,
    intensity: "moderate" as const,
    prescription: "10 minutes easy, 20 minutes tempo, 10 minutes easy",
    targetDurationSeconds: 2400,
    rationale: "Threshold work, placed 48 hours after the heavy session.",
  },
];

export class MockTrainingPlanner implements TrainingPlannerProvider {
  async generatePlan(input: GeneratePlanInput): Promise<PlanDraft> {
    const startedAtMs = Date.now();
    const sessions: PlannedSession[] = [];
    for (let week = 0; week < input.weeks; week += 1) {
      for (const entry of TEMPLATE) {
        sessions.push({
          localDate: addDays(input.startLocalDate, week * 7 + entry.dayOffset),
          title: entry.title,
          rationale: entry.rationale,
          estimatedLoad: null,
          activities: [
            {
              sequence: 1,
              modality: entry.modality,
              objective: entry.objective,
              intensity: entry.intensity,
              prescription: entry.prescription,
              targetDurationSeconds: entry.targetDurationSeconds,
              targetDistanceKm: null,
              notes: null,
            },
          ],
        });
      }
    }

    // Parsed through the shared schema so the mock cannot drift out of contract.
    const draft: ModelPlanDraft = ModelPlanDraftSchema.parse({
      startLocalDate: input.startLocalDate,
      endLocalDate: addDays(input.startLocalDate, input.weeks * 7 - 1),
      goal: input.goal,
      sessions,
      warnings: [],
    });

    const safetyFlags = detectSafetyFlags(input.notes ?? "");
    return PlanDraftSchema.parse({
      ...enforcePlanSafety(draft, safetyFlags),
      safetyFlags,
      metadata: buildMetadata({
        provider: "mock",
        model: MOCK_PLANNER_MODEL,
        promptVersion: MOCK_PLANNER_PROMPT_VERSION,
        requestId: input.requestId,
        startedAtMs,
        attempts: 1,
      }),
    });
  }

  async explainAdjustment(input: ExplainAdjustmentInput): Promise<PlanExplanation> {
    const startedAtMs = Date.now();
    const safetyFlags = detectSafetyFlags(input.notes ?? "");
    const model = ModelPlanExplanationSchema.parse({
      summary:
        safetyFlags.length > 0
          ? "The plan was reduced to recovery work because reported symptoms rule out hard training."
          : `The plan changed from "${input.previousSummary}" to "${input.proposedSummary}".`,
      reasons:
        input.signals.length > 0 ? [...input.signals] : ["No adjustment signals were supplied."],
    });
    return PlanExplanationSchema.parse({
      ...model,
      safetyFlags,
      metadata: buildMetadata({
        provider: "mock",
        model: MOCK_PLANNER_MODEL,
        promptVersion: MOCK_PLANNER_EXPLAIN_PROMPT_VERSION,
        requestId: input.requestId,
        startedAtMs,
        attempts: 1,
      }),
    });
  }
}
