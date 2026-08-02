import type { WorkerConfig, WorkerEnv } from "../../env.js";
import type { WorkerProviders } from "../types.js";
import { CloudflareTrainingPlanner } from "./planner.js";
import { CloudflareWorkoutParser } from "./parser.js";
import { CloudflareSpeechToText } from "./stt.js";
import { requireBinding, requireModel } from "./workers-ai.js";

/**
 * The Workers AI provider set. This is the only directory in the repo that knows
 * Cloudflare model IDs exist, and even here they arrive from configuration.
 */
export function createCloudflareProviders(
  env: WorkerEnv,
  config: WorkerConfig,
  requestId: string,
): WorkerProviders {
  const ai = requireBinding(env.AI);
  const stt = requireModel(config.models.stt, "STT_MODEL");
  const parser = requireModel(config.models.workoutParser, "WORKOUT_PARSER_MODEL");
  const planner = requireModel(config.models.planner, "PLANNER_MODEL");

  return {
    name: "cloudflare",
    speechToText: new CloudflareSpeechToText(ai, stt, requestId),
    workoutParser: new CloudflareWorkoutParser(ai, parser),
    trainingPlanner: new CloudflareTrainingPlanner(ai, planner),
    models: { stt, workoutParser: parser, planner },
  };
}
