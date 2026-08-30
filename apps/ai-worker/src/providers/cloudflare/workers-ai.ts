import { z } from "zod";
import type { AiBinding } from "../../env.js";
import { AiHttpError } from "../../http-error.js";

/**
 * The thin layer between `env.AI` and the transcription provider.
 *
 * Workers AI response shapes vary by model and have changed over time, so
 * nothing here assumes a shape: results are validated, and an unreadable
 * result surfaces as `upstream_error` rather than silent nonsense.
 */

const TranscriptionResponseSchema = z.union([
  z.object({
    text: z.string(),
    transcription_info: z
      .object({ language: z.string().nullish(), duration: z.number().nullish() })
      .nullish(),
  }),
  z.object({
    result: z.object({
      text: z.string(),
      transcription_info: z
        .object({ language: z.string().nullish(), duration: z.number().nullish() })
        .nullish(),
    }),
  }),
]);

export interface TranscriptionOutput {
  readonly text: string;
  readonly language: string | null;
  readonly durationSeconds: number | null;
}

export function requireBinding(ai: AiBinding | undefined): AiBinding {
  if (ai === undefined) {
    throw new AiHttpError("upstream_error", "The Workers AI binding is not configured.");
  }
  return ai;
}

export function requireModel(model: string | null, variable: string): string {
  if (model === null) {
    // No hard-coded fallback on purpose: a silently substituted model would
    // produce plausible output from the wrong place (brief 7.4).
    throw new AiHttpError("upstream_error", `Model configuration ${variable} is missing.`, {
      variable,
    });
  }
  return model;
}

async function callBinding(
  ai: AiBinding,
  model: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await ai.run(model, input);
  } catch (error) {
    // Includes a deprecated or unknown model ID, which is exactly the failure the
    // brief asks to surface clearly rather than swallow.
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new AiHttpError("upstream_error", "The AI model request failed.", { model, detail });
  }
}

export async function runTranscription(
  ai: AiBinding,
  model: string,
  input: Record<string, unknown>,
): Promise<TranscriptionOutput> {
  const raw = await callBinding(ai, model, input);
  const parsed = TranscriptionResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AiHttpError(
      "upstream_error",
      "The transcription model returned an unexpected shape.",
      { model },
    );
  }
  const result = "result" in parsed.data ? parsed.data.result : parsed.data;
  return {
    text: result.text,
    language: result.transcription_info?.language ?? null,
    durationSeconds: result.transcription_info?.duration ?? null,
  };
}

/** Workers AI audio inputs are base64 or byte arrays, never a Blob. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
