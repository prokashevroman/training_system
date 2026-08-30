import { describe, expect, it } from "vitest";
import { HealthResponseSchema, TranscribeMetaSchema, TranscribeResponseSchema } from "./api.js";
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

describe("HealthResponseSchema", () => {
  it("reports the one configured model", () => {
    const parsed = HealthResponseSchema.parse({
      status: "ok",
      service: "ai-worker",
      provider: "cloudflare",
      models: { stt: "@cf/openai/whisper-large-v3-turbo" },
      requestId: "req-1",
    });
    expect(parsed.models.stt).toContain("whisper");
  });
});
