import { describe, expect, it } from "vitest";
import { extractLeadingDate, resolveDateToken } from "./entry-date.js";

const TODAY = "2026-09-06";

describe("resolveDateToken", () => {
  it("reads day-first dotted dates", () => {
    expect(resolveDateToken("31.08", TODAY)).toBe("2026-08-31");
    expect(resolveDateToken("5.6", TODAY)).toBe("2026-06-05");
    expect(resolveDateToken("31/08", TODAY)).toBe("2026-08-31");
  });

  it("keeps an explicit year, two- or four-digit", () => {
    expect(resolveDateToken("31.08.2025", TODAY)).toBe("2025-08-31");
    expect(resolveDateToken("31.08.25", TODAY)).toBe("2025-08-31");
  });

  it("reads ISO dates verbatim", () => {
    expect(resolveDateToken("2026-08-31", TODAY)).toBe("2026-08-31");
  });

  it("puts a yearless future date in the previous year", () => {
    // Training is logged after the fact: 09.09 typed on 06.09 was last year.
    expect(resolveDateToken("9.9", TODAY)).toBe("2025-09-09");
    expect(resolveDateToken("6.9", TODAY)).toBe("2026-09-06");
  });

  it("rejects impossible dates and non-dates", () => {
    expect(resolveDateToken("31.13", TODAY)).toBeNull();
    expect(resolveDateToken("32.01", TODAY)).toBeNull();
    expect(resolveDateToken("30.02.2026", TODAY)).toBeNull();
    expect(resolveDateToken("3x10", TODAY)).toBeNull();
    expect(resolveDateToken("97,5", TODAY)).toBeNull();
  });
});

describe("extractLeadingDate", () => {
  it("lifts a date line off the top, colon and trailing space included", () => {
    const text = "31.08: \n\nSquats 3x5 (100kg)";
    expect(extractLeadingDate(text, TODAY)).toEqual({
      localDate: "2026-08-31",
      rest: "\nSquats 3x5 (100kg)",
    });
  });

  it("skips leading blank lines to find the date", () => {
    const text = "\n\n31.08\nSquats 3x5 (100kg)";
    expect(extractLeadingDate(text, TODAY)).toEqual({
      localDate: "2026-08-31",
      rest: "Squats 3x5 (100kg)",
    });
  });

  it("splits an inline date prefix and keeps the rest of the line", () => {
    expect(extractLeadingDate("31.08: Squats 3x5 (100kg)", TODAY)).toEqual({
      localDate: "2026-08-31",
      rest: "Squats 3x5 (100kg)",
    });
    expect(extractLeadingDate("2026-08-31 - Bike to & from work", TODAY)).toEqual({
      localDate: "2026-08-31",
      rest: "Bike to & from work",
    });
  });

  it("returns the text untouched when there is no date", () => {
    const text = "Squats 3x5 (100kg)\nBench 3x8 (80kg)";
    expect(extractLeadingDate(text, TODAY)).toEqual({ localDate: null, rest: text });
  });

  it("never reads a set line or a decimal as a date", () => {
    // `4x165` and `97,5` are load notation; `4.10 (45kg)` has no `:`/` - `
    // boundary, so its dotted number stays a number.
    for (const line of ["4x165", "97,5 kg bench", "4.10 (45kg)", "Run 5.7 km"]) {
      expect(extractLeadingDate(line, TODAY)).toEqual({ localDate: null, rest: line });
    }
  });

  it("handles a date with nothing after it", () => {
    expect(extractLeadingDate("31.08", TODAY)).toEqual({ localDate: "2026-08-31", rest: "" });
  });
});
