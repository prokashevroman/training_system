import { describe, expect, it } from "vitest";
import {
  FIRST_DATA_ROW,
  LAST_DATA_ROW,
  LAST_DAY_COL,
  FIRST_DAY_COL,
  cellLocalDate,
  checkWeekLabel,
  weekEndIso,
  weekStartIso,
  weekdayName,
} from "./workbook.js";

/**
 * All 53 week labels, copied verbatim out of column A of the source workbook.
 * Note the inconsistency this fixture pins down: `Dec`/`March`/`Sept` mix
 * abbreviated and full month names, and the year appears only on weeks 01 and
 * 53. Any change to the anchor computation must keep reproducing all of them.
 */
const WEEK_LABELS: readonly string[] = [
  "Week 01 Dec 29, 2025 Jan 4",
  "Week 02 Jan 5 Jan 11",
  "Week 03 Jan 12 Jan 18",
  "Week 04 Jan 19 Jan 25",
  "Week 05 Jan 26 Feb 1",
  "Week 06 Feb 2 Feb 8",
  "Week 07 Feb 9 Feb 15",
  "Week 08 Feb 16 Feb 22",
  "Week 09 Feb 23 March 1",
  "Week 10 March 2 March 8",
  "Week 11 March 9 March 15",
  "Week 12 March 16 March 22",
  "Week 13 March 23 March 29",
  "Week 14 March 30 April 5",
  "Week 15 April 6 April 12",
  "Week 16 April 13 April 19",
  "Week 17 April 20 April 26",
  "Week 18 April 27 May 3",
  "Week 19 May 4 May 10",
  "Week 20 May 11 May 17",
  "Week 21 May 18 May 24",
  "Week 22 May 25 May 31",
  "Week 23 June 1 June 7",
  "Week 24 June 8 June 14",
  "Week 25 June 15 June 21",
  "Week 26 June 22 June 28",
  "Week 27 June 29 July 5",
  "Week 28 July 6 July 12",
  "Week 29 July 13 July 19",
  "Week 30 July 20 July 26",
  "Week 31 July 27 Aug 2",
  "Week 32 Aug 3 Aug 9",
  "Week 33 Aug 10 Aug 16",
  "Week 34 Aug 17 Aug 23",
  "Week 35 Aug 24 Aug 30",
  "Week 36 Aug 31 Sept 6",
  "Week 37 Sept 7 Sept 13",
  "Week 38 Sept 14 Sept 20",
  "Week 39 Sept 21 Sept 27",
  "Week 40 Sept 28 Oct 4",
  "Week 41 Oct 5 Oct 11",
  "Week 42 Oct 12 Oct 18",
  "Week 43 Oct 19 Oct 25",
  "Week 44 Oct 26 Nov 1",
  "Week 45 Nov 2 Nov 8",
  "Week 46 Nov 9 Nov 15",
  "Week 47 Nov 16 Nov 22",
  "Week 48 Nov 23 Nov 29",
  "Week 49 Nov 30 Dec 6",
  "Week 50 Dec 7 Dec 13",
  "Week 51 Dec 14 Dec 20",
  "Week 52 Dec 21 Dec 27",
  "Week 53 Dec 28 Jan 3, 2027",
];

describe("week label cross-check", () => {
  it("has all 53 labels in the fixture", () => {
    expect(WEEK_LABELS).toHaveLength(53);
  });

  // Acceptance criterion 5: all 53 labels match the anchor computation.
  it.each(WEEK_LABELS.map((label, i) => [i + 1, label] as const))(
    "week %i matches the anchor: %s",
    (weekNumber, label) => {
      const check = checkWeekLabel(label);
      expect(check.problems).toEqual([]);
      expect(check.ok).toBe(true);
      expect(check.weekNumber).toBe(weekNumber);
    },
  );

  it("reports a mismatch instead of silently accepting a shifted label", () => {
    const check = checkWeekLabel("Week 02 Jan 6 Jan 12");
    expect(check.ok).toBe(false);
    expect(check.problems.join(" ")).toContain("start");
  });

  it("rejects a label with no week number", () => {
    expect(checkWeekLabel("Columna 1").ok).toBe(false);
  });
});

describe("date derivation", () => {
  it("anchors week 1 on Monday 2025-12-29", () => {
    expect(weekStartIso(1)).toBe("2025-12-29");
    expect(weekdayName("2025-12-29")).toBe("Monday");
  });

  // Acceptance criterion 5: explicit pre-verified fixtures pinning both year
  // boundaries and both ends of the populated range.
  it("maps R2C2 to Monday 2025-12-29 (first cell, 2025/2026 boundary)", () => {
    expect(cellLocalDate(2, 2)).toBe("2025-12-29");
    expect(weekdayName(cellLocalDate(2, 2))).toBe("Monday");
  });

  it("maps R32C7 to Saturday 2026-08-01 (last populated cell)", () => {
    expect(cellLocalDate(32, 7)).toBe("2026-08-01");
    expect(weekdayName(cellLocalDate(32, 7))).toBe("Saturday");
  });

  it("maps week 53 day 7 to 2027-01-03 (2026/2027 boundary)", () => {
    expect(weekEndIso(53)).toBe("2027-01-03");
    expect(cellLocalDate(54, 8)).toBe("2027-01-03");
    expect(weekdayName("2027-01-03")).toBe("Sunday");
  });

  it("maps R24C8 to Sunday 2026-06-07 (the Full Murph cell)", () => {
    expect(cellLocalDate(24, 8)).toBe("2026-06-07");
    expect(weekdayName(cellLocalDate(24, 8))).toBe("Sunday");
  });

  it("maps R17C3 to Tuesday 2026-04-14 (the two-session cell)", () => {
    expect(cellLocalDate(17, 3)).toBe("2026-04-14");
  });

  it("maps R12C2 to Monday 2026-03-09 (the Cyrillic-x cell)", () => {
    expect(cellLocalDate(12, 2)).toBe("2026-03-09");
  });

  it("lands every populated cell on the weekday its column claims", () => {
    const expected = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    for (let row = FIRST_DATA_ROW; row <= LAST_DATA_ROW; row += 1) {
      for (let col = FIRST_DAY_COL; col <= LAST_DAY_COL; col += 1) {
        expect(weekdayName(cellLocalDate(row, col))).toBe(expected[col - 2]);
      }
    }
  });

  it("keeps consecutive cells exactly one day apart across a row boundary", () => {
    // R2C8 (Sunday) -> R3C2 (Monday) must be consecutive days.
    expect(cellLocalDate(2, 8)).toBe("2026-01-04");
    expect(cellLocalDate(3, 2)).toBe("2026-01-05");
  });
});
