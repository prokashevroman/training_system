import { describe, expect, it } from "vitest";
import { isAutoApprovable, warn } from "./warnings.js";

describe("warning severity", () => {
  it("defaults blocking codes to `warning` and the rest to `info`", () => {
    expect(warn("UNPARSED_LINE", "m", "f").severity).toBe("warning");
    expect(warn("AMBIGUOUS_SPEED_UNIT", "m", "f").severity).toBe("info");
  });

  it("keeps an explicit severity override", () => {
    expect(warn("AMBIGUOUS_SPEED_UNIT", "m", "f", "error").severity).toBe("error");
  });
});

describe("isAutoApprovable", () => {
  it("approves a clean parse", () => {
    expect(isAutoApprovable([])).toBe(true);
  });

  /**
   * A preserved treadmill speed and a cumulative Murph split are *correct*
   * parses of ambiguous source text. If they forced review, the two cells the
   * project cares most about would sit in the queue forever.
   */
  it("approves informational warnings that indicate a faithful parse", () => {
    expect(
      isAutoApprovable([
        warn("AMBIGUOUS_SPEED_UNIT", "speed = 7.0 has no unit", "speed = 7.0"),
        warn("CUMULATIVE_TIMING", "elapsed, not a split", "29:15 after the start"),
      ]),
    ).toBe(true);
  });

  it("blocks on an unparsed line", () => {
    expect(isAutoApprovable([warn("UNPARSED_LINE", "no matcher", "dips attempts")])).toBe(false);
  });

  it("blocks on any error-severity warning", () => {
    expect(isAutoApprovable([warn("APPROXIMATE_VALUE", "m", "f", "error")])).toBe(false);
  });
});
