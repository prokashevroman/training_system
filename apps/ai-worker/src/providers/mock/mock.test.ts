import { describe, expect, it } from "vitest";
import { createMockProviders, MOCK_TRANSCRIPT } from "./index.js";
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

describe("createMockProviders", () => {
  it("reports its model ID for /health", () => {
    const providers = createMockProviders("req_3");
    expect(providers.name).toBe("mock");
    expect(providers.models).toEqual({ stt: "mock-stt-v1" });
  });
});
