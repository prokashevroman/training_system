import type { AudioInput, SpeechToTextProvider, TranscriptResult } from "@training/ai-contracts";
import { buildMetadata } from "../metadata.js";

/**
 * Offline transcription stand-in.
 *
 * Returns a fixed transcript so the transcription route can be exercised end
 * to end with no network and no Cloudflare account. It never inspects the
 * audio bytes beyond their length, which is the only thing it reports.
 */
export const MOCK_STT_MODEL = "mock-stt-v1";
export const MOCK_STT_PROMPT_VERSION = "mock-stt/1";

/** Representative of what an athlete would actually say. */
export const MOCK_TRANSCRIPT =
  "Back squat 3 sets of 5 at 100 kg. Then ran 5 km easy in 25 minutes. Felt strong.";

export interface MockSpeechToTextOptions {
  /** Overrides the fixed transcript in tests that need a specific parse. */
  readonly transcript?: string;
}

export class MockSpeechToText implements SpeechToTextProvider {
  private readonly requestId: string;
  private readonly transcript: string;

  constructor(requestId: string, options: MockSpeechToTextOptions = {}) {
    this.requestId = requestId;
    this.transcript = options.transcript ?? MOCK_TRANSCRIPT;
  }

  async transcribe(input: AudioInput): Promise<TranscriptResult> {
    const startedAtMs = Date.now();
    return {
      text: this.transcript,
      metadata: {
        ...buildMetadata({
          provider: "mock",
          model: MOCK_STT_MODEL,
          promptVersion: MOCK_STT_PROMPT_VERSION,
          requestId: this.requestId,
          startedAtMs,
          attempts: 1,
        }),
        language: input.language ?? "en",
        durationSeconds: input.durationSeconds,
      },
    };
  }
}
