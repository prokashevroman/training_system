import { describe, expect, it } from "vitest";
import { AI_LIMITS, isSupportedAudioMimeType } from "./limits.js";

describe("AI_LIMITS", () => {
  it("caps recordings at the five minutes the brief specifies", () => {
    expect(AI_LIMITS.maxAudioDurationSeconds).toBe(300);
  });

  it("keeps every limit positive", () => {
    for (const value of Object.values(AI_LIMITS)) {
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe("isSupportedAudioMimeType", () => {
  it("accepts a recorder MIME type with codec parameters", () => {
    expect(isSupportedAudioMimeType("audio/webm;codecs=opus")).toBe(true);
    expect(isSupportedAudioMimeType("AUDIO/MP4")).toBe(true);
  });

  it("rejects video and unknown types", () => {
    expect(isSupportedAudioMimeType("video/mp4")).toBe(false);
    expect(isSupportedAudioMimeType("application/json")).toBe(false);
    expect(isSupportedAudioMimeType("")).toBe(false);
  });
});
