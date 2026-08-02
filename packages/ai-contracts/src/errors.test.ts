import { describe, expect, it } from "vitest";
import {
  AI_ERROR_STATUS,
  AiErrorCodeEnum,
  AiErrorResponseSchema,
  AiErrorSchema,
  aiError,
  statusForAiError,
} from "./errors.js";

describe("AiErrorSchema", () => {
  it("round-trips a valid error", () => {
    const value = {
      code: "audio_too_long",
      message: "Recording exceeds the five minute limit.",
      requestId: "req_123",
      details: { maxAudioDurationSeconds: 300 },
    };
    expect(AiErrorSchema.parse(value)).toEqual(value);
  });

  it("defaults details to null", () => {
    const parsed = AiErrorSchema.parse({
      code: "unauthorized",
      message: "Missing bearer token.",
      requestId: "req_1",
    });
    expect(parsed.details).toBeNull();
  });

  it("rejects an unknown code", () => {
    expect(() =>
      AiErrorSchema.parse({ code: "teapot", message: "no", requestId: "req_1" }),
    ).toThrow();
  });

  it("rejects a missing requestId", () => {
    expect(() => AiErrorSchema.parse({ code: "rate_limited", message: "slow down" })).toThrow();
  });

  it("rejects an empty requestId", () => {
    expect(() =>
      AiErrorSchema.parse({ code: "rate_limited", message: "slow down", requestId: "" }),
    ).toThrow();
  });
});

describe("aiError", () => {
  it("builds a response envelope that validates", () => {
    const body = aiError("schema_invalid", "Model output failed validation.", "req_9", {
      issues: ["sessions.0.title"],
    });
    expect(() => AiErrorResponseSchema.parse(body)).not.toThrow();
    expect(body.error.requestId).toBe("req_9");
  });

  it("rejects an envelope with no error member", () => {
    expect(() => AiErrorResponseSchema.parse({ code: "unauthorized" })).toThrow();
  });
});

describe("AI_ERROR_STATUS", () => {
  it("maps every code exactly once", () => {
    for (const code of AiErrorCodeEnum.options) {
      expect(statusForAiError(code)).toBe(AI_ERROR_STATUS[code]);
      expect(AI_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
    expect(Object.keys(AI_ERROR_STATUS)).toHaveLength(AiErrorCodeEnum.options.length);
  });
});
