import type { TranscribeMeta, TranscribeResponse } from "@training/ai-contracts";
import {
  isSupportedAudioMimeType,
  TranscribeMetaSchema,
  TranscribeResponseSchema,
} from "@training/ai-contracts";
import { validate } from "../body.js";
import { AiHttpError } from "../http-error.js";
import { textSize } from "../log.js";
import type { RequestContext } from "./context.js";

/**
 * `POST /v1/transcriptions`.
 *
 * Transcribe and return the text — nothing else. The audio exists only for the
 * duration of this call: it is never written anywhere and never logged, and the
 * transcript is logged as a length, not as text (brief 7.1, section 12).
 *
 * The Worker deliberately does not parse the transcript into structure. What a
 * recording *means* is the athlete's edit to make, in the browser, against
 * their own rows; this endpoint's only promise is that whatever was said comes
 * back as text.
 */

interface AudioPayload {
  readonly bytes: Uint8Array;
  readonly meta: TranscribeMeta;
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
  const meta = validate(TranscribeMetaSchema, metaJson, "Audio metadata");

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

export async function handleTranscribe(context: RequestContext): Promise<TranscribeResponse> {
  const { config, providers, logger, user } = context;
  const contentType = context.request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new AiHttpError("schema_invalid", "Send the recording as multipart/form-data.");
  }

  const payload = await readMultipart(context);

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

  const response = validate(
    TranscribeResponseSchema,
    { transcript: transcript.text, transcription: transcript.metadata },
    "Transcription response",
  );

  logger.info("transcription_completed", {
    userId: user.userId,
    provider: providers.name,
    audioBytes: payload.bytes.byteLength,
    audioSeconds: payload.meta.durationSeconds,
    // Length only. The transcript itself is never logged.
    transcriptChars: textSize(transcript.text),
    latencyMs: response.transcription.latencyMs,
  });

  return response;
}
