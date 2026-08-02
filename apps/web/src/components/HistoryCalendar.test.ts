// @vitest-environment node
// Grid arithmetic only; no rendering, so the DOM environment is unnecessary.
import { describe, expect, it } from "vitest";
import { buildMonthGrid, shiftMonth } from "./HistoryCalendar.js";

describe("buildMonthGrid", () => {
  it("starts every week on Monday", () => {
    // 1 April 2026 is a Wednesday, so the grid opens on Monday 30 March.
    const weeks = buildMonthGrid("2026-04");
    expect(weeks[0]?.[0]).toEqual({ date: "2026-03-30", inMonth: false });
    expect(weeks[0]?.[2]).toEqual({ date: "2026-04-01", inMonth: true });
  });

  it("returns whole weeks and covers the month exactly once", () => {
    const weeks = buildMonthGrid("2026-04");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    const inMonth = weeks.flat().filter((day) => day.inMonth);
    expect(inMonth).toHaveLength(30);
    expect(inMonth[0]?.date).toBe("2026-04-01");
    expect(inMonth.at(-1)?.date).toBe("2026-04-30");
  });

  it("keeps 2026-04-14 in the grid, where two sessions live", () => {
    expect(buildMonthGrid("2026-04").flat()).toContainEqual({
      date: "2026-04-14",
      inMonth: true,
    });
  });

  it("handles a month that begins on a Monday without a leading week", () => {
    // 1 June 2026 is a Monday.
    const weeks = buildMonthGrid("2026-06");
    expect(weeks[0]?.[0]).toEqual({ date: "2026-06-01", inMonth: true });
  });

  it("handles February in a leap year", () => {
    const inMonth = buildMonthGrid("2028-02")
      .flat()
      .filter((day) => day.inMonth);
    expect(inMonth).toHaveLength(29);
  });
});

describe("shiftMonth", () => {
  it("moves within a year", () => {
    expect(shiftMonth("2026-04", 1)).toBe("2026-05");
    expect(shiftMonth("2026-04", -1)).toBe("2026-03");
  });

  it("crosses the year boundary in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});
