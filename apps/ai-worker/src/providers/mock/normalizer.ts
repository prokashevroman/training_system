import type {
  NormalizationResult,
  NormalizeInput,
  TextNormalizerProvider,
} from "@training/ai-contracts";
import { buildMetadata } from "../metadata.js";

/**
 * Offline normalizer stand-in.
 *
 * Echoes the text back as the notation and states no date, which is exactly the
 * honest do-nothing rewrite: the route can be exercised end to end with no
 * network, and the browser's deterministic parser sees the athlete's own words.
 */
export const MOCK_NORMALIZER_MODEL = "mock-normalizer-v1";
export const MOCK_NORMALIZER_PROMPT_VERSION = "mock-normalizer/1";

export interface MockTextNormalizerOptions {
  /** Overrides the echo in tests that need a specific rewrite. */
  readonly notation?: string;
  readonly localDate?: string | null;
}

export class MockTextNormalizer implements TextNormalizerProvider {
  private readonly requestId: string;
  private readonly options: MockTextNormalizerOptions;

  constructor(requestId: string, options: MockTextNormalizerOptions = {}) {
    this.requestId = requestId;
    this.options = options;
  }

  async normalize(input: NormalizeInput): Promise<NormalizationResult> {
    const startedAtMs = Date.now();
    return {
      notation: this.options.notation ?? input.text.trim(),
      localDate: this.options.localDate ?? null,
      metadata: buildMetadata({
        provider: "mock",
        model: MOCK_NORMALIZER_MODEL,
        promptVersion: MOCK_NORMALIZER_PROMPT_VERSION,
        requestId: this.requestId,
        startedAtMs,
        attempts: 1,
      }),
    };
  }
}
