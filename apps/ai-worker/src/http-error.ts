import type { AiErrorCode } from "@training/ai-contracts";
import { aiError, statusForAiError } from "@training/ai-contracts";

/**
 * The only way this Worker fails a request.
 *
 * Every handler throws `AiHttpError`; one place turns it into a response, so the
 * `{ error: { code, message, requestId, details } }` envelope and the status
 * mapping cannot drift between endpoints (brief 7.2 step 10).
 *
 * `message` and `details` are assumed to reach the user. Never put a bearer
 * token, audio bytes or transcript text in either.
 */
export class AiHttpError extends Error {
  readonly code: AiErrorCode;
  readonly details: Record<string, unknown> | null;

  constructor(code: AiErrorCode, message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = "AiHttpError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return statusForAiError(this.code);
  }
}

export function unauthorized(message: string): AiHttpError {
  // Reason codes stay coarse on purpose: "expired" versus "bad signature" is
  // useful to an attacker and useless to a legitimate client, which must
  // re-authenticate either way.
  return new AiHttpError("unauthorized", message);
}

export function jsonResponse(body: unknown, status: number, headers: Headers): Response {
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(error: AiHttpError, requestId: string, headers: Headers): Response {
  headers.set("x-request-id", requestId);
  return jsonResponse(
    aiError(error.code, error.message, requestId, error.details),
    error.status,
    headers,
  );
}
