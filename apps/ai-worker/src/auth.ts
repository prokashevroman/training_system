import type { JWTPayload, JWTVerifyGetKey } from "jose";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import type { WorkerConfig, WorkerEnv } from "./env.js";
import { AiHttpError, unauthorized } from "./http-error.js";

/**
 * Server-side Supabase token verification (brief 7.3).
 *
 * Two mechanisms, chosen by the token's own `alg` header:
 *
 *   asymmetric (RS256 / ES256 / EdDSA) — the current Supabase mechanism. The
 *     Worker fetches the project's public JWKS and verifies the signature. No
 *     secret is needed, so nothing sensitive is deployed with the Worker.
 *
 *   symmetric (HS256) — the legacy/local fallback. Verified with
 *     SUPABASE_JWT_SECRET. Local Supabase signs this way, so this is the path
 *     `supabase start` exercises.
 *
 * The user id comes from the verified `sub` claim and from nowhere else. No
 * request body field can influence it — that is the whole point of doing this
 * server-side.
 */

/** The identity the rest of the request is allowed to act as. */
export interface AuthenticatedUser {
  readonly userId: string;
  readonly email: string | null;
  readonly role: string | null;
}

const ASYMMETRIC_ALGS = ["RS256", "RS512", "ES256", "ES384", "EdDSA"] as const;
const SYMMETRIC_ALGS = ["HS256", "HS384", "HS512"] as const;

/**
 * One remote key set per JWKS URL, cached for the isolate's lifetime. `jose`
 * handles key caching and rotation cooldown internally; re-creating it per
 * request would refetch the JWKS on every call.
 */
const jwksCache = new Map<string, JWTVerifyGetKey>();

function getRemoteKeySet(jwksUrl: string): JWTVerifyGetKey {
  const cached = jwksCache.get(jwksUrl);
  if (cached) return cached;
  const created = createRemoteJWKSet(new URL(jwksUrl));
  jwksCache.set(jwksUrl, created);
  return created;
}

/** Test seam: drops cached key sets so a fake JWKS URL cannot leak between tests. */
export function resetJwksCache(): void {
  jwksCache.clear();
}

/**
 * Extracts the raw token. Never logged, never returned, never put in an error —
 * it exists only inside this module's call stack.
 */
export function extractBearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  if (header === null || header.trim() === "") {
    throw unauthorized("Missing Authorization header.");
  }
  const match = /^Bearer[ ]+([A-Za-z0-9._~+/=-]+)$/i.exec(header.trim());
  const token = match?.[1];
  if (token === undefined) {
    throw unauthorized("Authorization header must be a Bearer token.");
  }
  // Three dot-separated segments. Cheap structural check before any crypto.
  if (token.split(".").length !== 3) {
    throw unauthorized("Bearer token is malformed.");
  }
  return token;
}

function claimString(payload: JWTPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function authenticate(
  request: Request,
  env: WorkerEnv,
  config: WorkerConfig,
): Promise<AuthenticatedUser> {
  const token = extractBearerToken(request);

  let alg: string;
  try {
    alg = decodeProtectedHeader(token).alg ?? "";
  } catch {
    throw unauthorized("Bearer token header is malformed.");
  }

  const isSymmetric = alg.startsWith("HS");
  const isAsymmetric = (ASYMMETRIC_ALGS as readonly string[]).includes(alg);
  if (!isSymmetric && !isAsymmetric) {
    throw unauthorized("Unsupported token signing algorithm.");
  }

  // `jwtVerify` enforces exp/nbf itself, and `algorithms` pins the accepted set
  // so a token cannot talk the Worker into `alg: none` or into verifying an
  // asymmetric public key as an HMAC secret.
  const verifyOptions = {
    ...(config.expectedIssuer !== null ? { issuer: config.expectedIssuer } : {}),
    clockTolerance: 5,
  };

  let payload: JWTPayload;
  try {
    if (isSymmetric) {
      const secret = env.SUPABASE_JWT_SECRET?.trim();
      if (!secret) {
        throw unauthorized("Symmetric tokens are not accepted: no JWT secret is configured.");
      }
      const result = await jwtVerify(token, new TextEncoder().encode(secret), {
        ...verifyOptions,
        algorithms: [...SYMMETRIC_ALGS],
      });
      payload = result.payload;
    } else {
      if (config.jwksUrl === null) {
        throw unauthorized("Asymmetric tokens are not accepted: no JWKS URL is configured.");
      }
      const result = await jwtVerify(token, getRemoteKeySet(config.jwksUrl), {
        ...verifyOptions,
        algorithms: [...ASYMMETRIC_ALGS],
      });
      payload = result.payload;
    }
  } catch (error) {
    if (error instanceof AiHttpError) throw error;
    // Deliberately coarse and free of the underlying message, which can contain
    // token fragments.
    throw unauthorized("Bearer token is invalid or expired.");
  }

  const userId = claimString(payload, "sub");
  if (userId === null) {
    throw unauthorized("Bearer token has no subject claim.");
  }

  // Supabase access tokens are issued for the `authenticated` audience. An
  // anon-key JWT (aud `anon`) is a valid signature but not a signed-in user.
  const audience = payload.aud;
  const audiences = Array.isArray(audience) ? audience : audience === undefined ? [] : [audience];
  if (audiences.length > 0 && !audiences.includes("authenticated")) {
    throw unauthorized("Bearer token is not an authenticated user token.");
  }

  return {
    userId,
    email: claimString(payload, "email"),
    role: claimString(payload, "role"),
  };
}
