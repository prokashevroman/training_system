import type { AudioInput, SpeechToTextProvider, TranscriptResult } from "@training/ai-contracts";
import type { AiBinding } from "../../env.js";
import { buildMetadata } from "../../draft.js";
import { bytesToBase64, runTranscription } from "./workers-ai.js";

export const STT_PROMPT_VERSION = "stt/1";

/**
 * Workers AI transcription.
 *
 * The audio bytes go to the binding and are then dropped: nothing is persisted,
 * nothing is logged (brief 7.1, section 12).
 *
 * UNVERIFIED payload shape: `whisper-large-v3-turbo` documents a base64 `audio`
 * string, while the older `@cf/openai/whisper` takes an integer array. Confirm
 * against the model's current schema before the first deploy — a wrong shape
 * shows up as `upstream_error` from `runTranscription`, not as silent nonsense.
 */
export class CloudflareSpeechToText implements SpeechToTextProvider {
  constructor(
    private readonly ai: AiBinding,
    private readonly model: string,
    private readonly requestId: string,
  ) {}

  async transcribe(input: AudioInput): Promise<TranscriptResult> {
    const startedAtMs = Date.now();
    const payload: Record<string, unknown> = { audio: bytesToBase64(input.bytes) };
    if (input.language !== null) payload.language = input.language;

    const result = await runTranscription(this.ai, this.model, payload);
    return {
      text: result.text,
      metadata: {
        ...buildMetadata({
          provider: "cloudflare",
          model: this.model,
          promptVersion: STT_PROMPT_VERSION,
          requestId: this.requestId,
          startedAtMs,
          attempts: 1,
        }),
        language: result.language ?? input.language,
        durationSeconds: result.durationSeconds ?? input.durationSeconds,
      },
    };
  }
}
