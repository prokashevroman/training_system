import { describe, expect, it } from "vitest";
import {
  HealthResponseSchema,
  NormalizeRequestSchema,
  NormalizeResponseSchema,
  TranscribeMetaSchema,
  TranscribeResponseSchema,
} from "./api.js";
import { AI_LIMITS } from "./limits.js";

describe("TranscribeMetaSchema", () => {
  const validMeta = {
    mimeType: "audio/webm;codecs=opus",
    durationSeconds: 42,
  };

  it("round-trips valid metadata and defaults language to null", () => {
    const parsed = TranscribeMetaSchema.parse(validMeta);
    expect(parsed.language).toBeNull();
    expect(parsed.durationSeconds).toBe(42);
  });

  it("accepts a missing duration as null", () => {
    const parsed = TranscribeMetaSchema.parse({ mimeType: "audio/webm" });
    expect(parsed.durationSeconds).toBeNull();
  });

  it("rejects a duration past the recording limit", () => {
    expect(() =>
      TranscribeMetaSchema.parse({
        ...validMeta,
        durationSeconds: AI_LIMITS.maxAudioDurationSeconds + 1,
      }),
    ).toThrow();
  });

  it("rejects a zero duration", () => {
    expect(() => TranscribeMetaSchema.parse({ ...validMeta, durationSeconds: 0 })).toThrow();
  });

  it("ignores a userId smuggled into the body", () => {
    const parsed = TranscribeMetaSchema.parse({ ...validMeta, userId: "someone-else" });
    expect(parsed).not.toHaveProperty("userId");
  });
});

describe("TranscribeResponseSchema", () => {
  const metadata = {
    provider: "mock",
    model: "mock-stt-v1",
    promptVersion: "mock-stt/1",
    requestId: "req-1",
    latencyMs: 12,
    attempts: 1,
    language: "en",
    durationSeconds: 42,
  };

  it("accepts a transcript with its provenance", () => {
    const parsed = TranscribeResponseSchema.parse({
      transcript: "Ran 5 km easy.",
      transcription: metadata,
    });
    expect(parsed.transcript).toBe("Ran 5 km easy.");
  });

  it("rejects an empty transcript", () => {
    expect(() =>
      TranscribeResponseSchema.parse({ transcript: "", transcription: metadata }),
    ).toThrow();
  });
});

describe("NormalizeRequestSchema", () => {
  it("accepts text with today's date and nothing else", () => {
    const parsed = NormalizeRequestSchema.parse({
      text: "did squats 3x5 at 100",
      todayLocalDate: "2026-09-06",
    });
    expect(parsed.text).toContain("squats");
  });

  it("rejects empty text, oversized text, and a non-ISO date", () => {
    expect(() =>
      NormalizeRequestSchema.parse({ text: "", todayLocalDate: "2026-09-06" }),
    ).toThrow();
    expect(() =>
      NormalizeRequestSchema.parse({
        text: "a".repeat(AI_LIMITS.maxNormalizeTextChars + 1),
        todayLocalDate: "2026-09-06",
      }),
    ).toThrow();
    expect(() =>
      NormalizeRequestSchema.parse({ text: "squats", todayLocalDate: "06.09.2026" }),
    ).toThrow();
  });

  it("ignores a userId smuggled into the body", () => {
    const parsed = NormalizeRequestSchema.parse({
      text: "squats",
      todayLocalDate: "2026-09-06",
      userId: "someone-else",
    });
    expect(parsed).not.toHaveProperty("userId");
  });
});

describe("NormalizeResponseSchema", () => {
  const normalization = {
    provider: "cloudflare",
    model: "@cf/meta/llama-4-scout-17b-16e-instruct",
    promptVersion: "normalizer/1",
    requestId: "req-1",
    latencyMs: 900,
    attempts: 1,
  };

  it("accepts notation with an optional date and provenance", () => {
    const parsed = NormalizeResponseSchema.parse({
      notation: "Back squat: 3x5 (100kg)",
      localDate: "2026-08-31",
      normalization,
    });
    expect(parsed.localDate).toBe("2026-08-31");
    const noDate = NormalizeResponseSchema.parse({
      notation: "Back squat: 3x5 (100kg)",
      localDate: null,
      normalization,
    });
    expect(noDate.localDate).toBeNull();
  });

  it("rejects an empty rewrite", () => {
    expect(() =>
      NormalizeResponseSchema.parse({ notation: "", localDate: null, normalization }),
    ).toThrow();
  });
});

describe("HealthResponseSchema", () => {
  it("reports both configured models", () => {
    const parsed = HealthResponseSchema.parse({
      status: "ok",
      service: "ai-worker",
      provider: "cloudflare",
      models: {
        stt: "@cf/openai/whisper-large-v3-turbo",
        normalizer: "@cf/meta/llama-4-scout-17b-16e-instruct",
      },
      requestId: "req-1",
    });
    expect(parsed.models.stt).toContain("whisper");
    expect(parsed.models.normalizer).toContain("llama");
  });
});
