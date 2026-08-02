import type { z, ZodTypeAny } from "zod";
import { AiHttpError } from "./http-error.js";
import { describeIssues } from "./schema-retry.js";

/**
 * Request-body reading with limits enforced *before* anything expensive happens
 * (brief 7.2 step 3).
 *
 * `Content-Length` is checked first so an oversized upload is rejected without
 * buffering it. The length of what actually arrived is checked too, because a
 * chunked request has no `Content-Length` to trust.
 */

export async function readBytes(
  request: Request,
  maxBytes: number,
  code: "payload_too_large" | "audio_too_long" = "payload_too_large",
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) {
      throw new AiHttpError(code, "Request body is too large.", { maxBytes, declaredBytes: size });
    }
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new AiHttpError(code, "Request body is too large.", {
      maxBytes,
      actualBytes: buffer.byteLength,
    });
  }
  return new Uint8Array(buffer);
}

export function parseJsonBytes(bytes: Uint8Array): unknown {
  let text: string;
  try {
    // workerd's TextDecoderConstructorOptions requires both fields.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new AiHttpError("schema_invalid", "Request body is not valid UTF-8.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AiHttpError("schema_invalid", "Request body is not valid JSON.");
  }
}

/**
 * Validates against a shared contract schema; issue paths are safe to return.
 *
 * Generic over the SCHEMA rather than over its output type. Writing
 * `ZodType<T>` expands to `ZodType<T, ZodTypeDef, T>`, which forces Zod's
 * Output and Input positions to unify — so for any schema using `.default()`
 * the inferred `T` collapses to the *input* type and every defaulted field
 * silently becomes optional. `z.output<S>` keeps the post-parse type, where
 * defaults have been applied and the fields are present.
 */
export function validate<S extends ZodTypeAny>(
  schema: S,
  value: unknown,
  what: string,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AiHttpError("schema_invalid", `${what} failed validation.`, {
      issues: describeIssues(parsed.error.issues),
    });
  }
  return parsed.data;
}

export async function readJson<S extends ZodTypeAny>(
  request: Request,
  schema: S,
  maxBytes: number,
  what: string,
): Promise<z.output<S>> {
  const bytes = await readBytes(request, maxBytes);
  return validate(schema, parseJsonBytes(bytes), what);
}

/** Decodes base64 audio without Node's Buffer, which workerd does not have. */
export function base64ToBytes(base64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64.replace(/\s+/g, ""));
  } catch {
    throw new AiHttpError("schema_invalid", "Audio payload is not valid base64.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
