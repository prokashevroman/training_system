import type { ModelMetadata, TranscriptionMetadata } from "./metadata.js";

/**
 * The provider seam.
 *
 * Nothing in this file mentions Cloudflare, Workers AI, `env.AI`, a model ID or
 * an HTTP client — that is the entire point. A Modal, Ollama or hosted-API
 * transcriber must be droppable behind this interface without any change to
 * the web app. `provider` and `model` appear only as opaque strings inside
 * returned metadata.
 */

/** Raw audio handed to a transcription provider. */
export interface AudioInput {
  /** The recording exactly as captured. Never logged, never persisted. */
  readonly bytes: Uint8Array;
  /** MIME type reported by the recorder, e.g. `audio/webm;codecs=opus`. */
  readonly mimeType: string;
  /** Client-measured duration; null when the recorder reported none. */
  readonly durationSeconds: number | null;
  /** BCP-47 hint, e.g. `en`. Null lets the provider auto-detect. */
  readonly language: string | null;
}

export interface TranscriptResult {
  /** Full transcript text. Returned to the athlete, never written to logs. */
  readonly text: string;
  readonly metadata: TranscriptionMetadata;
}

export interface SpeechToTextProvider {
  transcribe(input: AudioInput): Promise<TranscriptResult>;
}

/** The provider set as resolved once per request. */
export interface AiProviderSet {
  readonly name: string;
  readonly speechToText: SpeechToTextProvider;
}

/** Narrow helper so implementations build metadata consistently. */
export type MetadataInit = Omit<ModelMetadata, "attempts"> & { attempts?: number };
