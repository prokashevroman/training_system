import type { WorkerProviders } from "../types.js";
import { MOCK_NORMALIZER_MODEL, MockTextNormalizer } from "./normalizer.js";
import { MOCK_STT_MODEL, MockSpeechToText } from "./stt.js";

export { MOCK_TRANSCRIPT } from "./stt.js";
export { MOCK_NORMALIZER_MODEL } from "./normalizer.js";

/**
 * The offline provider. No network, no `env.AI`, no Cloudflare account —
 * every result is a fixed function of the input, which is what makes the routes
 * testable and the PWA previewable before any model is configured.
 */
export function createMockProviders(requestId: string): WorkerProviders {
  return {
    name: "mock",
    speechToText: new MockSpeechToText(requestId),
    textNormalizer: new MockTextNormalizer(requestId),
    models: {
      stt: MOCK_STT_MODEL,
      normalizer: MOCK_NORMALIZER_MODEL,
    },
  };
}
