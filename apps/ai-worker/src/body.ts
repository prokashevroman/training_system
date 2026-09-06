import type { z, ZodIssue, ZodTypeAny } from "zod";
import { AiHttpError } from "./http-error.js";

/**
 * Shared request validation.
 *
 * Issue paths are safe to return to the client — they describe the request
 * shape, never its content.
 */

const MAX_ISSUES_REPORTED = 8;

export function describeIssues(issues: readonly ZodIssue[]): string[] {
  return issues.slice(0, MAX_ISSUES_REPORTED).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
}

/**
 * Validates against a shared contract schema.
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

/**
 * Reads and validates a JSON body, with the byte limit enforced *before*
 * anything expensive happens. `Content-Length` is checked first so an oversized
 * upload is rejected without buffering it; the length of what actually arrived
 * is checked too, because a chunked request has no `Content-Length` to trust.
 */
export async function readJson<S extends ZodTypeAny>(
  request: Request,
  schema: S,
  maxBytes: number,
  what: string,
): Promise<z.output<S>> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) {
      throw new AiHttpError("payload_too_large", "Request body is too large.", {
        maxBytes,
        declaredBytes: size,
      });
    }
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new AiHttpError("payload_too_large", "Request body is too large.", {
      maxBytes,
      actualBytes: buffer.byteLength,
    });
  }

  let text: string;
  try {
    // workerd's TextDecoderConstructorOptions requires both fields.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer);
  } catch {
    throw new AiHttpError("schema_invalid", "Request body is not valid UTF-8.");
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiHttpError("schema_invalid", "Request body is not valid JSON.");
  }
  return validate(schema, json, what);
}
