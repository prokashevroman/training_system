import { AI_LIMITS } from "@training/ai-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { base64ToBytes, parseJsonBytes, readBytes, validate } from "./body.js";
import { addDays, isValidTimezone, localDateIn, resolveLocalDate } from "./dates.js";
import { resolveConfig } from "./env.js";
import { AiHttpError } from "./http-error.js";
import { createLogger, textSize } from "./log.js";
import { enforceRateLimit, resetRateLimits } from "./rate-limit.js";
import { buildRequest, createEnv } from "./testing/harness.js";
import { z } from "zod";

describe("resolveConfig", () => {
  it("defaults to the mock provider when AI_PROVIDER is unset or unknown", () => {
    expect(resolveConfig({}).provider).toBe("mock");
    expect(resolveConfig({ AI_PROVIDER: "openai" }).provider).toBe("mock");
    expect(resolveConfig({ AI_PROVIDER: " cloudflare " }).provider).toBe("cloudflare");
  });

  it("leaves model IDs null when unset rather than inventing a default", () => {
    const config = resolveConfig({});
    expect(config.models).toEqual({ stt: null, workoutParser: null, planner: null });
  });

  it("falls back to the shared limits and overrides them from the environment", () => {
    expect(resolveConfig({}).limits.maxAudioSeconds).toBe(AI_LIMITS.maxAudioDurationSeconds);
    expect(resolveConfig({ MAX_AUDIO_SECONDS: "60" }).limits.maxAudioSeconds).toBe(60);
    // A nonsense value must not disable the limit.
    expect(resolveConfig({ MAX_AUDIO_SECONDS: "-1" }).limits.maxAudioSeconds).toBe(
      AI_LIMITS.maxAudioDurationSeconds,
    );
    expect(resolveConfig({ MAX_AUDIO_SECONDS: "abc" }).limits.maxAudioSeconds).toBe(
      AI_LIMITS.maxAudioDurationSeconds,
    );
  });

  it("derives the JWKS url and issuer from SUPABASE_URL, tolerating a trailing slash", () => {
    const config = resolveConfig({ SUPABASE_URL: "https://project.supabase.co/" });
    expect(config.jwksUrl).toBe("https://project.supabase.co/auth/v1/.well-known/jwks.json");
    expect(config.expectedIssuer).toBe("https://project.supabase.co/auth/v1");
  });

  it("allows both to be overridden explicitly", () => {
    const config = resolveConfig({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_JWKS_URL: "https://cdn.example/keys.json",
      SUPABASE_JWT_ISSUER: "https://issuer.example",
    });
    expect(config.jwksUrl).toBe("https://cdn.example/keys.json");
    expect(config.expectedIssuer).toBe("https://issuer.example");
  });

  it("reports whether a JWT secret exists without exposing it", () => {
    expect(resolveConfig({}).jwtSecretConfigured).toBe(false);
    const config = resolveConfig({ SUPABASE_JWT_SECRET: "s".repeat(40) });
    expect(config.jwtSecretConfigured).toBe(true);
    expect(JSON.stringify(config)).not.toContain("ssss");
  });
});

describe("dates", () => {
  it("accepts a real IANA zone and rejects a made-up one", () => {
    expect(isValidTimezone("Europe/Madrid")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });

  it("resolves the local date in the athlete's zone, not UTC", () => {
    // 23:30 in Madrid on 2 August is already 3 August in Tokyo.
    const instant = new Date("2026-08-02T21:30:00Z");
    expect(localDateIn("Europe/Madrid", instant)).toBe("2026-08-02");
    expect(localDateIn("Asia/Tokyo", instant)).toBe("2026-08-03");
    expect(localDateIn("America/Los_Angeles", instant)).toBe("2026-08-02");
  });

  it("prefers the client's explicit date", () => {
    expect(resolveLocalDate("Europe/Madrid", "2026-07-31")).toBe("2026-07-31");
  });

  it("rejects an unknown timezone with schema_invalid", () => {
    try {
      resolveLocalDate("Nowhere/Nothing", null);
      expect.unreachable("expected a validation error");
    } catch (error) {
      expect((error as AiHttpError).code).toBe("schema_invalid");
    }
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-08-02", 7)).toBe("2026-08-09");
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-28", 3)).toBe("2026-03-31");
    expect(addDays("2026-08-02", 13)).toBe("2026-08-15");
  });
});

describe("body limits", () => {
  it("rejects an oversized body from the Content-Length header alone", async () => {
    const request = new Request("https://ai.example/x", {
      method: "POST",
      headers: { "content-length": "999999" },
      body: "small",
    });
    const error = await readBytes(request, 100).catch((thrown: unknown) => thrown);
    expect((error as AiHttpError).code).toBe("payload_too_large");
    expect((error as AiHttpError).details).toMatchObject({ maxBytes: 100 });
  });

  it("rejects an oversized body that declared no length", async () => {
    const request = buildRequest("/x", { method: "POST", body: "x".repeat(200) });
    request.headers.delete("content-length");
    const error = await readBytes(request, 100).catch((thrown: unknown) => thrown);
    expect((error as AiHttpError).code).toBe("payload_too_large");
  });

  it("accepts a body inside the limit", async () => {
    const request = buildRequest("/x", { method: "POST", body: "hello" });
    await expect(readBytes(request, 100)).resolves.toHaveLength(5);
  });

  it("reports invalid JSON and invalid UTF-8 as schema_invalid", () => {
    expect(() => parseJsonBytes(new TextEncoder().encode("{oops"))).toThrow(/valid JSON/);
    expect(() => parseJsonBytes(new Uint8Array([0xff, 0xfe, 0xfd]))).toThrow(/UTF-8/);
  });

  it("names the failing paths when validation fails", () => {
    try {
      validate(z.object({ a: z.string() }), {}, "Request body");
      expect.unreachable("expected a validation error");
    } catch (error) {
      const httpError = error as AiHttpError;
      expect(httpError.code).toBe("schema_invalid");
      expect(JSON.stringify(httpError.details)).toContain("a:");
    }
  });

  it("decodes base64 audio and rejects a corrupt payload", () => {
    expect(Array.from(base64ToBytes(btoa("abc")))).toEqual([97, 98, 99]);
    expect(() => base64ToBytes("!!!not base64!!!")).toThrow(/base64/);
  });
});

describe("rate limiting", () => {
  afterEach(() => {
    resetRateLimits();
  });

  it("allows the configured number of requests per minute per user", () => {
    resetRateLimits();
    const now = Date.now();
    enforceRateLimit("user-a", 2, now);
    enforceRateLimit("user-a", 2, now + 10);
    expect(() => enforceRateLimit("user-a", 2, now + 20)).toThrow(AiHttpError);
    // A different athlete is unaffected.
    expect(() => enforceRateLimit("user-b", 2, now + 20)).not.toThrow();
  });

  it("resets after the window and reports a retry delay", () => {
    resetRateLimits();
    const now = Date.now();
    enforceRateLimit("user-c", 1, now);
    try {
      enforceRateLimit("user-c", 1, now + 1000);
      expect.unreachable("expected a rate limit error");
    } catch (error) {
      expect((error as AiHttpError).code).toBe("rate_limited");
      expect((error as AiHttpError).details).toMatchObject({ retryAfterSeconds: 59 });
    }
    expect(() => enforceRateLimit("user-c", 1, now + 61_000)).not.toThrow();
  });
});

describe("logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts sensitive field names instead of trusting the caller", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value: unknown) => {
      lines.push(String(value));
    });

    const logger = createLogger("req_1", resolveConfig(createEnv()));
    logger.info("event", {
      authorization: "Bearer super-secret-token",
      transcript: "I squatted 100 kg",
      transcriptChars: 17,
      userId: "user-1",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("super-secret-token");
    expect(lines[0]).not.toContain("I squatted");
    expect(lines[0]).toContain('"transcriptChars":17');
    expect(lines[0]).toContain('"requestId":"req_1"');
  });

  it("suppresses debug output unless LOG_LEVEL is debug", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value: unknown) => {
      lines.push(String(value));
    });

    createLogger("req_1", resolveConfig(createEnv())).debug("quiet", {});
    expect(lines).toHaveLength(0);

    createLogger("req_2", resolveConfig(createEnv({ LOG_LEVEL: "debug" }))).debug("loud", {});
    expect(lines).toHaveLength(1);
  });

  it("measures text instead of logging it", () => {
    expect(textSize("hello")).toBe(5);
    expect(textSize(null)).toBe(0);
  });
});
