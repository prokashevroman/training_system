import type { FromAudioMeta, FromAudioResponse, ParseWorkoutInput } from "@training/ai-contracts";
import {
  FromAudioJsonRequestSchema,
  FromAudioMetaSchema,
  FromAudioResponseSchema,
  isSupportedAudioMimeType,
} from "@training/ai-contracts";
import { base64ToBytes, parseJsonBytes, readBytes, validate } from "../body.js";
import { resolveLocalDate } from "../dates.js";
import { AiHttpError } from "../http-error.js";
import { textSize } from "../log.js";
import type { RequestContext } from "./context.js";

/**
 * `POST /v1/workout-drafts/from-audio`.
 *
 * Transcribe, then parse, then return a draft. The audio exists only for the
 * duration of this call: it is never written anywhere and never logged, and the
 * transcript is logged as a length, not as text (brief 7.1, section 12).
 *
 * Two body shapes are accepted because `MediaRecorder` output is easiest to send
 * as multipart, while a queued offline draft is easiest to store and replay as
 * JSON.
 */

interface AudioPayload {
  readonly bytes: Uint8Array;
  readonly meta: FromAudioMeta;
}

async function readMultipart(context: RequestContext): Promise<AudioPayload> {
  const { config } = context;
  const declared = context.request.headers.get("content-length");
  if (declared !== null && Number(declared) > config.limits.maxAudioBytes * 1.4) {
    throw new AiHttpError("payload_too_large", "Upload is too large.", {
      maxBytes: config.limits.maxAudioBytes,
    });
  }

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    throw new AiHttpError("schema_invalid", "Multipart body could not be read.");
  }

  const metaRaw = form.get("meta");
  if (typeof metaRaw !== "string") {
    throw new AiHttpError("schema_invalid", "Multipart body is missing the `meta` field.");
  }
  let metaJson: unknown;
  try {
    metaJson = JSON.parse(metaRaw);
  } catch {
    throw new AiHttpError("schema_invalid", "The `meta` field is not valid JSON.");
  }
  const meta = validate(FromAudioMetaSchema, metaJson, "Audio metadata");

  // `@cloudflare/workers-types` declares `FormData.get()` as `string | null`,
  // but workerd returns a File for a file part. Rather than assert a type the
  // declarations do not admit, narrow on the shape actually needed.
  const entry: unknown = form.get("audio");
  if (entry === null || typeof entry === "string") {
    throw new AiHttpError("schema_invalid", "Multipart body is missing the `audio` file.");
  }
  const audio = entry as { size: number; arrayBuffer: () => Promise<ArrayBuffer> };
  if (typeof audio.size !== "number" || typeof audio.arrayBuffer !== "function") {
    throw new AiHttpError("schema_invalid", "The `audio` part is not a file.");
  }
  if (audio.size > config.limits.maxAudioBytes) {
    throw new AiHttpError("payload_too_large", "Audio file is too large.", {
      maxBytes: config.limits.maxAudioBytes,
      actualBytes: audio.size,
    });
  }

  return { bytes: new Uint8Array(await audio.arrayBuffer()), meta };
}

async function readJsonAudio(context: RequestContext): Promise<AudioPayload> {
  const { config } = context;
  // Base64 inflates by 4/3, so the JSON body limit is derived from the audio one
  // rather than the (much smaller) JSON limit.
  const maxJsonBytes = Math.ceil(config.limits.maxAudioBytes * 1.4) + 4096;
  const bytes = await readBytes(context.request, maxJsonBytes);
  const body = validate(FromAudioJsonRequestSchema, parseJsonBytes(bytes), "Request body");
  const audioBytes = base64ToBytes(body.audioBase64);
  if (audioBytes.byteLength > config.limits.maxAudioBytes) {
    throw new AiHttpError("payload_too_large", "Audio payload is too large.", {
      maxBytes: config.limits.maxAudioBytes,
      actualBytes: audioBytes.byteLength,
    });
  }
  const { audioBase64: _audioBase64, ...meta } = body;
  return { bytes: audioBytes, meta };
}

export async function handleFromAudio(context: RequestContext): Promise<FromAudioResponse> {
  const { config, providers, requestId, logger, user } = context;
  const contentType = context.request.headers.get("content-type") ?? "";

  const payload = contentType.includes("multipart/form-data")
    ? await readMultipart(context)
    : await readJsonAudio(context);

  if (payload.bytes.byteLength === 0) {
    throw new AiHttpError("schema_invalid", "Audio payload is empty.");
  }
  if (!isSupportedAudioMimeType(payload.meta.mimeType)) {
    throw new AiHttpError("schema_invalid", "Unsupported audio format.", {
      mimeType: payload.meta.mimeType,
    });
  }
  // A null duration is accepted: some recorders do not report one, and the byte
  // limit still bounds the work. A stated duration is enforced exactly.
  if (
    payload.meta.durationSeconds !== null &&
    payload.meta.durationSeconds > config.limits.maxAudioSeconds
  ) {
    throw new AiHttpError("audio_too_long", "Recording is longer than the configured limit.", {
      maxAudioSeconds: config.limits.maxAudioSeconds,
      durationSeconds: payload.meta.durationSeconds,
    });
  }

  const transcript = await providers.speechToText.transcribe({
    bytes: payload.bytes,
    mimeType: payload.meta.mimeType,
    durationSeconds: payload.meta.durationSeconds,
    language: payload.meta.language,
  });

  if (transcript.text.trim() === "") {
    throw new AiHttpError("upstream_error", "The recording produced an empty transcript.");
  }
  if (transcript.text.length > config.limits.maxTextChars) {
    throw new AiHttpError("payload_too_large", "Transcript is longer than the configured limit.", {
      maxTextChars: config.limits.maxTextChars,
    });
  }

  const nowLocalDate = resolveLocalDate(payload.meta.timezone, payload.meta.localDate);
  const input: ParseWorkoutInput = {
    text: transcript.text,
    nowLocalDate,
    timezone: payload.meta.timezone,
    preferredUnits: payload.meta.preferredUnits,
    source: "voice",
    exerciseAliases: payload.meta.context.exerciseAliases,
    recentExerciseNames: payload.meta.context.recentExerciseNames,
    clientRequestKey: `voice:${user.userId}:${payload.meta.idempotencyKey}`,
    requestId,
  };

  const draft = await providers.workoutParser.parseWorkout(input);
  const response = validate(
    FromAudioResponseSchema,
    { ...draft, transcript: transcript.text, transcription: transcript.metadata },
    "Parser response",
  );

  logger.info("workout_draft_from_audio", {
    userId: user.userId,
    provider: providers.name,
    audioBytes: payload.bytes.byteLength,
    audioSeconds: payload.meta.durationSeconds,
    // Length only. The transcript itself is never logged.
    transcriptChars: textSize(transcript.text),
    sessions: response.sessions.length,
    warnings: response.warnings.length,
    unconsumedFragments: response.unconsumedFragments.length,
    attempts: response.metadata.attempts,
    latencyMs: response.metadata.latencyMs,
  });

  return response;
}
