import { SignJWT } from "jose";
import type { AiBinding, WorkerEnv } from "../env.js";

/**
 * Test fixtures for the Worker.
 *
 * Everything here is offline: tokens are signed locally with the symmetric
 * secret (the same mechanism local Supabase uses), and the AI binding is a queue
 * of canned responses. No test touches the network.
 */

export const TEST_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
export const TEST_ISSUER = "http://127.0.0.1:54321/auth/v1";
export const TEST_ORIGIN = "http://localhost:5173";
export const TEST_USER_ID = "11111111-2222-4333-8444-555555555555";

export function createEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    AI_PROVIDER: "mock",
    ALLOWED_ORIGINS: `${TEST_ORIGIN},https://training.example`,
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_JWT_SECRET: TEST_SECRET,
    RATE_LIMIT_PER_MINUTE: "100",
    ...overrides,
  };
}

export interface SignTokenOptions {
  readonly subject?: string | null;
  readonly secret?: string;
  readonly issuer?: string | null;
  readonly audience?: string | string[] | null;
  /** Seconds relative to now. Negative signs an already-expired token. */
  readonly expiresInSeconds?: number;
}

export async function signToken(options: SignTokenOptions = {}): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresInSeconds = options.expiresInSeconds ?? 3600;
  const claims: Record<string, unknown> = { role: "authenticated", email: "athlete@example.com" };
  if (options.subject !== null) claims.sub = options.subject ?? TEST_USER_ID;

  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(nowSeconds - 60)
    .setExpirationTime(nowSeconds + expiresInSeconds);

  const issuer = options.issuer === undefined ? TEST_ISSUER : options.issuer;
  if (issuer !== null) jwt = jwt.setIssuer(issuer);
  const audience = options.audience === undefined ? "authenticated" : options.audience;
  if (audience !== null) jwt = jwt.setAudience(audience);

  return jwt.sign(new TextEncoder().encode(options.secret ?? TEST_SECRET));
}

export interface RequestOptions {
  readonly method?: string;
  readonly token?: string | null;
  readonly origin?: string | null;
  readonly headers?: Record<string, string>;
  readonly body?: BodyInit | null;
  readonly contentType?: string | null;
}

export function buildRequest(path: string, options: RequestOptions = {}): Request {
  const headers = new Headers(options.headers ?? {});
  const origin = options.origin === undefined ? TEST_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  if (options.token != null) headers.set("authorization", `Bearer ${options.token}`);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null && options.body != null) headers.set("content-type", contentType);

  return new Request(`https://ai.example${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body == null ? {} : { body: options.body }),
  });
}

export interface FakeAi extends AiBinding {
  readonly calls: Array<{ model: string; input: Record<string, unknown> }>;
}

/**
 * Returns queued responses in order. A queued `Error` is thrown instead, which is
 * how binding failures (deprecated model, quota) are simulated.
 */
export function fakeAi(responses: readonly unknown[]): FakeAi {
  const queue = [...responses];
  const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      if (queue.length === 0) throw new Error("fakeAi: no queued response");
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
