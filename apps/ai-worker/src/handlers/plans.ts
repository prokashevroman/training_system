import type {
  ExplainAdjustmentInput,
  GeneratePlanInput,
  PlanDraftResponse,
  PlanExplainResponse,
} from "@training/ai-contracts";
import {
  PlanDraftRequestSchema,
  PlanDraftResponseSchema,
  PlanExplainRequestSchema,
  PlanExplainResponseSchema,
} from "@training/ai-contracts";
import { readJson, validate } from "../body.js";
import { resolveLocalDate } from "../dates.js";
import type { RequestContext } from "./context.js";

/**
 * `POST /v1/plans/draft` and `POST /v1/plans/explain`.
 *
 * Both return proposals. Nothing is scheduled until the athlete approves it in the
 * browser and saves it through Supabase.
 */
export async function handlePlanDraft(context: RequestContext): Promise<PlanDraftResponse> {
  const { config, providers, requestId, logger, user } = context;
  const body = await readJson(
    context.request,
    PlanDraftRequestSchema,
    config.limits.maxJsonBodyBytes,
    "Request body",
  );

  const input: GeneratePlanInput = {
    startLocalDate: resolveLocalDate(body.timezone, body.startLocalDate),
    timezone: body.timezone,
    weeks: body.weeks,
    goal: body.goal,
    preferredUnits: body.preferredUnits,
    constraints: body.constraints,
    recentSessions: body.recentSessions,
    notes: body.notes,
    requestId,
  };

  const plan = await providers.trainingPlanner.generatePlan(input);
  const response = validate(PlanDraftResponseSchema, plan, "Planner response");

  logger.info("plan_draft", {
    userId: user.userId,
    provider: providers.name,
    weeks: body.weeks,
    sessions: response.sessions.length,
    safetyFlags: response.safetyFlags.length,
    attempts: response.metadata.attempts,
    latencyMs: response.metadata.latencyMs,
  });

  return response;
}

export async function handlePlanExplain(context: RequestContext): Promise<PlanExplainResponse> {
  const { config, providers, requestId, logger, user } = context;
  const body = await readJson(
    context.request,
    PlanExplainRequestSchema,
    config.limits.maxJsonBodyBytes,
    "Request body",
  );

  const input: ExplainAdjustmentInput = {
    timezone: body.timezone,
    previousSummary: body.previousSummary,
    proposedSummary: body.proposedSummary,
    signals: body.signals,
    notes: body.notes,
    requestId,
  };

  const explanation = await providers.trainingPlanner.explainAdjustment(input);
  const response = validate(PlanExplainResponseSchema, explanation, "Planner response");

  logger.info("plan_explain", {
    userId: user.userId,
    provider: providers.name,
    reasons: response.reasons.length,
    safetyFlags: response.safetyFlags.length,
    latencyMs: response.metadata.latencyMs,
  });

  return response;
}
