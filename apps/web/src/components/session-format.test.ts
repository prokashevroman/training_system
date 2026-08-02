// @vitest-environment node
// Pure formatting; `@training/domain` resolves a file URL on import, which the
// jsdom environment's http-based `import.meta.url` cannot provide.
import { describe, expect, it } from "vitest";
import {
  EM_DASH,
  formatClock,
  formatDistance,
  formatPace,
  formatSplit500,
  humanizeEnum,
  parseImportLocator,
} from "./session-format.js";

describe("formatClock", () => {
  // The Full Murph on 2026-06-07: 3532 seconds.
  it("formats an hour-long benchmark as h:mm:ss", () => {
    expect(formatClock(3532)).toBe("58:52");
    expect(formatClock(3660)).toBe("1:01:00");
  });

  it("keeps the tenth of a second a rower reports", () => {
    expect(formatClock(230.7)).toBe("3:50.7");
  });

  it("shows an absent duration as an em dash rather than 0:00", () => {
    expect(formatClock(null)).toBe(EM_DASH);
    expect(formatClock(undefined)).toBe(EM_DASH);
  });

  it("still formats a real zero", () => {
    expect(formatClock(0)).toBe("0:00");
  });
});

describe("formatPace and formatSplit500", () => {
  it("labels a running pace per kilometre", () => {
    expect(formatPace(251)).toBe("4:11 /km");
  });

  it("labels a rowing split per 500 m", () => {
    expect(formatSplit500(115.4)).toBe("1:55.4 /500 m");
  });

  it("does not invent a pace", () => {
    expect(formatPace(null)).toBe(EM_DASH);
    expect(formatSplit500(null)).toBe(EM_DASH);
  });
});

describe("formatDistance", () => {
  it("keeps kilometres above one kilometre", () => {
    expect(formatDistance(1)).toBe("1 km");
    expect(formatDistance(4.442)).toBe("4.44 km");
  });

  it("shows a short distance in metres", () => {
    expect(formatDistance(0.4)).toBe("400 m");
  });

  it("does not invent a distance", () => {
    expect(formatDistance(null)).toBe(EM_DASH);
  });
});

describe("humanizeEnum", () => {
  it("title-cases a snake_case value", () => {
    expect(humanizeEnum("hybrid_conditioning")).toBe("Hybrid conditioning");
    expect(humanizeEnum("max_strength")).toBe("Max strength");
  });

  it("keeps the spellings that title-casing would mangle", () => {
    expect(humanizeEnum("vo2max")).toBe("VO2max");
    expect(humanizeEnum("ski_erg")).toBe("Ski erg");
    expect(humanizeEnum("amrap")).toBe("AMRAP");
  });
});

describe("parseImportLocator", () => {
  // The strength session on 2026-04-14.
  it("decodes a workbook key to R{row}C{col}", () => {
    expect(parseImportLocator("import:Training programm 2026:17:3:1")).toEqual({
      sheet: "Training programm 2026",
      row: 17,
      column: 3,
      ordinal: 1,
      cell: "R17C3",
    });
  });

  it("keeps the second session of a cell distinguishable", () => {
    expect(parseImportLocator("import:Training programm 2026:17:3:2")?.ordinal).toBe(2);
  });

  it("tolerates a colon inside the sheet name", () => {
    expect(parseImportLocator("import:2026: block A:24:8:1")).toMatchObject({
      sheet: "2026: block A",
      cell: "R24C8",
    });
  });

  it("returns null for a manual session and for no key at all", () => {
    expect(parseImportLocator("manual:9f0b7c1e-0000-4000-8000-000000000000")).toBeNull();
    expect(parseImportLocator(null)).toBeNull();
  });

  it("returns null when the coordinates are not numbers", () => {
    expect(parseImportLocator("import:Sheet:row:col:1")).toBeNull();
  });
});
