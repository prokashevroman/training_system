import { beforeEach, describe, expect, it } from "vitest";
import { authenticate, extractBearerToken, resetJwksCache } from "./auth.js";
import { resolveConfig } from "./env.js";
import { AiHttpError } from "./http-error.js";
import {
  TEST_ISSUER,
  TEST_SECRET,
  TEST_USER_ID,
  buildRequest,
  createEnv,
  signToken,
} from "./testing/harness.js";

/**
 * Token verification is the Worker's only security boundary, so these cases are
 * written as "what an attacker would send" rather than as coverage of branches.
 */

function authRequest(token: string | null): Request {
  return buildRequest("/v1/transcriptions", {
    method: "POST",
    ...(token === null ? {} : { token }),
  });
}

async function expectUnauthorized(promise: Promise<unknown>): Promise<AiHttpError> {
  const error = await promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(AiHttpError);
  const httpError = error as AiHttpError;
  expect(httpError.code).toBe("unauthorized");
  expect(httpError.status).toBe(401);
  return httpError;
}

beforeEach(() => {
  resetJwksCache();
});

describe("extractBearerToken", () => {
  it("accepts a well-formed Bearer header, case-insensitively", async () => {
    const token = await signToken();
    const request = buildRequest("/x", { headers: { authorization: `bearer ${token}` } });
    expect(extractBearerToken(request)).toBe(token);
  });

  it("rejects a missing header", () => {
    expect(() => extractBearerToken(buildRequest("/x"))).toThrow(AiHttpError);
  });

  it("rejects a non-Bearer scheme", () => {
    const request = buildRequest("/x", { headers: { authorization: "Basic abc.def.ghi" } });
    expect(() => extractBearerToken(request)).toThrow(/Bearer/);
  });

  it("rejects a token that is not three segments", () => {
    const request = buildRequest("/x", { headers: { authorization: "Bearer abc.def" } });
    expect(() => extractBearerToken(request)).toThrow(/malformed/);
  });

  it("rejects an empty header", () => {
    const request = buildRequest("/x", { headers: { authorization: "   " } });
    expect(() => extractBearerToken(request)).toThrow(AiHttpError);
  });
});

describe("authenticate (symmetric HS256 fallback)", () => {
  const env = createEnv();
  const config = resolveConfig(env);

  it("derives the user id from the token subject", async () => {
    const user = await authenticate(authRequest(await signToken()), env, config);
    expect(user.userId).toBe(TEST_USER_ID);
    expect(user.email).toBe("athlete@example.com");
    expect(user.role).toBe("authenticated");
  });

  it("ignores any user id in the request body", async () => {
    const request = new Request("https://ai.example/v1/transcriptions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${await signToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ userId: "00000000-0000-4000-8000-999999999999" }),
    });
    const user = await authenticate(request, env, config);
    expect(user.userId).toBe(TEST_USER_ID);
  });

  it("rejects a missing token", async () => {
    await expectUnauthorized(authenticate(authRequest(null), env, config));
  });

  it("rejects an expired token", async () => {
    const token = await signToken({ expiresInSeconds: -120 });
    await expectUnauthorized(authenticate(authRequest(token), env, config));
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = await signToken({ secret: "another-secret-that-is-32-characters-x" });
    await expectUnauthorized(authenticate(authRequest(token), env, config));
  });

  it("rejects a tampered payload", async () => {
    const token = await signToken();
    const [header, , signature] = token.split(".");
    const forgedPayload = btoa(JSON.stringify({ sub: "attacker", aud: "authenticated" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    await expectUnauthorized(
      authenticate(authRequest(`${header}.${forgedPayload}.${signature}`), env, config),
    );
  });

  it("rejects a token from another issuer", async () => {
    const token = await signToken({ issuer: "https://evil.example/auth/v1" });
    await expectUnauthorized(authenticate(authRequest(token), env, config));
  });

  it("rejects an anon-audience token", async () => {
    const token = await signToken({ audience: "anon" });
    const error = await expectUnauthorized(authenticate(authRequest(token), env, config));
    expect(error.message).toMatch(/authenticated user/);
  });

  it("rejects a token with no subject", async () => {
    const token = await signToken({ subject: null });
    const error = await expectUnauthorized(authenticate(authRequest(token), env, config));
    expect(error.message).toMatch(/subject/);
  });

  it("rejects an unsigned (alg: none) token", async () => {
    const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" })).replace(/=+$/, "");
    const payload = btoa(JSON.stringify({ sub: TEST_USER_ID, aud: "authenticated" })).replace(
      /=+$/,
      "",
    );
    await expectUnauthorized(authenticate(authRequest(`${header}.${payload}.`), env, config));
  });

  it("rejects a symmetric token when no secret is configured", async () => {
    const secretless = createEnv({ SUPABASE_JWT_SECRET: undefined });
    const token = await signToken();
    const error = await expectUnauthorized(
      authenticate(authRequest(token), secretless, resolveConfig(secretless)),
    );
    expect(error.message).toMatch(/no JWT secret/);
  });

  it("accepts a token with no issuer claim when none is configured", async () => {
    const issuerless = createEnv({ SUPABASE_URL: undefined });
    const token = await signToken({ issuer: null });
    const user = await authenticate(authRequest(token), issuerless, resolveConfig(issuerless));
    expect(user.userId).toBe(TEST_USER_ID);
  });

  it("tolerates a five-second clock skew but not a two-minute one", async () => {
    const fresh = await signToken({ expiresInSeconds: 2 });
    await expect(authenticate(authRequest(fresh), env, config)).resolves.toMatchObject({
      userId: TEST_USER_ID,
    });
    const stale = await signToken({ expiresInSeconds: -6 });
    await expectUnauthorized(authenticate(authRequest(stale), env, config));
  });

  it("uses the configured issuer and JWKS url derived from SUPABASE_URL", () => {
    expect(config.expectedIssuer).toBe(TEST_ISSUER);
    expect(config.jwksUrl).toBe("http://127.0.0.1:54321/auth/v1/.well-known/jwks.json");
    expect(config.jwtSecretConfigured).toBe(true);
    expect(TEST_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});

describe("authenticate (asymmetric JWKS path)", () => {
  it("refuses an asymmetric token when no JWKS url is configured, without any fetch", async () => {
    const env = createEnv({ SUPABASE_URL: undefined, SUPABASE_JWKS_URL: undefined });
    // Hand-built RS256 header: verification must fail on configuration, before
    // any network access, so this test stays offline.
    const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" })).replace(/=+$/, "");
    const payload = btoa(JSON.stringify({ sub: TEST_USER_ID })).replace(/=+$/, "");
    const error = await expectUnauthorized(
      authenticate(authRequest(`${header}.${payload}.signature`), env, resolveConfig(env)),
    );
    expect(error.message).toMatch(/no JWKS URL/);
  });

  it("rejects an unsupported algorithm outright", async () => {
    const env = createEnv();
    const header = btoa(JSON.stringify({ alg: "PS999", typ: "JWT" })).replace(/=+$/, "");
    const payload = btoa(JSON.stringify({ sub: TEST_USER_ID })).replace(/=+$/, "");
    const error = await expectUnauthorized(
      authenticate(authRequest(`${header}.${payload}.sig`), env, resolveConfig(env)),
    );
    expect(error.message).toMatch(/algorithm/);
  });
});
