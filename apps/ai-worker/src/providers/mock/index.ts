import type { WorkerProviders } from "../types.js";
import { MOCK_STT_MODEL, MockSpeechToText } from "./stt.js";

export { MOCK_TRANSCRIPT } from "./stt.js";

/**
 * The offline provider. No network, no `env.AI`, no Cloudflare account —
 * every result is a fixed function of the input, which is what makes the route
 * testable and the PWA previewable before any model is configured.
 */
export function createMockProviders(requestId: string): WorkerProviders {
  return {
    name: "mock",
    speechToText: new MockSpeechToText(requestId),
    models: {
      stt: MOCK_STT_MODEL,
    },
  };
}
