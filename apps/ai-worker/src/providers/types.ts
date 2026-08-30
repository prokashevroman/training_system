import type { AiProviderSet } from "@training/ai-contracts";

/**
 * The provider set plus the model identifier it was configured with, so
 * `GET /health` can report exactly what a deploy will call without a token and
 * without making a model request.
 */
export interface WorkerProviders extends AiProviderSet {
  readonly models: {
    readonly stt: string;
  };
}
