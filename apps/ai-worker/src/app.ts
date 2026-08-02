import type { HealthResponse } from "@training/ai-contracts";
import { authenticate } from "./auth.js";
import { corsHeaders, evaluateCors, preflightResponse } from "./cors.js";
import type { WorkerEnv } from "./env.js";
import { resolveConfig } from "./env.js";
import type { RequestContext } from "./handlers/context.js";
import { handleFromAudio } from "./handlers/from-audio.js";
import { handleFromText } from "./handlers/from-text.js";
import { handlePlanDraft, handlePlanExplain } from "./handlers/plans.js";
import { AiHttpError, errorResponse, jsonResponse } from "./http-error.js";
import { createLogger } from "./log.js";
import { selectProviders } from "./providers/index.js";
import { enforceRateLimit } from "./rate-limit.js";

/**
 * Request pipeline. Hand-rolled rather than a framework: four routes do not
 * justify a dependency, and the order below is the security contract, so it is
 * worth having in one readable place.
 *
 *   1. request id
 *   2. CORS / origin allowlist
 *   3. route match
 *   4. bearer-token verification (user id from the token, never the body)
 *   5. rate limit
 *   6. provider selection
 *   7. handler: limits, parse, validate, respond
 */

type Handler = (context: RequestContext) => Promise<unknown>;

const ROUTES: ReadonlyArray<{ method: string; path: string; handler: Handler }> = [
  { method: "POST", path: "/v1/workout-drafts/from-text", handler: handleFromText },
  { method: "POST", path: "/v1/workout-drafts/from-audio", handler: handleFromAudio },
  { method: "POST", path: "/v1/plans/draft", handler: handlePlanDraft },
  { method: "POST", path: "/v1/plans/explain", handler: handlePlanExplain },
];

/** Accepts a caller-supplied id only if it is short and safe to log verbatim. */
function resolveRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  if (supplied !== null && /^[A-Za-z0-9._-]{8,64}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

export async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const requestId = resolveRequestId(request);
  const config = resolveConfig(env);
  const logger = createLogger(requestId, config);
  const url = new URL(request.url);

  // Before CORS: a rejected origin must not learn which routes exist, and a
  // health probe has no origin at all.
  let headers = new Headers();

  try {
    const cors = evaluateCors(request, url, config);
    headers = corsHeaders(cors);

    if (request.method === "OPTIONS") {
      return preflightResponse(cors);
    }

    if (url.pathname === "/health") {
      if (request.method !== "GET") {
        throw new AiHttpError("not_found", "Method not allowed for /health.");
      }
      // Unauthenticated on purpose (brief 7.2): it reports configuration, not
      // data, and makes a misconfigured model ID visible without a token.
      const providers = selectProviders(env, config, requestId);
      const body: HealthResponse = {
        status: "ok",
        service: "ai-worker",
        provider: providers.name,
        models: providers.models,
        requestId,
      };
      headers.set("x-request-id", requestId);
      return jsonResponse(body, 200, headers);
    }

    const route = ROUTES.find(
      (candidate) => candidate.path === url.pathname && candidate.method === request.method,
    );
    if (route === undefined) {
      throw new AiHttpError("not_found", "Unknown route.", { path: url.pathname });
    }

    const user = await authenticate(request, env, config);
    enforceRateLimit(user.userId, config.rateLimitPerMinute);
    const providers = selectProviders(env, config, requestId);

    const body = await route.handler({
      request,
      env,
      config,
      requestId,
      logger,
      user,
      providers,
    });

    headers.set("x-request-id", requestId);
    return jsonResponse(body, 200, headers);
  } catch (error) {
    if (error instanceof AiHttpError) {
      logger.info("request_failed", {
        path: url.pathname,
        method: request.method,
        code: error.code,
        status: error.status,
      });
      return errorResponse(error, requestId, headers);
    }
    // An unexpected throw is a bug, not a client problem. The message is not
    // returned: it can contain internals.
    logger.error("request_crashed", {
      path: url.pathname,
      method: request.method,
      kind: error instanceof Error ? error.name : typeof error,
    });
    return errorResponse(
      new AiHttpError("upstream_error", "The request could not be completed."),
      requestId,
      headers,
    );
  }
}
