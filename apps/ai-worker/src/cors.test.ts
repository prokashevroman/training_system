import { describe, expect, it } from "vitest";
import { corsHeaders, evaluateCors, isOriginAllowed, preflightResponse } from "./cors.js";
import { parseAllowedOrigins, resolveConfig } from "./env.js";
import { AiHttpError } from "./http-error.js";
import { TEST_ORIGIN, buildRequest, createEnv } from "./testing/harness.js";

const config = resolveConfig(createEnv());

function evaluate(path: string, origin: string | null): ReturnType<typeof evaluateCors> {
  const request = buildRequest(path, { origin, method: "POST" });
  return evaluateCors(request, new URL(request.url), config);
}

describe("parseAllowedOrigins", () => {
  it("splits, trims and drops trailing slashes", () => {
    expect(parseAllowedOrigins(" https://a.example/ , https://b.example ")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("returns an empty list when unset", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
  });
});

describe("isOriginAllowed", () => {
  it("accepts a listed origin, with or without a trailing slash", () => {
    expect(isOriginAllowed(TEST_ORIGIN, config)).toBe(true);
    expect(isOriginAllowed(`${TEST_ORIGIN}/`, config)).toBe(true);
    expect(isOriginAllowed("https://training.example", config)).toBe(true);
  });

  it("rejects a look-alike origin", () => {
    expect(isOriginAllowed("https://training.example.evil.com", config)).toBe(false);
    expect(isOriginAllowed("https://evil-training.example", config)).toBe(false);
    expect(isOriginAllowed("http://training.example", config)).toBe(false);
    expect(isOriginAllowed("*", config)).toBe(false);
  });

  it("rejects every origin when the allowlist is empty", () => {
    const closed = resolveConfig(createEnv({ ALLOWED_ORIGINS: undefined }));
    expect(isOriginAllowed(TEST_ORIGIN, closed)).toBe(false);
  });
});

describe("evaluateCors", () => {
  it("allows a listed origin and echoes it back", () => {
    const decision = evaluate("/v1/plans/draft", TEST_ORIGIN);
    expect(decision.allowedOrigin).toBe(TEST_ORIGIN);
    const headers = corsHeaders(decision);
    expect(headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
    expect(headers.get("vary")).toBe("Origin");
  });

  it("rejects an unlisted origin", () => {
    expect(() => evaluate("/v1/plans/draft", "https://evil.example")).toThrow(AiHttpError);
    try {
      evaluate("/v1/plans/draft", "https://evil.example");
    } catch (error) {
      const httpError = error as AiHttpError;
      expect(httpError.code).toBe("forbidden_origin");
      expect(httpError.status).toBe(403);
      // The rejected origin is not reflected back into the message.
      expect(httpError.message).not.toContain("evil.example");
    }
  });

  it("rejects a /v1 request with no Origin header", () => {
    expect(() => evaluate("/v1/workout-drafts/from-text", null)).toThrow(/Origin/);
  });

  it("allows /health with no Origin and sets no CORS headers", () => {
    const request = buildRequest("/health", { origin: null });
    const decision = evaluateCors(request, new URL(request.url), config);
    expect(decision.allowedOrigin).toBeNull();
    expect(corsHeaders(decision).get("access-control-allow-origin")).toBeNull();
  });

  it("still enforces the allowlist on /health when an Origin is sent", () => {
    const request = buildRequest("/health", { origin: "https://evil.example" });
    expect(() => evaluateCors(request, new URL(request.url), config)).toThrow(AiHttpError);
  });
});

describe("preflightResponse", () => {
  it("answers 204 with the allowed methods and headers", () => {
    const response = preflightResponse({ allowedOrigin: TEST_ORIGIN });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(response.headers.get("access-control-allow-credentials")).toBe("false");
  });
});
