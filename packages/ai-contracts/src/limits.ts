/**
 * Transport limits shared by the Worker and the browser, so the client can
 * refuse a too-long recording before spending the upload rather than
 * discovering the limit from a 413.
 *
 * These are defaults; the Worker may lower them from environment variables.
 */
export const AI_LIMITS = {
  /** Uploaded audio, independent of duration: ~10 MB of Opus is far past 5 min. */
  maxAudioBytes: 10 * 1024 * 1024,
  /** Brief section 7.1: app-level recording cap of five minutes. */
  maxAudioDurationSeconds: 300,
} as const;

export type AiLimits = typeof AI_LIMITS;

/** Audio MIME types the browser recorders in scope actually produce. */
export const SUPPORTED_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
  "audio/mpga",
  "audio/wav",
  "audio/x-m4a",
  "audio/aac",
] as const;

/** Compares the media type only, ignoring codec/boundary parameters. */
export function isSupportedAudioMimeType(mimeType: string): boolean {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return SUPPORTED_AUDIO_MIME_TYPES.some((m) => m.split(";")[0] === base);
}
