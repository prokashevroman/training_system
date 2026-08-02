import { z } from "zod";
import type { AiBinding } from "../../env.js";
import { AiHttpError } from "../../http-error.js";
import { RepairableModelError } from "../../schema-retry.js";

/**
 * The thin layer between `env.AI` and the providers.
 *
 * Workers AI response shapes vary by model and have changed over time, so nothing
 * here assumes a shape: results are validated, and an unreadable result is
 * classified as either *repairable* (bad JSON — worth one retry with a hint) or
 * *upstream* (the binding itself failed, retrying the same call will not help).
 */

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** `{ response: ... }` is the documented chat shape; `result` wraps it in the REST API. */
const ChatResponseSchema = z.union([
  z.object({ response: z.union([z.string(), z.record(z.string(), z.unknown())]) }),
  z.object({
    result: z.object({ response: z.union([z.string(), z.record(z.string(), z.unknown())]) }),
  }),
]);

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

/** Strips a fenced code block, which chat models add even when told not to. */
function stripFences(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return (fenced?.[1] ?? text).trim();
}

/** Runs a chat completion and returns parsed JSON, or throws a repairable error. */
export async function runJsonChat(
  ai: AiBinding,
  model: string,
  messages: readonly ChatMessage[],
  maxTokens: number,
): Promise<unknown> {
  const raw = await callBinding(ai, model, {
    messages,
    // JSON Mode is the portable request for structured output. Models that
    // ignore the hint still succeed via stripFences + JSON.parse below; models
    // that reject the parameter surface as upstream_error, which is the clear
    // failure the brief wants for an incompatible configured model.
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: maxTokens,
  });

  const parsed = ChatResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AiHttpError("upstream_error", "The AI model returned an unrecognised response.", {
      model,
    });
  }
  const response = "result" in parsed.data ? parsed.data.result.response : parsed.data.response;
  if (typeof response !== "string") return response;

  try {
    return JSON.parse(stripFences(response));
  } catch {
    throw new RepairableModelError("The previous response was not valid JSON.");
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
      {
        model,
      },
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
