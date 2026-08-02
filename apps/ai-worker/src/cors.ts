import { AiHttpError } from "./http-error.js";
import type { WorkerConfig } from "./env.js";

/**
 * Origin allowlisting (brief 7.2 step 1).
 *
 * Exact-match only: no wildcards, no suffix matching, no `*`. Suffix matching is
 * how `evil-myapp.com` gets accepted by a rule meant for `myapp.com`.
 */
export function isOriginAllowed(origin: string, config: WorkerConfig): boolean {
  const normalised = origin.trim().replace(/\/+$/, "");
  return config.allowedOrigins.includes(normalised);
}

export interface CorsDecision {
  /** Echoed back in `access-control-allow-origin`, or null for no CORS headers. */
  readonly allowedOrigin: string | null;
}

/**
 * Decides CORS for one request.
 *
 * A `/v1` request with no `Origin` header is rejected too: the browser PWA is the
 * only intended client and always sends one, so a missing header means something
 * else is calling — including a form post from another site. `GET /health` stays
 * open so uptime checks and `curl` work.
 */
export function evaluateCors(request: Request, url: URL, config: WorkerConfig): CorsDecision {
  const origin = request.headers.get("origin");
  const isHealth = url.pathname === "/health";

  if (origin === null) {
    if (isHealth) return { allowedOrigin: null };
    throw new AiHttpError("forbidden_origin", "Requests must include an allowed Origin header.");
  }

  if (!isOriginAllowed(origin, config)) {
    // The rejected origin is not echoed back into the message: it is attacker
    // input, and reflecting it invites it into logs and error surfaces.
    throw new AiHttpError("forbidden_origin", "Origin is not allowed.");
  }

  return { allowedOrigin: origin };
}

const ALLOWED_METHODS = "GET,POST,OPTIONS";
const ALLOWED_HEADERS = "authorization,content-type,x-request-id,idempotency-key";

export function corsHeaders(decision: CorsDecision): Headers {
  const headers = new Headers();
  if (decision.allowedOrigin !== null) {
    headers.set("access-control-allow-origin", decision.allowedOrigin);
    headers.set("vary", "Origin");
    headers.set("access-control-allow-credentials", "false");
  }
  return headers;
}

export function preflightResponse(decision: CorsDecision): Response {
  const headers = corsHeaders(decision);
  headers.set("access-control-allow-methods", ALLOWED_METHODS);
  headers.set("access-control-allow-headers", ALLOWED_HEADERS);
  headers.set("access-control-max-age", "600");
  return new Response(null, { status: 204, headers });
}
