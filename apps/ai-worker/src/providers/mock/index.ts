import type { WorkerProviders } from "../types.js";
import { MOCK_PARSER_MODEL, MockWorkoutParser } from "./parser.js";
import { MOCK_PLANNER_MODEL, MockTrainingPlanner } from "./planner.js";
import { MOCK_STT_MODEL, MockSpeechToText } from "./stt.js";

export { MOCK_TRANSCRIPT } from "./stt.js";

/**
 * The offline provider set. No network, no `env.AI`, no Cloudflare account —
 * every result is a fixed function of the input, which is what makes the routes
 * testable and the PWA previewable before any model is configured.
 */
export function createMockProviders(requestId: string): WorkerProviders {
  return {
    name: "mock",
    speechToText: new MockSpeechToText(requestId),
    workoutParser: new MockWorkoutParser(),
    trainingPlanner: new MockTrainingPlanner(),
    models: {
      stt: MOCK_STT_MODEL,
      workoutParser: MOCK_PARSER_MODEL,
      planner: MOCK_PLANNER_MODEL,
    },
  };
}
