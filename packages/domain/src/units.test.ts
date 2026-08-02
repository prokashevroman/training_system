import { describe, expect, it } from "vitest";
import {
  clockToSeconds,
  paceToSpeedKmh,
  parseDecimal,
  parseDurationPhrase,
  secondsToClock,
  toKilograms,
  toKilometres,
} from "./units.js";

describe("toKilograms", () => {
  it("passes kilograms through unchanged", () => {
    expect(toKilograms(97.5, "kg")).toMatchObject({ value: 97.5, isExact: true });
  });

  // Acceptance criterion 14: `4x155lb` -> load_kg ~ 70.31, original unit kept.
  it("converts 155 lb to 70.31 kg and keeps the original", () => {
    const r = toKilograms(155, "lb");
    expect(r.value).toBeCloseTo(70.31, 2);
    expect(r.originalValue).toBe(155);
    expect(r.originalUnit).toBe("lb");
    expect(r.isExact).toBe(true);
  });

  it("converts 20 lb (the R13C5 squat load)", () => {
    expect(toKilograms(20, "lb").value).toBeCloseTo(9.07, 2);
  });

  // The rule that matters: a bare number is never guessed at.
  it("refuses to convert a load with no unit", () => {
    const r = toKilograms(165, "none");
    expect(r.value).toBeNull();
    expect(r.isExact).toBe(false);
    expect(r.reason).toMatch(/no unit/i);
  });

  it("marks an approximate load inexact", () => {
    expect(toKilograms(75, "kg", { approximate: true })).toMatchObject({
      value: 75,
      isExact: false,
    });
  });
});

describe("toKilometres", () => {
  it("passes kilometres through", () => {
    expect(toKilometres(6.2, "km").value).toBe(6.2);
  });

  it("converts metres", () => {
    expect(toKilometres(1000, "m").value).toBe(1);
  });

  it("converts 2.76 miles (R15C6)", () => {
    expect(toKilometres(2.76, "mi").value).toBeCloseTo(4.442, 3);
  });

  it.each(["floors", "steps"] as const)("refuses to treat %s as a distance", (unit) => {
    const r = toKilometres(46, unit);
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/not a distance/i);
  });
});

describe("clockToSeconds", () => {
  it.each([
    ["58:52", 3532], // Full Murph total, R24C8
    ["29:15", 1755], // cumulative push-up split, R24C8
    ["6:49", 409], // pace per km, R11C4
    ["4:31", 271], // 1000 m row, R26C3
    ["1:54", 114], // ski erg pace, R26C6
    ["2:14.9", 134.9], // 500 m split, R26C3
    ["1:20:00", 4800], // `1 hour 20 minutes` written as a clock
  ])("parses %s", (text, expected) => {
    expect(clockToSeconds(text)).toBe(expected);
  });

  it.each(["", "abc", "12", "1:60", "1:2:70"])("returns null for %o rather than throwing", (t) => {
    expect(clockToSeconds(t)).toBeNull();
  });

  it("round-trips through secondsToClock", () => {
    expect(secondsToClock(3532)).toBe("58:52");
    expect(secondsToClock(4800)).toBe("1:20:00");
  });
});

describe("parseDurationPhrase", () => {
  it.each([
    ["massage 95 min.", 5700],
    ["Rolling shoulders 31 minutes", 1860],
    ["Massage 1.5 hours", 5400],
    ["Bike 1 hour 15 minutes in total", 4500],
    ["Surfing training (2 hours)", 7200],
    ["40 seconds work", 40],
    ["Swimming training (30 minutes)", 1800],
  ])("parses %o", (text, expected) => {
    expect(parseDurationPhrase(text)).toBe(expected);
  });

  it("returns null when there is no duration, so callers can fall through", () => {
    expect(parseDurationPhrase("Back squat 5x5: 1x80")).toBeNull();
  });
});

describe("parseDecimal", () => {
  it("handles the decimal comma the workbook uses", () => {
    expect(parseDecimal("97,5")).toBe(97.5);
    expect(parseDecimal("12,3")).toBe(12.3);
  });

  it("handles decimal dots", () => {
    expect(parseDecimal("72.5")).toBe(72.5);
  });

  it("rejects non-numeric text rather than coercing", () => {
    expect(parseDecimal("19+K")).toBeNull();
    expect(parseDecimal("")).toBeNull();
  });
});

describe("paceToSpeedKmh", () => {
  it("converts a 6:00/km pace to 10 km/h", () => {
    expect(paceToSpeedKmh(360)).toBe(10);
  });

  it("returns null for a zero pace instead of dividing by zero", () => {
    expect(paceToSpeedKmh(0)).toBeNull();
  });
});
