import type {
  ExplainAdjustmentInput,
  GeneratePlanInput,
  PlanDraft,
  PlanExplanation,
  TrainingPlannerProvider,
} from "@training/ai-contracts";
import {
  ModelPlanDraftSchema,
  ModelPlanExplanationSchema,
  PlanDraftSchema,
  PlanExplanationSchema,
  detectSafetyFlags,
} from "@training/ai-contracts";
import { buildMetadata } from "../../draft.js";
import type { AiBinding } from "../../env.js";
import { enforcePlanSafety } from "../../safety-rules.js";
import { withSchemaRetry } from "../../schema-retry.js";
import {
  PLANNER_EXPLAIN_PROMPT_VERSION,
  PLANNER_PROMPT_VERSION,
  plannerSystemPrompt,
  plannerUserPrompt,
} from "./prompts.js";
import type { ChatMessage } from "./workers-ai.js";
import { runJsonChat } from "./workers-ai.js";

const MAX_OUTPUT_TOKENS = 4096;

/**
 * Workers AI planner.
 *
 * Safety flags are detected deterministically from the athlete's notes and applied
 * *after* generation, so a model that ignores the instruction still cannot produce
 * a hard session for someone reporting chest pain.
 */
export class CloudflareTrainingPlanner implements TrainingPlannerProvider {
  constructor(
    private readonly ai: AiBinding,
    private readonly model: string,
  ) {}

  async generatePlan(input: GeneratePlanInput): Promise<PlanDraft> {
    const startedAtMs = Date.now();
    const system = plannerSystemPrompt();
    const user = plannerUserPrompt(input);

    const { value, attempts } = await withSchemaRetry(
      ModelPlanDraftSchema,
      async ({ repairHint }) => {
        const messages: ChatMessage[] = [
          { role: "system", content: system },
          { role: "user", content: user },
        ];
        if (repairHint !== null) messages.push({ role: "user", content: repairHint });
        return runJsonChat(this.ai, this.model, messages, MAX_OUTPUT_TOKENS);
      },
    );

    const safetyFlags = detectSafetyFlags(input.notes ?? "");
    return PlanDraftSchema.parse({
      ...enforcePlanSafety(value, safetyFlags),
      safetyFlags,
      metadata: buildMetadata({
        provider: "cloudflare",
        model: this.model,
        promptVersion: PLANNER_PROMPT_VERSION,
        requestId: input.requestId,
        startedAtMs,
        attempts,
      }),
    });
  }

  async explainAdjustment(input: ExplainAdjustmentInput): Promise<PlanExplanation> {
    const startedAtMs = Date.now();
    const { value, attempts } = await withSchemaRetry(
      ModelPlanExplanationSchema,
      async ({ repairHint }) => {
        const messages: ChatMessage[] = [
          {
            role: "system",
            content: [
              "You explain why a training plan changed, in plain language, and return JSON only.",
              'Return { "summary": string, "reasons": string[] }.',
              "Never give a medical diagnosis. Never invent a signal that was not supplied.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Previous plan: ${input.previousSummary}`,
              `Proposed plan: ${input.proposedSummary}`,
              input.signals.length > 0
                ? `Observed signals:\n- ${input.signals.join("\n- ")}`
                : "Observed signals: none.",
              input.notes === null ? "Athlete notes: none." : `Athlete notes: ${input.notes}`,
            ].join("\n"),
          },
        ];
        if (repairHint !== null) messages.push({ role: "user", content: repairHint });
        return runJsonChat(this.ai, this.model, messages, 1024);
      },
    );

    return PlanExplanationSchema.parse({
      ...value,
      safetyFlags: detectSafetyFlags(input.notes ?? ""),
      metadata: buildMetadata({
        provider: "cloudflare",
        model: this.model,
        promptVersion: PLANNER_EXPLAIN_PROMPT_VERSION,
        requestId: input.requestId,
        startedAtMs,
        attempts,
      }),
    });
  }
}
