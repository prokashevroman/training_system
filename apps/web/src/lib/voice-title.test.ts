import { describe, expect, it } from "vitest";
import { voiceSessionTitle } from "./voice-title.js";

describe("voiceSessionTitle", () => {
  it("uses the first sentence without its terminal punctuation", () => {
    expect(voiceSessionTitle("Ran 5k easy. Then stretched for ten minutes.")).toBe("Ran 5k easy");
  });

  it("collapses whitespace and newlines", () => {
    expect(voiceSessionTitle("  Back squat\n3 sets of 5  ")).toBe("Back squat 3 sets of 5");
  });

  it("truncates a long opening at a word boundary with an ellipsis", () => {
    const title = voiceSessionTitle(
      "Did an extremely long warmup with the full mobility routine before even touching the bar today",
    );
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("  ");
  });

  it("falls back when the transcript is blank", () => {
    expect(voiceSessionTitle("   ")).toBe("Voice session");
    expect(voiceSessionTitle("...")).toBe("Voice session");
  });
});
