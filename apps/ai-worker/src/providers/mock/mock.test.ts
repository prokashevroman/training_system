import { describe, expect, it } from "vitest";
import { createMockProviders, MOCK_TRANSCRIPT } from "./index.js";
import { MockTextNormalizer } from "./normalizer.js";
import { MockSpeechToText } from "./stt.js";

describe("MockSpeechToText", () => {
  const audio = {
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/webm",
    durationSeconds: 21,
    language: null,
  };

  it("returns the fixed transcript with mock provenance", async () => {
    const result = await new MockSpeechToText("req_1").transcribe(audio);
    expect(result.text).toBe(MOCK_TRANSCRIPT);
    expect(result.metadata.provider).toBe("mock");
    expect(result.metadata.requestId).toBe("req_1");
    expect(result.metadata.durationSeconds).toBe(21);
  });

  it("can be seeded with a specific transcript for tests", async () => {
    const result = await new MockSpeechToText("req_2", { transcript: "Rowed 2 km" }).transcribe(
      audio,
    );
    expect(result.text).toBe("Rowed 2 km");
  });
});

describe("MockTextNormalizer", () => {
  it("echoes the text as the notation and states no date", async () => {
    const result = await new MockTextNormalizer("req_n1").normalize({
      text: "  Squats 3x5 (100kg)\nran 5 km  ",
      todayLocalDate: "2026-09-06",
    });
    expect(result.notation).toBe("Squats 3x5 (100kg)\nran 5 km");
    expect(result.localDate).toBeNull();
    expect(result.metadata.provider).toBe("mock");
    expect(result.metadata.requestId).toBe("req_n1");
  });

  it("can be seeded with a specific rewrite for tests", async () => {
    const result = await new MockTextNormalizer("req_n2", {
      notation: "Back squat: 3x5 (100kg)",
      localDate: "2026-08-31",
    }).normalize({ text: "whatever", todayLocalDate: "2026-09-06" });
    expect(result.notation).toBe("Back squat: 3x5 (100kg)");
    expect(result.localDate).toBe("2026-08-31");
  });
});

describe("createMockProviders", () => {
  it("reports its model IDs for /health", () => {
    const providers = createMockProviders("req_3");
    expect(providers.name).toBe("mock");
    expect(providers.models).toEqual({ stt: "mock-stt-v1", normalizer: "mock-normalizer-v1" });
  });
});
